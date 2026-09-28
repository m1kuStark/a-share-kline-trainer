import type { DatabaseSync } from 'node:sqlite'

// M5-DEFAULTS-01：创建默认资金/复权的持久读取。
// 纯数据库读取与域校验，不依赖引擎/HTTP 类型（engine.ts 反向引用本模块，避免循环依赖）。
// 契约：缺键＝内建默认；已有损坏键不是缺键——由调用方映射为可行动的
// 409 TRAINING_DEFAULTS_UNREADABLE，本模块不做自动修复。

export interface CreationDefaults {
  initialCash: number
  adjustMode: 'forward' | 'raw'
}

export type CreationDefaultsRead =
  | { ok: true; defaults: CreationDefaults }
  | { ok: false; corruptKeys: string[] }

export const DEFAULT_INITIAL_CASH = 1_000_000
export const INITIAL_CASH_MIN = 0.01
export const INITIAL_CASH_MAX = 1_000_000_000

/** 资金域：数字、有限、0.01..1,000,000,000、至多两位小数（不取整/不截断）。 */
export function isInitialCashInDomain(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < INITIAL_CASH_MIN || value > INITIAL_CASH_MAX) return false
  const cents = value * 100
  return Math.abs(cents - Math.round(cents)) <= 1e-9
}

function readStoredValue(database: DatabaseSync, key: string): string | null {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined
  return row?.value ?? null
}

function readInitialCash(database: DatabaseSync): { state: 'missing' } | { state: 'ok'; value: number } | { state: 'corrupt' } {
  const raw = readStoredValue(database, 'training_initial_cash')
  if (raw === null) return { state: 'missing' }
  const value = Number(raw)
  if (!isInitialCashInDomain(value)) return { state: 'corrupt' }
  return { state: 'ok', value }
}

function readAdjustMode(database: DatabaseSync): { state: 'missing' } | { state: 'ok'; value: 'forward' | 'raw' } | { state: 'corrupt' } {
  const raw = readStoredValue(database, 'training_adjust_mode')
  if (raw === null) return { state: 'missing' }
  if (raw !== 'forward' && raw !== 'raw') return { state: 'corrupt' }
  return { state: 'ok', value: raw }
}

/** 读取创建默认（资金/复权）。缺键给内建默认；损坏键汇总返回，由调用方决定 409/修复入口。 */
export function readCreationDefaults(database: DatabaseSync): CreationDefaultsRead {
  const cash = readInitialCash(database)
  const mode = readAdjustMode(database)
  const corruptKeys: string[] = []
  if (cash.state === 'corrupt') corruptKeys.push('training_initial_cash')
  if (mode.state === 'corrupt') corruptKeys.push('training_adjust_mode')
  if (corruptKeys.length > 0) return { ok: false, corruptKeys }
  return {
    ok: true,
    defaults: {
      initialCash: cash.state === 'ok' ? cash.value : DEFAULT_INITIAL_CASH,
      adjustMode: mode.state === 'ok' ? mode.value : 'forward',
    },
  }
}

/** 宽松读取：ok 或 missing 给默认值；损坏键的字段以 undefined 表示（供旧客户端兼容响应使用）。 */
export function readCreationDefaultsLenient(database: DatabaseSync): { initialCash?: number; adjustMode?: 'forward' | 'raw' } {
  const cash = readInitialCash(database)
  const mode = readAdjustMode(database)
  return {
    ...(cash.state === 'ok' ? { initialCash: cash.value } : cash.state === 'missing' ? { initialCash: DEFAULT_INITIAL_CASH } : {}),
    ...(mode.state === 'ok' ? { adjustMode: mode.value } : mode.state === 'missing' ? { adjustMode: 'forward' as const } : {}),
  }
}
