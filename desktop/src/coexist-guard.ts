// PACK-03 双形态共存防双写裁决层（COEXIST-SAME-DATADIR-GUARD；纯函数＋全部可注入）。
// 口径镜像自 scripts/release/launcher.cjs 冻结语义（launcher 不入桌面包、禁改，故镜像重实现）：
//   - readOwnedState/assertStateIdentity（704-742）：appId 门＋runId run-<36hex>＋pid/port 范围＋baseURL 与 port 严格一致
//   - decideRecordedServer（773-788）：pid 死→clean；活且健康复核匹配→reuse；活但不可验证→拒绝（宁拒不双写）
//   - probeMatchesState：仅 200 且 runId/pid 双匹配计身份；PORT-02 三应答共用（reuse 复核/restart 复核 pid 一致才杀/cancel）
//   - acquireLaunchLock（803-827）：'wx' 独占＋死 pid 锁恢复＋5 轮上限；pidAlive（EPERM＝活）
//   - writeStateFile：desktop 内嵌服务启动后写同格式记录，zip launcher decideRecordedServer 可识别（反向防线）
import { isTrainerHealthBody, type ConflictAnswer, type HealthProbe, type TrainerIdentity } from './port-conflict.js'
import { join } from 'node:path'

export const STATE_FILE = 'trainer-state.json'
export const LAUNCH_LOCK_FILE = 'launch.lock'
export const STATE_APP_ID = 'a-share-kline-trainer'

export interface TrainerStateRecord {
  runId: string
  pid: number
  port: number
  baseURL: string
}

export type StateRecordParse =
  | { kind: 'absent' }
  | { kind: 'foreign' }
  | { kind: 'stale'; pid: number | null }
  | { kind: 'valid'; state: TrainerStateRecord }

const RUN_ID_PATTERN = /^run-[0-9a-f-]{36}$/

/** launcher assertStateIdentity 镜像（null/undefined→absent；appId 异己→foreign；身份破坏→stale 尽力留 pid） */
export function parseTrainerStateRecord(raw: unknown): StateRecordParse {
  if (raw === null || raw === undefined) return { kind: 'absent' }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'stale', pid: null }
  const value = raw as Record<string, unknown>
  if (value.appId !== STATE_APP_ID) return { kind: 'foreign' }
  const pid = Number.isInteger(value.pid) && (value.pid as number) >= 1 ? (value.pid as number) : null
  const identityOk =
    typeof value.runId === 'string' && RUN_ID_PATTERN.test(value.runId)
    && pid !== null
    && Number.isInteger(value.port) && (value.port as number) >= 1 && (value.port as number) <= 65535
    && value.baseURL === `http://127.0.0.1:${value.port}`
  if (identityOk) {
    return { kind: 'valid', state: { runId: value.runId as string, pid: pid!, port: value.port as number, baseURL: value.baseURL as string } }
  }
  return { kind: 'stale', pid }
}

export type CoexistDecision =
  | { action: 'proceed' }
  | { action: 'reuse'; url: string; occupant: TrainerIdentity }
  | { action: 'quit'; reason: string; fatal: boolean }

export interface CoexistDeps {
  pidAlive: (pid: number) => boolean
  probeHealth: (port: number) => Promise<HealthProbe>
  askConflict: (occupant: TrainerIdentity) => Promise<ConflictAnswer>
  killOccupant: (occupant: TrainerIdentity) => Promise<{ exited: boolean; error?: string }>
}

/** launcher probeMatchesState 镜像：仅 200 且训练器身份且 runId/pid 与记录双匹配 */
function probeMatchesState(probe: HealthProbe, state: TrainerStateRecord): boolean {
  return Boolean(probe.responded && probe.status === 200
    && isTrainerHealthBody(probe.json)
    && probe.json.runId === state.runId && probe.json.pid === state.pid)
}

