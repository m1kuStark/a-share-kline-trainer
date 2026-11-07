import type { DatabaseSync } from 'node:sqlite'
import { COMMISSION_MIN, COMMISSION_RATE, STAMP_TAX_RATE } from '../train/account.js'
import { hasAtMostTwoDecimalPlaces } from './creation-defaults.js'

// TRAIN-FEE-01（Issue #8-A，用户 2026-11-07 拍板）：训练默认费率可配置。
// 费率默认值沿 account.ts 既有口径（佣金万 2.5、最低 5 元、卖出印花税万 5），缺键＝内建默认；
// 已有损坏键不是缺键：由调用方映射为可行动的 409 TRAINING_DEFAULTS_UNREADABLE，不自动修复。
// 存储单位为比率：佣金率/印花税率 ∈ [0,1]（万 2.5＝0.00025）；最低佣金 ∈ [0,1e6] 元、至多两位小数。
// 本局训练创建时把数值冻结进 rules_json 快照，之后改默认只影响新训练（TRAIN-RULE-SNAPSHOT）。

export const FEE_SETTING_KEYS = {
  commission: 'training_commission_rate',
  minimum: 'training_minimum_commission',
  stamp: 'training_stamp_duty_rate',
} as const

export interface FeeDefaults {
  commissionRate: number
  minimumCommission: number
  stampDutyRate: number
}

export const DEFAULT_FEE_DEFAULTS: FeeDefaults = {
  commissionRate: COMMISSION_RATE,
  minimumCommission: COMMISSION_MIN,
  stampDutyRate: STAMP_TAX_RATE,
}

export type FeeFieldState = { state: 'missing' } | { state: 'ok'; value: number } | { state: 'corrupt' }

/** 比率域：数字、有限、0..1（万分之 0..10000）。 */
export function isRateDefaultInDomain(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** 最低佣金域：数字、有限、0..1e6 元、至多两位十进制小数（允许 0＝免 5）。 */
export function isMinimumCommissionDefaultInDomain(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < 0 || value > 1_000_000) return false
  return hasAtMostTwoDecimalPlaces(value)
}

function readStoredValue(database: DatabaseSync, key: string): string | null {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined
  return row?.value ?? null
}

function readNumberField(database: DatabaseSync, key: string, domain: (value: unknown) => value is number): FeeFieldState {
  const raw = readStoredValue(database, key)
  if (raw === null) return { state: 'missing' }
  const value = Number(raw)
  return domain(value) ? { state: 'ok', value } : { state: 'corrupt' }
}

export interface FeeDefaultsFieldRead {
  commission: FeeFieldState
  minimum: FeeFieldState
  stamp: FeeFieldState
}

export function readFeeDefaultsFields(database: DatabaseSync): FeeDefaultsFieldRead {
  return {
    commission: readNumberField(database, FEE_SETTING_KEYS.commission, isRateDefaultInDomain),
    minimum: readNumberField(database, FEE_SETTING_KEYS.minimum, isMinimumCommissionDefaultInDomain),
    stamp: readNumberField(database, FEE_SETTING_KEYS.stamp, isRateDefaultInDomain),
  }
}

export type FeeDefaultsRead = { ok: true; defaults: FeeDefaults } | { ok: false; corruptKeys: string[] }

export function readFeeDefaults(database: DatabaseSync): FeeDefaultsRead {
  const fields = readFeeDefaultsFields(database)
  const corruptKeys: string[] = []
  if (fields.commission.state === 'corrupt') corruptKeys.push(FEE_SETTING_KEYS.commission)
  if (fields.minimum.state === 'corrupt') corruptKeys.push(FEE_SETTING_KEYS.minimum)
  if (fields.stamp.state === 'corrupt') corruptKeys.push(FEE_SETTING_KEYS.stamp)
  if (corruptKeys.length > 0) return { ok: false, corruptKeys }
  return {
    ok: true,
    defaults: {
      commissionRate: fields.commission.state === 'ok' ? fields.commission.value : DEFAULT_FEE_DEFAULTS.commissionRate,
      minimumCommission: fields.minimum.state === 'ok' ? fields.minimum.value : DEFAULT_FEE_DEFAULTS.minimumCommission,
      stampDutyRate: fields.stamp.state === 'ok' ? fields.stamp.value : DEFAULT_FEE_DEFAULTS.stampDutyRate,
    },
  }
}

/** 宽松读取：ok/missing 给值，损坏字段缺席（旧两布尔 PUT 兼容响应使用）。 */
export function readFeeDefaultsLenient(database: DatabaseSync): Partial<FeeDefaults> {
  const fields = readFeeDefaultsFields(database)
  return {
    ...(fields.commission.state === 'missing' ? { commissionRate: DEFAULT_FEE_DEFAULTS.commissionRate } : fields.commission.state === 'ok' ? { commissionRate: fields.commission.value } : {}),
    ...(fields.minimum.state === 'missing' ? { minimumCommission: DEFAULT_FEE_DEFAULTS.minimumCommission } : fields.minimum.state === 'ok' ? { minimumCommission: fields.minimum.value } : {}),
    ...(fields.stamp.state === 'missing' ? { stampDutyRate: DEFAULT_FEE_DEFAULTS.stampDutyRate } : fields.stamp.state === 'ok' ? { stampDutyRate: fields.stamp.value } : {}),
  }
}
