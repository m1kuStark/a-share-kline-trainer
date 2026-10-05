// UPD-01 更新器（独立 detached 进程入口＋可注入编排函数 runFromPlan）。
// 由服务端 apply 在包外工作目录（dataDir/update-work/<attemptId>/）拉起；控制令牌
// 经 env 继承（SETUP-01 同通道），永不写入 plan/状态文件。
// 编排（design.md §3.1/§3.3）：control/prepare 排空 → control/shutdown → 等 pid 退出
// → 备份 preserve → 换装（失败回滚）→ preserve 核验/恢复 → spawn launcher.cjs
// （Start 语义）→ 新服务健康版本核验 → completed＋清理。
// 所有 IO 边界（control/waitExit/relaunch/health/extract/delay）可注入，供 vitest
// 在临时目录上内联跑全流程，不 spawn 真实进程。

import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeUpdateStatus } from './status.js'
import {
  backupPreserveFiles, performSwap, restorePreserveFromBackup, rollbackSwap, snapshotPreserved, verifyPreserved, walkFiles,
  type UpdatePlan,
} from './updater-core.js'
import { extractZip } from './zip.js'

export interface UpdaterDeps {
  /** SETUP-01 控制 API（默认实现：本机 HTTP＋env 控制令牌） */
  control: {
    prepare: (plan: UpdatePlan) => Promise<{ ok: boolean, reason?: string }>
    shutdown: (plan: UpdatePlan) => Promise<{ ok: boolean, reason?: string }>
  }
  waitServerExit: (plan: UpdatePlan) => Promise<{ ok: boolean, reason?: string }>
  relaunch: (plan: UpdatePlan) => Promise<{ started: boolean, reason?: string }>
  waitHealthy: (plan: UpdatePlan, expectedVersion: string) => Promise<{ ok: boolean, version?: string | null, reason?: string }>
  extract: (zipPath: string, destDir: string) => Promise<string>
  delay: (ms: number) => Promise<void>
}

const SERVER_EXIT_TIMEOUT_MS = 20_000
const PORT_DRAIN_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 40_000
const POLL_MS = 250

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean((error as NodeJS.ErrnoException | null)?.code === 'EPERM')
  }
}