function unverifiableOwnerReason(pid: number, port: number): string {
  return `已记录的训练服务进程仍在运行（PID ${pid}，端口 ${port}），但通过 127.0.0.1:${port}/api/health 无法确认它属于这条记录；`
    + `为避免两个服务写同一个数据库，本应用不会启动第二个服务。请先确认并结束该进程（任务管理器中的 PID ${pid}）后重试 / `
    + `a recorded trainer process is still alive (PID ${pid}, port ${port}) but does not answer as this record; `
    + `to avoid two writers on one database the desktop app refuses to start a second server — end that process first`
}

/**
 * dataDir 状态记录裁决（design.md §3.2 树）。调用方必须已持 launch.lock；
 * fatal=true 表示错误呈现（showErrorBox），fatal=false 表示用户主动取消（静默退出）。
 */
export async function decideCoexistence(record: StateRecordParse, deps: CoexistDeps): Promise<CoexistDecision> {
  if (record.kind === 'absent') return { action: 'proceed' }
  if (record.kind === 'foreign') {
    return {
      action: 'quit',
      fatal: true,
      reason: `数据目录内的服务状态文件属于其他应用，拒绝处理 / state file belongs to another app; refusing to start`,
    }
  }
  if (record.kind === 'stale') {
    if (record.pid !== null && deps.pidAlive(record.pid)) {
      return {
        action: 'quit',
        fatal: true,
        reason: `训练状态文件无法识别，但其中记录的进程（PID ${record.pid}）仍在运行；为避免双写数据库拒绝启动。`
          + `请确认后结束该进程，或确认它不是训练器后手动删除状态文件 / the state file is unreadable but its recorded `
          + `process (PID ${record.pid}) is still alive; refusing to start a second writer`,
      }
    }
    // 残留记录（pid 死/缺失）：放行；desktop 绝不删除非自有记录（launcher 下次启动按 clean 口径自理）
    return { action: 'proceed' }
  }

  // valid
  const state = record.state
  if (!deps.pidAlive(state.pid)) return { action: 'proceed' }

  const probe = await deps.probeHealth(state.port)
  if (!probeMatchesState(probe, state)) {
    return { action: 'quit', fatal: true, reason: unverifiableOwnerReason(state.pid, state.port) }
  }

  const occupant: TrainerIdentity = { pid: state.pid, port: state.port, runId: state.runId }
  const answer = await deps.askConflict(occupant)
  if (answer === 'cancel') {
    return {
      action: 'quit',
      fatal: false,
      reason: `coexist-cancel: data directory is served by trainer PID ${occupant.pid} on port ${occupant.port}; user chose to exit`,
    }
  }
  if (answer === 'reuse') {
    // 复核：应答期间占用者可能已退出；仍匹配→直接用其 URL（绝不启第二个服务）
    const recheck = await deps.probeHealth(state.port)
    if (probeMatchesState(recheck, state)) return { action: 'reuse', url: state.baseURL, occupant }
    return { action: 'proceed' }
  }
  // restart：复核身份一致才杀（不杀不明进程）；杀失败/未退出即拒绝启动
  const recheck = await deps.probeHealth(state.port)
  if (probeMatchesState(recheck, state)) {
    const killed = await deps.killOccupant(occupant)
    if (!killed.exited) {
      return {
        action: 'quit',
        fatal: true,
        reason: `coexist-restart-failed: could not stop trainer PID ${occupant.pid} on port ${occupant.port}${killed.error ? ` (${killed.error})` : ''}; start aborted`,
      }
    }
  }
  // 占用者已消失或身份变化 → 不杀，放行
  return { action: 'proceed' }
}

// ===== 状态记录写入（反向防线：zip launcher decideRecordedServer 可识别） =====

export interface DesktopStateRecord {
  appId: string
  runId: string
  pid: number
  port: number
  baseURL: string
  startedAt: string
  databasePath: string
}

