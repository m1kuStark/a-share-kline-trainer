// PACK-02 端口决策层（DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK / DESKTOP-PORT-CONFLICT-TRAINER-ASK）。
// 口径镜像自 scripts/release/launcher.cjs 冻结语义（launcher 不入桌面包、禁改，故镜像重实现）：
//   - isTrainerHealth 三字段身份：status==='ok' && typeof runId==='string' && Number.isInteger(pid)
//   - probeHealth：仅 127.0.0.1、重定向即拒（redirects:'error'）、仅 HTTP 200 计身份
//   - PORT-01：bind 探测（EACCES→reserved，其他→occupied）＋preferred+1 起向上至多 40 次找首个可 bind
//   - PORT-02：reuse＝复核存活后不启第二进程；restart＝复核 pid 一致才杀→等退出＋端口释放
//   - 桌面第三应答 cancel（PACK-02 派发简报决策③）；应答可注入 env（对齐 launcher --conflict-answer）
// P0-4（PORT-UPD-01）：probeHealthHttp 换 server 侧 safe-http 原生网络层产物（与
// portable-updater.ts 引用 server/dist/update/version.js 同一 import 模式）——全局
// fetch（undici）在响应流截断时以内部断言崩溃 Electron 主进程（用户真机弹窗证据），
// 原生层把同类截断转为受控失败。
import net from 'node:net'
import { spawn } from 'node:child_process'
import { safeRequest } from '../../server/dist/update/safe-http.js'

export const FALLBACK_ATTEMPTS = 40

// PORT-COEXIST-V127-NODE：重启分支杀后等端口真释放的预算与节奏
export const PORT_RELEASE_WAIT_MS = 3_000
export const PORT_RELEASE_POLL_MS = 100
// PORT-COEXIST-V127-NODE：树终止后等待占用者退出的预算（沿用旧单 PID kill 的 5s 口径）
export const KILL_EXIT_TIMEOUT_MS = 5_000

/** 训练器占用者身份（launcher occupant 同构） */
export interface TrainerIdentity {
  pid: number
  port: number
  runId: string
}

export type HealthProbe = {
  responded: boolean
  refused: boolean
  status: number | null
  json: unknown
}

export interface BindState {
  ok: boolean
  code?: string
}

export type ConflictAnswer = 'reuse' | 'restart' | 'cancel'

export interface PortFallback {
  from: number
  reason: 'reserved' | 'occupied'
}

export type PortPlan =
  | { action: 'start'; port: number; fallback: PortFallback | null }
  | { action: 'reuse'; port: number; url: string; occupant: TrainerIdentity }
  | { action: 'quit'; reason: string }

/** launcher isTrainerHealth 镜像：health 体身份判定（附加字段如 currentVersion 不影响） */
export function isTrainerHealthBody(value: unknown): value is { status: 'ok'; runId: string; pid: number } {
  return Boolean(value && typeof value === 'object'
    && (value as { status?: unknown }).status === 'ok'
    && typeof (value as { runId?: unknown }).runId === 'string'
    && Number.isInteger((value as { pid?: unknown }).pid))
}

/** TRAINER_DESKTOP_CONFLICT_ANSWER 严格解析：unset/空白→null；非法值报错不猜（launcher --conflict-answer 同口径） */
export function parseConflictAnswerEnv(env: NodeJS.ProcessEnv): ConflictAnswer | null {
  const raw = env.TRAINER_DESKTOP_CONFLICT_ANSWER?.trim()
  if (!raw) return null
  if (raw !== 'reuse' && raw !== 'restart' && raw !== 'cancel') {
    throw new Error(`TRAINER_DESKTOP_CONFLICT_ANSWER only accepts reuse|restart|cancel, got: ${raw}`)
  }
  return raw
}

/** bind 失败原因：EACCES＝系统保留段，其他＝被占用（launcher portUnavailableMessage 口径） */
export function portUnavailableReason(code: string | undefined): 'reserved' | 'occupied' {
  return code === 'EACCES' ? 'reserved' : 'occupied'
}

/** preferred+1 起向上找首个可 bind 端口（preferred 自身从不在候选内）；越界或耗尽返回 null */
export async function pickFallbackPort(
  preferred: number,
  bindCheck: (port: number) => Promise<BindState>,
  attempts: number = FALLBACK_ATTEMPTS,
): Promise<number | null> {
  for (let offset = 1; offset <= attempts; offset += 1) {
    const candidate = preferred + offset
    if (candidate > 65535) return null
    const state = await bindCheck(candidate)
    if (state.ok) return candidate
  }
  return null
}

/** TRAINER_PORT_FALLBACK 严格格式（server/src/config.ts parsePortFallback 同构） */
export function portFallbackEnvValue(fallback: PortFallback | null): string {
  return fallback ? `${fallback.from},${fallback.reason}` : ''
}

export interface PortPlanDeps {
  probeHealth: (port: number) => Promise<HealthProbe>
  bindCheck: (port: number) => Promise<BindState>
  askConflict: (occupant: TrainerIdentity) => Promise<ConflictAnswer>
  killOccupant: (occupant: TrainerIdentity) => Promise<{ exited: boolean; error?: string }>
  fallbackAttempts?: number
  /** PORT-COEXIST-V127-NODE：杀后等端口真释放的预算（毫秒）；缺省 PORT_RELEASE_WAIT_MS */
  portReleaseWaitMs?: number
}

