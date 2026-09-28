import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../train/engine.js'
import { observedDefaultRules, type TrainingRulesV1 } from '../train/rules.js'
import { DEFAULT_INITIAL_CASH, readCreationDefaults, readCreationDefaultsLenient, isInitialCashInDomain } from './creation-defaults.js'

// TRAIN-01/M5-DEFAULTS-01：训练默认设置 API：GET/PUT /api/settings/training。
// M5 起支持四字段完整对象（费用开关、T+1、默认初始资金、默认复权），四键同一事务原子保存，
// 保留表中其他键；旧客户端恰好两布尔的 PUT 继续兼容（只更新旧两键，保留新默认）。
// 费用数值沿既有口径（account.ts 常量）；资金单位元，域 0.01..1,000,000,000、至多两位小数。
// 无 TDX 也可读写。此 API 经 registerApi 注册，自动进入既有业务 admission 门闩（draining 503）。
// 损坏默认键不是缺键：GET 返回可行动 409 TRAINING_DEFAULTS_UNREADABLE，不自动修复；
// 完整合法四字段 PUT 即修复入口；旧两布尔 PUT 不声称修复新键。

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

export function trainingSettingsView(database: DatabaseSync): TrainingSettingsView {
  const read = readCreationDefaults(database)
  if (!read.ok) throw trainingDefaultsUnreadableError(read.corruptKeys)
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

/** 宽松视图：损坏的新默认字段以 undefined 表示（旧两布尔 PUT 的兼容响应不假称已修复）。 */
function trainingSettingsViewLenient(database: DatabaseSync): TrainingSettingsView {
  const lenient = readCreationDefaultsLenient(database)
  const view = trainingSettingsViewStrictBooleans(database)
  return {
    ...view,
    ...(lenient.initialCash === undefined ? {} : { initialCash: lenient.initialCash }),
    ...(lenient.adjustMode === undefined ? {} : { adjustMode: lenient.adjustMode }),
  } as TrainingSettingsView
}

function trainingSettingsViewStrictBooleans(database: DatabaseSync): TrainingSettingsView {
  const rules = observedDefaultRules(database, '')
  return {
    version: rules.version,
    feesEnabled: rules.feesEnabled,
    tPlusOne: rules.tPlusOne,
    initialCash: DEFAULT_VIEW_FALLBACK.initialCash,
    adjustMode: DEFAULT_VIEW_FALLBACK.adjustMode,
    commissionRate: rules.commissionRate,
    minimumCommission: rules.minimumCommission,
    stampDutyRate: rules.stampDutyRate,
    lotSize: rules.lotSize,
    execution: rules.execution,
    weightBasis: rules.weightBasis,
    corporateActionPolicy: rules.corporateActionPolicy,
  }
}

const DEFAULT_VIEW_FALLBACK = { initialCash: DEFAULT_INITIAL_CASH, adjustMode: 'forward' as TrainingAdjustMode }

interface TrainingSettingsPutBody {
  feesEnabled?: unknown
  tPlusOne?: unknown
  initialCash?: unknown
  adjustMode?: unknown
}

export type ParsedTrainingSettingsPut =
  | { kind: 'full'; feesEnabled: boolean; tPlusOne: boolean; initialCash: number; adjustMode: TrainingAdjustMode }
  | { kind: 'legacy'; feesEnabled: boolean; tPlusOne: boolean }

/** 严格校验：完整四字段对象（新）或恰好两布尔对象（旧客户端兼容）。
 * 部分对象/未知字段/非对象/数组/null 都 400 零写。 */
export function parseTrainingSettingsPut(body: unknown): ParsedTrainingSettingsPut {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是对象')
  }
  const candidate = body as TrainingSettingsPutBody
  const knownKeys = ['feesEnabled', 'tPlusOne', 'initialCash', 'adjustMode']
  for (const key of Object.keys(candidate)) {
    if (!knownKeys.includes(key)) {
      throw new HttpError(400, `存在未知字段：${key}`)
    }
  }
  const keys = Object.keys(candidate)
  const hasNewKeys = keys.includes('initialCash') || keys.includes('adjustMode')
  if (!hasNewKeys) {
    // 旧两布尔兼容
    if (keys.length !== 2) throw new HttpError(400, 'feesEnabled 与 tPlusOne 必须是布尔值')
    if (typeof candidate.feesEnabled !== 'boolean' || typeof candidate.tPlusOne !== 'boolean') {
      throw new HttpError(400, 'feesEnabled 与 tPlusOne 必须是布尔值')
    }
    return { kind: 'legacy', feesEnabled: candidate.feesEnabled, tPlusOne: candidate.tPlusOne }
  }
  // 四字段完整对象
  if (keys.length !== 4) {
    throw new HttpError(400, '四字段完整对象必须同时提供 feesEnabled、tPlusOne、initialCash、adjustMode（旧客户端可只发两布尔）')
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
  return {
    kind: 'full',
    feesEnabled: candidate.feesEnabled,
    tPlusOne: candidate.tPlusOne,
    initialCash: candidate.initialCash,
    adjustMode: candidate.adjustMode,
  }
}

/** 同一事务原子保存；legacy 只更新旧两键（保留新默认、不声称修复坏键），full 更新四键。 */
export function saveTrainingSettings(database: DatabaseSync, parsed: ParsedTrainingSettingsPut): TrainingSettingsView {
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