/** 产出满足 launcher assertStateIdentity 全部校验的记录体（appId/runId/pid/port/baseURL 严格一致） */
export function buildStateRecord(input: { runId: string; pid: number; port: number; databasePath: string; startedAt?: string }): DesktopStateRecord {
  return {
    appId: STATE_APP_ID,
    runId: input.runId,
    pid: input.pid,
    port: input.port,
    baseURL: `http://127.0.0.1:${input.port}`,
    startedAt: input.startedAt ?? new Date().toISOString(),
    databasePath: input.databasePath,
  }
}

/** 退出清理身份复核：仅当文件内容仍是本进程 runId+pid 时才允许删除（绝不删他人记录） */
export function stateRecordIsOurs(raw: unknown, identity: { runId: string; pid: number }): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const value = raw as Record<string, unknown>
  return value.appId === STATE_APP_ID && value.runId === identity.runId && value.pid === identity.pid
}

// ===== launch.lock（launcher acquireLaunchLock 镜像） =====

export type LaunchLockResult = { ok: true; path: string } | { ok: false; reason: string }

export interface LaunchLockDeps {
  /** 'wx' 独占创建并写入 {appId,pid,startedAt}；EEXIST 等失败如实返回 */
  openExclusive: (path: string) => Promise<{ ok: boolean; code?: string }>
  readLockInfo: (path: string) => Promise<unknown>
  removeFile: (path: string) => Promise<void>
  pidAlive: (pid: number) => boolean
  waitMs?: number
  lockWaitMs?: number
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

/**
 * 取启动锁（≤5 轮）：锁文件可识别且 pid 已死→删除重试；可识别且存活→有界等待持有者释放；
 * 不可识别/异己/反复出现→拒绝（不猜）。与 zip launcher 的 start/stop 互斥（同一把锁文件）。
 */
export async function acquireLaunchLock(lockPath: string, deps: LaunchLockDeps): Promise<LaunchLockResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const opened = await deps.openExclusive(lockPath)
    if (opened.ok) return { ok: true, path: lockPath }
    // 非 EEXIST 失败（目录缺失/不可写等）＝创建失败，直接如实拒绝（launcher 口径：无法创建启动锁）
    if (opened.code && opened.code !== 'EEXIST') {
      return { ok: false, reason: `无法创建启动锁 / cannot create launch lock ${lockPath}: ${opened.code}` }
    }

    const existing = await deps.readLockInfo(lockPath)
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      const info = existing as Record<string, unknown>
      if (info.appId === STATE_APP_ID && Number.isInteger(info.pid) && (info.pid as number) >= 1) {
        if (!deps.pidAlive(info.pid as number)) {
          await deps.removeFile(lockPath)
          continue
        }
        // 活锁：有界等待持有者释放（launcher start/stop 都是短事务；readLockInfo 在锁文件消失时返回 null）
        const deadline = Date.now() + (deps.lockWaitMs ?? 3_000)
        let released = false
        while (Date.now() < deadline) {
          await sleep(deps.waitMs ?? 150)
          if ((await deps.readLockInfo(lockPath)) === null) { released = true; break }
        }
        if (released) { await sleep(deps.waitMs ?? 150); continue }
        return { ok: false, reason: `另一个启动/停止进程仍在进行（PID ${info.pid}）／ another launch or stop is in progress (PID ${info.pid})` }
      }
      return { ok: false, reason: `存在无法识别的启动锁 ${lockPath}；确认没有其他训练器窗口后可手动删除该文件 / unrecognized launch lock ${lockPath}` }
    }
    return { ok: false, reason: `存在无法识别的启动锁 ${lockPath}；确认没有其他训练器窗口后可手动删除该文件 / unrecognized launch lock ${lockPath}` }
  }
  return { ok: false, reason: `启动锁反复被占用 / launch lock at ${lockPath} kept reappearing` }
}

/** 锁文件路径助手（与 launcher 同名同位置：<dataDir>/launch.lock） */
export function launchLockPathOf(dataDir: string): string {
  return join(dataDir, LAUNCH_LOCK_FILE)
}