/** 端口决策编排（探测全部可注入；决策树见 docs/verification/2026-10/PACK-02/design.md §二 S3） */
export async function resolvePortPlan(desiredPort: number, deps: PortPlanDeps): Promise<PortPlan> {
  const probe = await deps.probeHealth(desiredPort)
  const body = probe.responded && probe.status === 200 ? probe.json : null
  if (isTrainerHealthBody(body) && body.pid > 0) {
    const occupant: TrainerIdentity = { pid: body.pid, port: desiredPort, runId: body.runId }
    const answer = await deps.askConflict(occupant)
    if (answer === 'cancel') {
      return { action: 'quit', reason: `conflict-cancel: port ${desiredPort} is served by trainer PID ${occupant.pid}; user chose to exit` }
    }
    if (answer === 'reuse') {
      // 复核：应答期间占用者可能已退出；仍存活→直接用其 URL（绝不启第二个服务进程）
      const recheck = await deps.probeHealth(desiredPort)
      if (recheck.responded && recheck.status === 200 && isTrainerHealthBody(recheck.json)) {
        return {
          action: 'reuse',
          port: desiredPort,
          url: `http://127.0.0.1:${desiredPort}`,
          occupant: { pid: recheck.json.pid, port: desiredPort, runId: recheck.json.runId },
        }
      }
      // 占用者消失 → 落入 bind 裁决
    } else {
      // restart：复核身份一致才杀（不杀不明进程）；杀失败/未退出即中止启动
      const recheck = await deps.probeHealth(desiredPort)
      if (recheck.responded && recheck.status === 200 && isTrainerHealthBody(recheck.json)
        && recheck.json.pid === occupant.pid) {
        const killed = await deps.killOccupant(occupant)
        if (!killed.exited) {
          return {
            action: 'quit',
            reason: `conflict-restart-failed: could not stop trainer PID ${occupant.pid} on port ${desiredPort}${killed.error ? ` (${killed.error})` : ''}; start aborted`,
          }
        }
        // PORT-COEXIST-V127-NODE：杀成功≠端口已释放（进程 teardown/AV/WFP 有真实时延；
        // 端口被别的监听者接住也会出现）。有界轮询真释放，超限人话中止——绝不在
        // 「用户刚要求关闭并重启」的语境下静默换端口（半途）。
        const releaseDeadline = Date.now() + (deps.portReleaseWaitMs ?? PORT_RELEASE_WAIT_MS)
        let released = false
        for (;;) {
          if ((await deps.bindCheck(desiredPort)).ok) {
            released = true
            break
          }
          if (Date.now() >= releaseDeadline) break
          await new Promise(resolve => setTimeout(resolve, PORT_RELEASE_POLL_MS))
        }
        if (!released) {
          return {
            action: 'quit',
            reason: `conflict-restart-port-held: trainer PID ${occupant.pid} was terminated but port ${desiredPort} is still occupied (another listener or a slow release); start aborted instead of silently switching ports — check netstat -ano | findstr :${desiredPort} and retry`,
          }
        }
      }
      // 占用者已消失或身份变化 → 不杀，落入 bind 裁决（无释放等待：未被本进程杀过）
    }
  }

  const bind = await deps.bindCheck(desiredPort)
  if (bind.ok) return { action: 'start', port: desiredPort, fallback: null }
  const reason = portUnavailableReason(bind.code)
  const picked = await pickFallbackPort(desiredPort, deps.bindCheck, deps.fallbackAttempts ?? FALLBACK_ATTEMPTS)
  if (picked === null) {
    return {
      action: 'quit',
      reason: `port ${desiredPort} and ${deps.fallbackAttempts ?? FALLBACK_ATTEMPTS} nearby ports above are all unavailable (${reason}); cannot pick a port automatically`,
    }
  }
  return { action: 'start', port: picked, fallback: { from: desiredPort, reason } }
}

// ===== PORT-COEXIST-V127-NODE：训练器占用者按进程树终止（决策层可注入；真实实现见下） =====
//
// 背景（2026-10-11 用户真机验收）：v1.2.7 zip 形态进程链＝Start.cmd(cmd.exe)→node(launcher.cjs)
// →detached node(server/dist/index.js)，另有 SETUP-01 受控重启监管形态（launcher
// --setup-restart-attempt 会拉起新服务进程）。单 PID kill 对「服务带子进程/监管者」的形态
// 会留残余、甚至被监管者重启。身份纪律不变：只对已通过 health 身份复核（pid 一致）的
// 训练器 PID 做树终止——杀的是「该训练器的进程树」（pid＋其后代），绝不向树外发信号。

export type TreeKillOutcome = { ok: boolean; notFound?: boolean; error?: string }

