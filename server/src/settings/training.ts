import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../train/engine.js'
import { observedDefaultRules, type TrainingRulesV1 } from '../train/rules.js'
import { readCreationDefaults, readCreationDefaultsLenient, isInitialCashInDomain } from './creation-defaults.js'
import {
  FEE_SETTING_KEYS,
  isMinimumCommissionDefaultInDomain,
  isRateDefaultInDomain,
  readFeeDefaults,
  readFeeDefaultsLenient,
} from './fee-defaults.js'

// TRAIN-01/M5-DEFAULTS-01：训练默认设置 API：GET/PUT /api/settings/training。
// M5 起支持四字段完整对象（费用开关、T+1、默认初始资金、默认复权），四键同一事务原子保存，
// 保留表中其他键；旧客户端恰好两布尔的 PUT 继续兼容（只更新旧两键，保留新默认）。
// TRAIN-FEE-01（Issue #8-A，用户 2026-11-07 拍板）：新增可配置费率三字段（佣金率/最低佣金/印花税率），
// 完整对象扩展为「4 字段」或「7 字段」；费率数值仅影响新训练（创建时冻结进 rules_json 快照）。
// 损坏默认键不是缺键：GET 返回可行动 409 TRAINING_DEFAULTS_UNREADABLE，不自动修复；
// 完整合法 PUT 即修复入口；旧两布尔 PUT 不声称修复新键。此 API 进入业务 admission 门闩。

export type TrainingAdjustMode = 'forward' | 'raw'

export interface TrainingSettingsView extends Omit<TrainingRulesV1, 'capturedAt' | 'origin' | 'feesEnabled' | 'tPlusOne'> {
  feesEnabled: boolean
  tPlusOne: boolean
  initialCash: number
  adjustMode: TrainingAdjustMode
}

export function trainingDefaultsUnreadableError(corruptKeys: string[]): HttpError {
  return new HttpError(
    409,
    `训练默认设置损坏（${corruptKeys.join('、')} 无法读取）：请在设置中核对表单并重新保存即可修复，或创建时显式填写资金与复权`,
    'TRAINING_DEFAULTS_UNREADABLE',
  )
}

/** GET 全量视图：资金/复权与费率三字段任一损坏即 409（按字段粒度如实列出损坏键）。 */
export function trainingSettingsView(database: DatabaseSync): TrainingSettingsView {
  const read = readCreationDefaults(database)
  const fees = readFeeDefaults(database)
  if (!read.ok || !fees.ok) {
    const corruptKeys = [
      ...(read.ok ? [] : read.corruptKeys),
      ...(fees.ok ? [] : fees.corruptKeys),
    ]
    throw trainingDefaultsUnreadableError(corruptKeys)
  }
  const rules = observedDefaultRules(database, '')
  return {
    version: rules.version,
    feesEnabled: rules.feesEnabled,
    tPlusOne: rules.tPlusOne,
    initialCash: read.defaults.initialCash,
    adjustMode: read.defaults.adjustMode,
    commissionRate: rules.commissionRate,
    minimumCommission: rules.minimumCommission,
    stampDutyRate: rules.stampDutyRate,
    lotSize: rules.lotSize,
    execution: rules.execution,
    weightBasis: rules.weightBasis,
    corporateActionPolicy: rules.corporateActionPolicy,
  }
}

/** 宽松视图（旧两布尔 PUT 兼容响应）：只包含能如实表达的键——损坏的新默认字段整体缺席
 *（不得凭空返回内建默认冒称有效或已修复；坏字节由 GET 409 如实呈现）。 */
type TrainingSettingsViewLenient = Omit<TrainingSettingsView, 'initialCash' | 'adjustMode' | 'commissionRate' | 'minimumCommission' | 'stampDutyRate'>
  & Partial<Pick<TrainingSettingsView, 'initialCash' | 'adjustMode' | 'commissionRate' | 'minimumCommission' | 'stampDutyRate'>>