async function postControl(plan: UpdatePlan, action: 'prepare' | 'shutdown'): Promise<{ ok: boolean, reason?: string }> {
  const token = process.env.TRAINER_CONTROL_TOKEN?.trim() ?? ''
  if (!token) return { ok: false, reason: '缺少控制令牌（TRAINER_CONTROL_TOKEN），无法执行受控退出' }
  try {
    const response = await fetch(`http://127.0.0.1:${plan.serverPort}/api/setup/control/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-control-token': token },
      body: JSON.stringify({ runId: plan.runId, attemptId: plan.attemptId }),
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 200 || response.status === 202) return { ok: true }
    let code = `HTTP ${response.status}`
    try {
      const body = JSON.parse(await response.text()) as { error?: string }
      if (body?.error) code = body.error
    } catch { /* 非 JSON 体按状态码报告 */ }
    return { ok: false, reason: code }
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }
}

const defaultDelay = (ms: number): Promise<void> => new Promise(resolveDelay => { setTimeout(resolveDelay, ms) })

const defaultDeps: UpdaterDeps = {
  control: {
    prepare: plan => postControl(plan, 'prepare'),
    shutdown: plan => postControl(plan, 'shutdown'),
  },
  waitServerExit: async plan => {
    const exitDeadline = Date.now() + SERVER_EXIT_TIMEOUT_MS
    while (pidAlive(plan.serverPid)) {
      if (Date.now() >= exitDeadline) return { ok: false, reason: `PID ${plan.serverPid} 未在 ${SERVER_EXIT_TIMEOUT_MS / 1000} 秒内退出` }
      await defaultDelay(POLL_MS)
    }
    const drainDeadline = Date.now() + PORT_DRAIN_TIMEOUT_MS
    while (Date.now() < drainDeadline) {
      try {
        await fetch(`http://127.0.0.1:${plan.serverPort}/api/health`, { signal: AbortSignal.timeout(500) })
      } catch {
        return { ok: true }
      }
      await defaultDelay(POLL_MS)
    }
    return { ok: false, reason: `端口 ${plan.serverPort} 在进程退出后仍未释放` }
  },
  relaunch: plan => new Promise(resolveLaunch => {
    let settled = false
    const finish = (outcome: { started: boolean, reason?: string }): void => {
      if (settled) return
      settled = true
      resolveLaunch(outcome)
    }
    try {
      // Start 语义重启：launcher.cjs 自行处理 config/端口/ready/state/浏览器
      const child = spawn(plan.nodePath, [plan.launcherPath], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: process.env,
      })
      child.once('error', error => finish({ started: false, reason: messageOf(error) }))
      child.once('spawn', () => finish({ started: true }))
      child.unref()
    } catch (error) {
      finish({ started: false, reason: messageOf(error) })
    }
  }),
  waitHealthy: async (plan, expectedVersion) => {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    let lastReason = '未开始探测'
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${plan.serverPort}/api/health`, { signal: AbortSignal.timeout(1_000) })
        if (response.status === 200) {
          const body = JSON.parse(await response.text()) as { currentVersion?: unknown, pid?: unknown }
          if (body?.currentVersion === expectedVersion) return { ok: true, version: expectedVersion }
          if (Number.isInteger(body?.pid)) {
            // 起来了但版本不对：继续等到超时（可能是旧服务还没死透后新服务未接棒）
            lastReason = `服务已启动但版本为 ${String(body?.currentVersion ?? '未知')}（期望 ${expectedVersion}）`
          }
        } else {
          lastReason = `HTTP ${response.status}`
        }
      } catch (error) {
        lastReason = messageOf(error)
      }
      await defaultDelay(POLL_MS)
    }
    return { ok: false, version: null, reason: `${HEALTH_TIMEOUT_MS / 1000} 秒内未确认新服务健康：${lastReason}` }
  },
  extract: extractZip,
  delay: defaultDelay,
}

/** 更新器编排主流程；任何失败写 failed 状态后返回（不向上抛——detached 进程无人接异常）。 */
export async function runFromPlan(plan: UpdatePlan, overrides: Partial<UpdaterDeps> = {}): Promise<void> {
  const deps: UpdaterDeps = { ...defaultDeps, ...overrides }
  const fail = async (reason: string): Promise<void> => {
    await writeUpdateStatus(plan.dataDir, { state: 'failed', error: reason.slice(0, 500) }).catch(() => {})
  }
  try {
    await writeUpdateStatus(plan.dataDir, { state: 'backing_up', progress: null })

    // 1) 排空＋受控退出（SETUP-01 冻结语义；任何拒绝＝安全态：服务仍在运行，未动文件）
    const prepared = await deps.control.prepare(plan)
    if (!prepared.ok) {
      return await fail(`更新已停止：服务排空未通过（${prepared.reason ?? '未知原因'}）；服务仍在运行，未改动任何文件`)
    }
    const shutdownOutcome = await deps.control.shutdown(plan)
    if (!shutdownOutcome.ok) {
      return await fail(`更新已停止：服务优雅退出请求失败（${shutdownOutcome.reason ?? '未知原因'}）；服务仍在运行，未改动任何文件`)
    }
    const exited = await deps.waitServerExit(plan)
    if (!exited.ok) {
      return await fail(`更新已停止：旧服务未在限时内确认退出（${exited.reason ?? ''}）；未改动任何文件，请检查服务状态后重试`)
    }

    // 2) 换装前备份（UPD-BACKUP-BEFORE-SWAP）；失败不搬移任何文件
    const backupsRoot = resolve(plan.dataDir, 'backups')
    let backupDir: string
    try {
      backupDir = (await backupPreserveFiles(plan.packageRoot, plan.dataDir, backupsRoot, { keep: plan.backupKeep })).backupDir
    } catch (error) {
      return await fail(`更新前备份失败，已停止（未改动包文件）：${messageOf(error)}；服务已退出，请手动运行 Start.cmd 启动训练器`)
    }

    // 3) 换装（失败 performSwap 已自回滚；再核验 preserve，必要时从备份恢复）
    await writeUpdateStatus(plan.dataDir, { state: 'applying' })
    const extractDir = resolve(plan.dataDir, 'update-work', `${plan.attemptId}-extract`)
    const extractedRoot = await deps.extract(plan.zipPath, extractDir)
    const trashDir = resolve(plan.packageRoot, `.update-trash-${plan.attemptId}`)
    const snapshot = await snapshotPreserved(plan.packageRoot, plan.dataDir)
    try {
      await performSwap(plan.packageRoot, extractedRoot, trashDir)
    } catch (error) {
      const after = await verifyPreserved(plan.packageRoot, plan.dataDir, snapshot)
      let restoredNote = ''
      if (!after.ok) {
        const restore = await restorePreserveFromBackup(plan.packageRoot, plan.dataDir, backupDir).catch(() => ({ restored: [] as string[] }))
        restoredNote = `（preserve 已从备份恢复 ${restore.restored.length} 个文件）`
      }
      return await fail(`${messageOf(error)}${restoredNote}；请手动运行 Start.cmd 启动训练器`)
    }

    // 4) preserve 核验（F9 灾难兜底：恢复＋整体回滚）
    const preserved = await verifyPreserved(plan.packageRoot, plan.dataDir, snapshot)
    if (!preserved.ok) {
      await restorePreserveFromBackup(plan.packageRoot, plan.dataDir, backupDir).catch(() => {})
      await rollbackSwapFromTrash(plan, trashDir)
      return await fail(`换装后 preserve 核验失败（${preserved.missing.join('、')}），已从备份恢复并回滚旧包；请手动运行 Start.cmd 启动训练器`)
    }

    // 5) Start 语义重启＋健康版本核验
    await writeUpdateStatus(plan.dataDir, { state: 'restarting' })
    const relaunched = await deps.relaunch(plan)
    if (!relaunched.started) {
      return await fail(`包已更新到 ${plan.expectedVersion}，但自动重启失败（${relaunched.reason ?? '未知原因'}）；请手动运行 Start.cmd 启动训练器（历史训练数据已保留）`)
    }
    const healthy = await deps.waitHealthy(plan, plan.expectedVersion)
    if (!healthy.ok || healthy.version !== plan.expectedVersion) {
      return await fail(`包已更新到 ${plan.expectedVersion}，但新服务健康核验未通过（${healthy.reason ?? `版本 ${healthy.version ?? '未知'}`}）；请手动运行 Start.cmd 启动训练器（历史训练数据已保留）`)
    }

    // 6) 完成＋清理（best-effort：trash、下载 zip、解压目录；plan.json 留作证据）
    await writeUpdateStatus(plan.dataDir, { state: 'completed', error: null })
    await rm(trashDir, { recursive: true, force: true }).catch(() => {})
    await rm(plan.zipPath, { force: true }).catch(() => {})
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
  } catch (error) {
    await fail(`更新流程异常终止：${messageOf(error)}`)
  }
}

async function rollbackSwapFromTrash(plan: UpdatePlan, trashDir: string): Promise<void> {
  // placed 清单不可得时按 trash 现存内容回移（保守：新包文件若残留，覆盖前先移回旧文件）
  const moved = await walkFiles(trashDir).catch(() => [] as string[])
  await rollbackSwap(plan.packageRoot, trashDir, [], moved).catch(() => {})
}

/** 独立进程入口：node updater.js <plan.json 路径>（token 经 env 继承）。 */
async function main(argv: string[]): Promise<void> {
  const planPath = argv[0]
  if (!planPath) throw new Error('用法 / usage: node updater.js <plan.json>')
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as UpdatePlan
  for (const key of ['appId', 'attemptId', 'packageRoot', 'dataDir', 'zipPath', 'expectedVersion', 'launcherPath', 'nodePath'] as const) {
    if (typeof plan[key] !== 'string' || plan[key] === '') throw new Error(`plan.json 缺少字段 ${key}`)
  }
  if (plan.appId !== 'a-share-kline-trainer') throw new Error(`plan.json appId 不符：${plan.appId}`)
  await runFromPlan(plan)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
