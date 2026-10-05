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
 */
export async function reconcileUpdateStatus(dataDir: string | null, currentVersion: string | null): Promise<UpdateStatusRecord | null> {
  const record = await readUpdateStatus(dataDir)
  if (!record || record.state !== 'restarting') return record
  if (dataDir && currentVersion && record.targetVersion && currentVersion === record.targetVersion) {
    return writeUpdateStatus(dataDir, { state: 'completed', error: null })
  }
  return record
}