function trainingSettingsViewLenient(database: DatabaseSync): TrainingSettingsViewLenient {
  const lenient = readCreationDefaultsLenient(database)
  const feeLenient = readFeeDefaultsLenient(database)
  const rules = observedDefaultRules(database, '')
  return {
    version: rules.version,
    feesEnabled: rules.feesEnabled,
    tPlusOne: rules.tPlusOne,
    ...(lenient.initialCash === undefined ? {} : { initialCash: lenient.initialCash }),
    ...(lenient.adjustMode === undefined ? {} : { adjustMode: lenient.adjustMode }),
    ...(feeLenient.commissionRate === undefined ? {} : { commissionRate: feeLenient.commissionRate }),
    ...(feeLenient.minimumCommission === undefined ? {} : { minimumCommission: feeLenient.minimumCommission }),
    ...(feeLenient.stampDutyRate === undefined ? {} : { stampDutyRate: feeLenient.stampDutyRate }),
    lotSize: rules.lotSize,
    execution: rules.execution,
    weightBasis: rules.weightBasis,
    corporateActionPolicy: rules.corporateActionPolicy,
  }
}

export interface FeeDefaultsInput {
  commissionRate: number
  minimumCommission: number
  stampDutyRate: number
}

interface TrainingSettingsPutBody {
  feesEnabled?: unknown
  tPlusOne?: unknown
  initialCash?: unknown
  adjustMode?: unknown
  commissionRate?: unknown
  minimumCommission?: unknown
  stampDutyRate?: unknown
}

const FEE_KEYS = [FEE_SETTING_KEYS.commission, FEE_SETTING_KEYS.minimum, FEE_SETTING_KEYS.stamp] as const

export type ParsedTrainingSettingsPut =
  | { kind: 'full'; feesEnabled: boolean; tPlusOne: boolean; initialCash: number; adjustMode: TrainingAdjustMode; fees?: FeeDefaultsInput }
  | { kind: 'legacy'; feesEnabled: boolean; tPlusOne: boolean }

/** 严格校验：完整对象（4 字段或 7 字段＝补费率三项）或恰好两布尔对象（旧客户端兼容）。
 * 部分对象/未知字段/非对象/数组/null/费率三项只给一部分都 400 零写。
 * 费率域：佣金率与印花税率 ∈ [0,1]（万分之 0..10000）；最低佣金 ∈ [0,1e6] 元、至多两位小数（0＝免 5）。 */
