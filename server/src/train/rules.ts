import type { DatabaseSync } from 'node:sqlite'
import { COMMISSION_MIN, COMMISSION_RATE, LOT_SIZE, STAMP_TAX_RATE } from './account.js'

// TRAIN-01 训练规则快照：创建训练时冻结完整交易规则，旧训练在迁移时一次性冻结升级时点
// 观察值。规则是不可变记录（trainings.rules_json），交易/可卖数量/录像上下文一律读本局
// 快照，不再逐笔读全局 settings；快照缺失/损坏/版本不支持由调用方显式报错，绝不静默
// 回退当前设置继续交易。

/** 固定执行口径与费用数值沿既有 account.ts 常量，本片不开放费率编辑。 */
export type TrainingExecutionPolicy = 'same-day-raw-close'
export type TrainingWeightBasis = 'total-equity'
/** cash-shares-v1＝完整现金/送转/配股权息入账；legacy-raw-unverified＝旧不复权训练历史权息缺失，只读保护。 */
export type CorporateActionPolicy = 'cash-shares-v1' | 'legacy-raw-unverified'
export type TrainingRulesOrigin = 'created' | 'legacy-migration'

export interface TrainingRulesV1 {
  version: 1
  feesEnabled: boolean
  tPlusOne: boolean
  commissionRate: number
  minimumCommission: number
  stampDutyRate: number
  lotSize: number
  execution: TrainingExecutionPolicy
  weightBasis: TrainingWeightBasis
  corporateActionPolicy: CorporateActionPolicy
  /** 规则冻结时间点：created＝创建提交时刻；legacy-migration＝迁移时点（非创建时规则，诚实标注） */
  capturedAt: string
  origin: TrainingRulesOrigin
}

function settingsFlag(database: DatabaseSync, key: string, fallback: '0' | '1'): boolean {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined
  return (row?.value ?? fallback) === '1'
}

/** 观察当前全局默认并构造新训练规则（origin=created）。必须在提交事务边界内调用，
 * 才能保证"创建读取的是真正提交时的默认"，不使用 await 前缓存的旧值。 */
export function observedDefaultRules(database: DatabaseSync, capturedAt: string): TrainingRulesV1 {
  return {
    version: 1,
    feesEnabled: settingsFlag(database, 'fees_enabled', '0'),
    tPlusOne: settingsFlag(database, 't1_enabled', '1'),
    commissionRate: COMMISSION_RATE,
    minimumCommission: COMMISSION_MIN,
    stampDutyRate: STAMP_TAX_RATE,
    lotSize: LOT_SIZE,
    execution: 'same-day-raw-close',
    weightBasis: 'total-equity',
    corporateActionPolicy: 'cash-shares-v1',
    capturedAt,
    origin: 'created',
  }
}

/** 旧训练迁移回填规则：冻结迁移时点实际可见的 fees/T+1 与既有固定参数。
 * 旧不复权训练历史权息缺失，如实记 legacy-raw-unverified；旧前复权训练可沿现有
 * cash-shares-v1 继续服务，但 origin 仍是 legacy-migration（不伪称创建时规则）。 */
export function legacyMigrationRules(database: DatabaseSync, adjustMode: string, capturedAt: string): TrainingRulesV1 {
  return {
    ...observedDefaultRules(database, capturedAt),
    origin: 'legacy-migration',
    corporateActionPolicy: adjustMode === 'raw' ? 'legacy-raw-unverified' : 'cash-shares-v1',
  }

}

/** 严格解析规则快照：任何字段缺失/类型不符/版本不支持都返回 null（不可静默回退）。 */
export function parseTrainingRules(raw: string | null | undefined): TrainingRulesV1 | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1) return null
  if (typeof candidate.feesEnabled !== 'boolean' || typeof candidate.tPlusOne !== 'boolean') return null
  for (const key of ['commissionRate', 'minimumCommission', 'stampDutyRate', 'lotSize'] as const) {
    if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key])) return null
  }
  if (candidate.execution !== 'same-day-raw-close' || candidate.weightBasis !== 'total-equity') return null
  if (candidate.corporateActionPolicy !== 'cash-shares-v1' && candidate.corporateActionPolicy !== 'legacy-raw-unverified') return null
  if (typeof candidate.capturedAt !== 'string' || candidate.capturedAt === '') return null
  if (candidate.origin !== 'created' && candidate.origin !== 'legacy-migration') return null
  return candidate as unknown as TrainingRulesV1
}

/** 测试/迁移夹具辅助：读取行内规则字符串并严格解析，不抛错。 */
export function readTrainingRulesFromDatabase(database: DatabaseSync, id: number): TrainingRulesV1 | null {
  const row = database.prepare('SELECT rules_json FROM trainings WHERE id = ?').get(id) as unknown as { rules_json: string | null } | undefined
  if (!row) return null
  return parseTrainingRules(row.rules_json)
}

/** 序列化为 rules_json 存储值。 */
export function serializeTrainingRules(rules: TrainingRulesV1): string {
  return JSON.stringify(rules)
}
