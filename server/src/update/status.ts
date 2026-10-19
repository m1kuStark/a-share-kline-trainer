// UPD-01 更新状态文件（dataDir/update-status.json）。
// 状态文件跨"旧服务退出→新服务启动"窗口可读（SETUP-01 restart-status 同款模式）；
// 不含路径与控制令牌；写入手势为临时文件＋原子 rename。

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const APP_ID = 'a-share-kline-trainer'
export const STATUS_FILE = 'update-status.json'

export const UPDATE_STATES = ['idle', 'downloading', 'verifying', 'backing_up', 'applying', 'restarting', 'completed', 'failed'] as const
export type UpdateState = typeof UPDATE_STATES[number]

const BUSY_STATES: readonly UpdateState[] = ['downloading', 'verifying', 'backing_up', 'applying', 'restarting']

export interface UpdateStatusRecord {
  version: 1
  appId: string
  attemptId: string | null
  state: UpdateState
  progress?: number | null
  error?: string | null
  fromVersion?: string | null
  targetVersion?: string | null
  updatedAt: string
}

export function isBusyUpdateState(state: UpdateState): boolean {
  return BUSY_STATES.includes(state)
}

export async function readUpdateStatus(dataDir: string | null): Promise<UpdateStatusRecord | null> {
  if (!dataDir) return null
  let raw: string
  try {
    raw = await readFile(join(dataDir, STATUS_FILE), 'utf8')
  } catch {
    return null
  }
  let value: Record<string, unknown>
  try {
    value = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  if (typeof value.state !== 'string' || !(UPDATE_STATES as readonly string[]).includes(value.state)) return null
  return {
    version: 1,
    appId: APP_ID,
    attemptId: typeof value.attemptId === 'string' ? value.attemptId : null,
    state: value.state as UpdateState,
    progress: typeof value.progress === 'number' ? value.progress : null,
    error: typeof value.error === 'string' ? value.error : null,
    fromVersion: typeof value.fromVersion === 'string' ? value.fromVersion : null,
    targetVersion: typeof value.targetVersion === 'string' ? value.targetVersion : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }
}

/** 合并式原子写入：patch 里的键（含显式 null）覆盖旧值；attemptId/state 缺省沿用旧值。 */
export async function writeUpdateStatus(dataDir: string, patch: Partial<UpdateStatusRecord>): Promise<UpdateStatusRecord> {
  const existing = await readUpdateStatus(dataDir)
  const base: UpdateStatusRecord = existing ?? {
    version: 1, appId: APP_ID, attemptId: null, state: 'idle',
    progress: null, error: null, fromVersion: null, targetVersion: null,
    updatedAt: new Date().toISOString(),
  }
  const record: UpdateStatusRecord = {
    ...base,
    ...patch,
    appId: APP_ID,
    version: 1,
    state: patch.state ?? base.state,
    attemptId: patch.attemptId ?? base.attemptId,
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, STATUS_FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`)
  await rename(temporary, path)
  return record
}

/**
 * 状态补全协调：更新器在 'restarting' 后死亡（没能确认健康）的兜底——
 * 当前运行版本已等于目标版本时就地升级为 completed；版本不匹配时保持原样
 * （不冒充完成）。GET /api/update/status 与 apply 的忙判定共用。
 *
 * UPD-BUSY-HEAL-01：可选陈旧 busy 自愈——更新器/服务在 busy 态被杀（杀软误杀
 * detached 更新器、断电等已知根因）后状态文件残留 busy，apply 会永久 409 自锁。
 * 传 staleBusyMs 时，busy 态且 updatedAt 超过阈值（无活跃 attempt 的代理信号——
 * 更新器各阶段全部有界：server 退出 20s＋端口排空 10s＋健康核验 40s，服务端下载
 * 由 900s 总预算＋activeAttempt 内存守卫覆盖，均远小于默认阈值）→ 复位 failed
 * （人话原因落日志）。restarting→completed 分支在前，不受自愈影响（不误伤）。
 */
export async function reconcileUpdateStatus(dataDir: string | null, currentVersion: string | null, options: ReconcileOptions = {}): Promise<UpdateStatusRecord | null> {
  const record = await readUpdateStatus(dataDir)
  if (!record) return null
  if (record.state === 'restarting' && dataDir && currentVersion && record.targetVersion && currentVersion === record.targetVersion) {
    return writeUpdateStatus(dataDir, { state: 'completed', error: null })
  }
  if (dataDir && options.staleBusyMs !== undefined && options.staleBusyMs > 0
    && isBusyUpdateState(record.state) && isStaleBusyUpdatedAt(record.updatedAt, options.staleBusyMs)) {
    const reason = staleBusyResetMessage(record.state, options.staleBusyMs)
    options.log?.error(`[update] 陈旧 busy 状态自愈（UPD-BUSY-HEAL-01，state=${record.state}）：${reason}`)
    return writeUpdateStatus(dataDir, { state: 'failed', error: reason })
  }
  return record
}

/** reconcile 的自愈选项（缺省不启用——只保留 restarting→completed 既有语义）。 */
export interface ReconcileOptions {
  /** 陈旧 busy 判定阈值毫秒；未传＝不自愈。 */
  staleBusyMs?: number
  /** 自愈原因落日志（与 registerUpdateApi 的 log 注入面同形）。 */
  log?: { error(...args: unknown[]): void }
}

/** UPD-BUSY-HEAL-01：陈旧 busy 判定缺省阈值（冷审 G1 建议 30 分钟；proposed_default）。 */
export const DEFAULT_STALE_BUSY_MS = 30 * 60_000

/**
 * 阈值解析：env TRAINER_UPDATE_STALE_BUSY_MS（正整数毫秒）可覆盖（测试/诊断注入小值）；
 * 空/非数字/0/负一律回默认——坏 env 不放宽守卫（fail-closed，与 DL-HANG-01 看门狗
 * env 解析同款）。
 */
export function resolveStaleBusyMs(env: { [name: string]: string | undefined }, defaultMs: number = DEFAULT_STALE_BUSY_MS): number {
  const raw = typeof env.TRAINER_UPDATE_STALE_BUSY_MS === 'string' ? env.TRAINER_UPDATE_STALE_BUSY_MS.trim() : ''
  if (raw === '') return defaultMs
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return defaultMs
}

/**
 * updatedAt 是否已超阈值。缺字段/不可解析 → false（视为新鲜，fail-closed：年龄不可
 * 判定的记录不自动复位，守卫保持；readUpdateStatus 对缺字段的既有归一＝now，同向）。
 */
export function isStaleBusyUpdatedAt(updatedAt: string | null | undefined, staleBusyMs: number): boolean {
  if (typeof updatedAt !== 'string' || updatedAt === '') return false
  const time = Date.parse(updatedAt)
  if (!Number.isFinite(time)) return false
  return Date.now() - time >= staleBusyMs
}

const BUSY_STATE_LABELS: Record<string, string> = {
  downloading: '下载中',
  verifying: '校验中',
  backing_up: '备份中',
  applying: '安装中',
  restarting: '重启中',
}

/** 陈旧 busy 复位的人话原因（文案＝proposed_default；含状态名与已超时长的分钟数）。 */
export function staleBusyResetMessage(state: UpdateState, staleBusyMs: number): string {
  const minutes = Math.max(1, Math.round(staleBusyMs / 60_000))
  const label = BUSY_STATE_LABELS[state] ?? state
  return `检测到上次更新流程异常中断（状态停留在${label}超过 ${minutes} 分钟无进展），已自动复位为失败；可能是更新器被系统或杀毒软件终止、或电脑断电所致。可直接重新发起更新，历史训练数据不受影响`
}