export interface TreeKillDeps {
  runTreeKill: (pid: number) => Promise<TreeKillOutcome>
  pidAlive: (pid: number) => boolean
  /** 等待退出的预算（毫秒）；缺省 KILL_EXIT_TIMEOUT_MS（5s，沿用旧口径） */
  timeoutMs?: number
  /** 退出轮询间隔（毫秒）；缺省 150ms */
  pollIntervalMs?: number
}

/** 按进程树终止已验证的训练器占用者并等其退出；失败/超时如实返回，不假装成功。 */
export async function killTrainerTree(
  pid: number,
  deps: TreeKillDeps,
): Promise<{ exited: boolean; error?: string }> {
  const killResult = await deps.runTreeKill(pid)
  if (!killResult.ok && !killResult.notFound) {
    return {
      exited: false,
      error: killResult.error ? `tree kill failed: ${killResult.error}` : 'tree kill failed with no detail',
    }
  }
  const timeoutMs = deps.timeoutMs ?? KILL_EXIT_TIMEOUT_MS
  const pollIntervalMs = deps.pollIntervalMs ?? 150
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!deps.pidAlive(pid)) return { exited: true }
    if (Date.now() > deadline) {
      return { exited: false, error: `PID ${pid} did not exit within ${timeoutMs}ms after the tree kill` }
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }
}

/** launcher pidAlive 镜像：EPERM＝活（无权限发信号≠进程不存在） */
export function realPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// 守卫取值依据（2026-10-12 实测）：本机 taskkill /T /F 对真实 v1.2.7 占用者的完整耗时
// ~6.6s（单元测试两级 node 树同样 ~6.5s——固有枚举/WMI 级延迟，非树规模问题）；e2e 在
// 负载下实测可超 8s 触发误报守卫。取 4 倍余量 30s：够真实树终止完成，仍保证有界。
export const TASKKILL_GUARD_MS = 30_000

/**
 * Windows 树终止：主进程普通 spawn `taskkill /PID <pid> /T /F`（不 detached、不挂 cmd 壳，
 * stdio 全管道——P0-6 的挂死教训仅限 detached 隐藏 cmd 脚本内的探活循环，不适用本形态）。
 * 退出码 0＝树已终止；128＝进程不存在（目标已达成）；其他＝失败并带 taskkill 输出摘要。
 * 非 Windows 回退单 PID process.kill（本工程 Windows-only，此分支仅为可移植测试兜底）。
 */
export function taskkillTreeKillWindows(pid: number): Promise<TreeKillOutcome> {
  if (process.platform !== 'win32') {
    return new Promise(resolve => {
      try {
        process.kill(pid)
        resolve({ ok: true })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        resolve(code === 'ESRCH' ? { ok: false, notFound: true } : { ok: false, error: String((error as Error)?.message ?? error) })
      }
    })
  }
  return new Promise(resolve => {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk })
    child.stderr?.on('data', chunk => { output += chunk })
    const guard = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      resolve({ ok: false, error: `taskkill did not finish within ${TASKKILL_GUARD_MS}ms` })
    }, TASKKILL_GUARD_MS)
    child.once('error', error => {
      clearTimeout(guard)
      resolve({ ok: false, error: String((error as Error)?.message ?? error) })
    })
    child.once('close', code => {
      clearTimeout(guard)
      if (code === 0) return resolve({ ok: true })
      if (code === 128) return resolve({ ok: false, notFound: true })
      resolve({ ok: false, error: `taskkill exited with code ${code}${output.trim() ? `: ${output.trim().slice(0, 300)}` : ''}` })
    })
  })
}

// ===== 真实探测实现（main.ts 粘合用；决策函数不依赖此处，单测全部注入桩） =====

const HEALTH_TIMEOUT_MS = 1_200

/** launcher probeHealth 镜像：127.0.0.1 专用、重定向即拒（redirects:'error'）、仅 200 计身份 */
export async function probeHealthHttp(port: number): Promise<HealthProbe> {
  try {
    const response = await safeRequest(`http://127.0.0.1:${port}/api/health`, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      timeoutMessage: '健康探测超时（1.2 秒）',
      redirects: 'error',
    })
    let json: unknown = null
    if (response.status === 200) {
      try { json = JSON.parse(await response.text()) } catch { json = null }
    } else {
      response.discard()
    }
    return { responded: true, refused: false, status: response.status, json }
  } catch (error) {
    // 原生层请求错误直接携带 code（fetch 时代在 cause 内）；连接拒绝＝端口空闲
    const code = (error as NodeJS.ErrnoException)?.code
    return {
      responded: false,
      refused: code === 'ECONNREFUSED',
      status: null,
      json: null,
    }
  }
}

/** launcher bindCheckPort 镜像：真实 bind 探测（自身先占后放） */
export function bindCheckTcp(port: number): Promise<BindState> {
  return new Promise(resolve => {
    const probe = net.createServer()
    const settle = (result: BindState) => {
      probe.removeAllListeners('listening')
      probe.removeAllListeners('error')
      resolve(result)
    }
    probe.once('error', error => settle({ ok: false, code: (error as NodeJS.ErrnoException).code ?? 'EUNKNOWN' }))
    probe.once('listening', () => { probe.close(() => settle({ ok: true })) })
    probe.listen(port, '127.0.0.1')
  })
}