export function parseTrainingSettingsPut(body: unknown): ParsedTrainingSettingsPut {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是对象')
  }
  const candidate = body as TrainingSettingsPutBody
  const baseKeys = ['feesEnabled', 'tPlusOne', 'initialCash', 'adjustMode']
  const feeKeys = ['commissionRate', 'minimumCommission', 'stampDutyRate']
  const knownKeys = [...baseKeys, ...feeKeys]
  for (const key of Object.keys(candidate)) {
    if (!knownKeys.includes(key)) {
      throw new HttpError(400, `存在未知字段：${key}`)
    }
  }
  const keys = Object.keys(candidate)
  const hasFeeKeys = feeKeys.some(key => keys.includes(key))
  // 旧客户端兼容：只有旧两布尔键（无 initialCash/adjustMode/费率任何新键）
  const hasNewKeys = keys.some(key => key === 'initialCash' || key === 'adjustMode' || feeKeys.includes(key))
  if (!hasNewKeys) {
    if (keys.length !== 2) throw new HttpError(400, 'feesEnabled 与 tPlusOne 必须是布尔值')
    if (typeof candidate.feesEnabled !== 'boolean' || typeof candidate.tPlusOne !== 'boolean') {
      throw new HttpError(400, 'feesEnabled 与 tPlusOne 必须是布尔值')
    }
    return { kind: 'legacy', feesEnabled: candidate.feesEnabled, tPlusOne: candidate.tPlusOne }
  }
  const missingBase = baseKeys.filter(key => !keys.includes(key))
  if (missingBase.length > 0) {
    throw new HttpError(400, `完整对象缺少字段：${missingBase.join('、')}（旧客户端可只发两布尔）`)
  }
  // 完整对象：4 字段（旧 UI）或 7 字段（费率可配置 UI）
  if (keys.length !== baseKeys.length && keys.length !== knownKeys.length) {
    throw new HttpError(400, '完整对象必须同时提供 feesEnabled、tPlusOne、initialCash、adjustMode（旧 UI）或再加 commissionRate、minimumCommission、stampDutyRate 三项（新 UI）')
  }
  for (const key of baseKeys) {
    if (!keys.includes(key)) throw new HttpError(400, `完整对象缺少字段：${key}`)
  }
  if (typeof candidate.feesEnabled !== 'boolean' || typeof candidate.tPlusOne !== 'boolean') {
    throw new HttpError(400, 'feesEnabled 与 tPlusOne 必须是布尔值')
  }
  if (!isInitialCashInDomain(candidate.initialCash)) {
    throw new HttpError(400, 'initialCash 必须是 0.01 至 1,000,000,000 之间、至多两位小数的数字')
  }
  if (candidate.adjustMode !== 'forward' && candidate.adjustMode !== 'raw') {
    throw new HttpError(400, "adjustMode 必须是 'forward' 或 'raw'")
  }
  let fees: FeeDefaultsInput | undefined
  if (hasFeeKeys) {
    if (feeKeys.some(key => !keys.includes(key))) {
      throw new HttpError(400, '费率三项 commissionRate、minimumCommission、stampDutyRate 必须同时提供')
    }
    if (!isRateDefaultInDomain(candidate.commissionRate)) {
      throw new HttpError(400, 'commissionRate 必须是 0 至 1 之间的比率（万分之 0..10000）')
    }
    if (!isMinimumCommissionDefaultInDomain(candidate.minimumCommission)) {
      throw new HttpError(400, 'minimumCommission 必须是 0 至 1,000,000 元之间、至多两位小数（0＝免最低佣金）')
    }
    if (!isRateDefaultInDomain(candidate.stampDutyRate)) {
      throw new HttpError(400, 'stampDutyRate 必须是 0 至 1 之间的比率（万分之 0..10000）')
    }
    fees = {
      commissionRate: candidate.commissionRate,
      minimumCommission: candidate.minimumCommission,
      stampDutyRate: candidate.stampDutyRate,
    }
  }
  return {
    kind: 'full',
    feesEnabled: candidate.feesEnabled,
    tPlusOne: candidate.tPlusOne,
    initialCash: candidate.initialCash,
    adjustMode: candidate.adjustMode,
    ...(fees === undefined ? {} : { fees }),
  }
}

/** 同一事务原子保存；legacy 只更新旧两键（保留新默认、不声称修复坏键），full 更新四键（含费率三项时一并）。 */
export function saveTrainingSettings(database: DatabaseSync, parsed: ParsedTrainingSettingsPut): TrainingSettingsView | TrainingSettingsViewLenient {
  database.exec('BEGIN IMMEDIATE')
  try {
    const upsert = database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    upsert.run('fees_enabled', parsed.feesEnabled ? '1' : '0')
    upsert.run('t1_enabled', parsed.tPlusOne ? '1' : '0')
    if (parsed.kind === 'full') {
      upsert.run('training_initial_cash', String(parsed.initialCash))
      upsert.run('training_adjust_mode', parsed.adjustMode)
      if (parsed.fees !== undefined) {
        upsert.run(FEE_SETTING_KEYS.commission, String(parsed.fees.commissionRate))
        upsert.run(FEE_SETTING_KEYS.minimum, String(parsed.fees.minimumCommission))
        upsert.run(FEE_SETTING_KEYS.stamp, String(parsed.fees.stampDutyRate))
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return parsed.kind === 'full' ? trainingSettingsView(database) : trainingSettingsViewLenient(database)
}

export function registerTrainingSettingsRoutes(app: FastifyInstance, database: DatabaseSync): void {
  app.get('/api/settings/training', async () => trainingSettingsView(database))

  app.put('/api/settings/training', async request => {
    const parsed = parseTrainingSettingsPut(request.body)
    return saveTrainingSettings(database, parsed)
  })
}
