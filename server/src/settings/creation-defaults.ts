import type { DatabaseSync } from 'node:sqlite'

// M5-DEFAULTS-01：创建默认资金/复权的持久读取。
// 纯数据库读取与域校验，不依赖引擎/HTTP 类型（engine.ts 反向引用本模块，避免循环依赖）。
// 契约：缺键＝内建默认；已有损坏键不是缺键——由调用方映射为可行动的
// 409 TRAINING_DEFAULTS_UNREADABLE，本模块不做自动修复。
// 返修 F1（control-handoff-20260928-51）：提供按字段粒度的读取结果——只实际依赖的字段
// 才能阻断创建/预览，无关字段的损坏不扩散。
// 返修 F3：至多两位小数按十进制字符串语义判定（Number.toString 的最短表示），
// 不用浮点容差——固定 epsilon 既误拒 10000000.03 又放过 0.010000000001。

export interface CreationDefaults {
  initialCash: number
  adjustMode: 'forward' | 'raw'
}

export const DEFAULT_INITIAL_CASH = 1_000_000
export const INITIAL_CASH_MIN = 0.01
export const INITIAL_CASH_MAX = 1_000_000_000

export type FieldState<T> = { state: 'missing' } | { state: 'ok'; value: T } | { state: 'corrupt' }

/** 资金域：数字、有限、0.01..1,000,000,000、至多两位十进制小数（不取整/不截断）。
 * 小数位按 Number 最短字符串表示判定（无指数记数法），规避二进制浮点容差漏洞。 */
export function isInitialCashInDomain(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < INITIAL_CASH_MIN || value > INITIAL_CASH_MAX) return false
  return hasAtMostTwoDecimalPlaces(value)
}

/** 十进制语义：至多两位小数。基于 Number 的最短字符串表示（科学记数法一律拒绝）。 */
export function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return false
  const dot = text.indexOf('.')
  return dot === -1 || text.length - dot - 1 <= 2
}

function readStoredValue(database: DatabaseSync, key: string): string | null {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined
  return row?.value ?? null
}

function readInitialCash(database: DatabaseSync): FieldState<number> {
  const raw = readStoredValue(database, 'training_initial_cash')
  if (raw === null) return { state: 'missing' }
  const value = Number(raw)
  if (!isInitialCashInDomain(value)) return { state: 'corrupt' }
  return { state: 'ok', value }
}

function readAdjustMode(database: DatabaseSync): FieldState<'forward' | 'raw'> {
  const raw = readStoredValue(database, 'training_adjust_mode')
  if (raw === null) return { state: 'missing' }
  if (raw !== 'forward' && raw !== 'raw') return { state: 'corrupt' }
  return { state: 'ok', value: raw }
}

/** 按字段粒度的读取结果：调用方只对实际依赖字段的 corrupt 阻断（返修 F1）。 */
export interface CreationDefaultsFieldRead {
  cash: FieldState<number>
  mode: FieldState<'forward' | 'raw'>
}

export function readCreationDefaultsFields(database: DatabaseSync): CreationDefaultsFieldRead {
  return { cash: readInitialCash(database), mode: readAdjustMode(database) }
}

/** 聚合读取：两字段均可用时返回默认，任一损坏则汇总键名（供 GET 全量视图使用）。 */
export function readCreationDefaults(database: DatabaseSync): CreationDefaultsRead {
  const fields = readCreationDefaultsFields(database)
  const corruptKeys: string[] = []
  if (fields.cash.state === 'corrupt') corruptKeys.push('training_initial_cash')
  if (fields.mode.state === 'corrupt') corruptKeys.push('training_adjust_mode')
  if (corruptKeys.length > 0) return { ok: false, corruptKeys }
  return {
    ok: true,
    defaults: {
      initialCash: fields.cash.state === 'ok' ? fields.cash.value : DEFAULT_INITIAL_CASH,
      adjustMode: fields.mode.state === 'ok' ? fields.mode.value : 'forward',
    },
  }
}

export type CreationDefaultsRead =
  | { ok: true; defaults: CreationDefaults }
  | { ok: false; corruptKeys: string[] }

/** 宽松读取：ok 或 missing 给默认值；损坏键的字段以 undefined 表示（供旧客户端兼容响应使用）。 */
export function readCreationDefaultsLenient(database: DatabaseSync): { initialCash?: number; adjustMode?: 'forward' | 'raw' } {
  const fields = readCreationDefaultsFields(database)
  return {
    ...(fields.cash.state === 'ok' ? { initialCash: fields.cash.value } : fields.cash.state === 'missing' ? { initialCash: DEFAULT_INITIAL_CASH } : {}),
    ...(fields.mode.state === 'ok' ? { adjustMode: fields.mode.value } : fields.mode.state === 'missing' ? { adjustMode: 'forward' as const } : {}),
  }
}
