import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../train/engine.js'
import { observedDefaultRules, type TrainingRulesV1 } from '../train/rules.js'

// TRAIN-01 训练默认设置 API：GET/PUT /api/settings/training。
// 只开放费用开关与 T+1 开关，落既有 settings 表键 fees_enabled / t1_enabled，
// 保留表中其他键；费用数值沿既有口径（account.ts 常量），本片不开放费率编辑。
// 无 TDX 数据目录也可读写。此 API 经 registerApi 注册，自动进入既有业务 admission
// 门闩（draining 时 503），不能旁路 DRAIN。

export type TrainingSettingsView = Omit<TrainingRulesV1, 'capturedAt' | 'origin'>

export function trainingSettingsView(database: DatabaseSync): TrainingSettingsView {
  // capturedAt 只属于已冻结的训练规则；默认设置本身没有冻结时间
  const defaults = observedDefaultRules(database, '')
  return {
    version: defaults.version,
    feesEnabled: defaults.feesEnabled,
    tPlusOne: defaults.tPlusOne,
    commissionRate: defaults.commissionRate,
    minimumCommission: defaults.minimumCommission,
    stampDutyRate: defaults.stampDutyRate,
    lotSize: defaults.lotSize,
    execution: defaults.execution,
    weightBasis: defaults.weightBasis,
    corporateActionPolicy: defaults.corporateActionPolicy,
  }
}

interface TrainingSettingsPutBody {
  feesEnabled?: unknown
  tPlusOne?: unknown
}

/** 严格校验：两项都必须是 boolean，缺一/类型错/未知字段都 400 且零写。 */
export function parseTrainingSettingsPut(body: unknown): { feesEnabled: boolean; tPlusOne: boolean } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是对象')
  }
  const candidate = body as TrainingSettingsPutBody
  for (const key of Object.keys(candidate)) {
    if (key !== 'feesEnabled' && key !== 'tPlusOne') {
      throw new HttpError(400, `存在未知字段：${key}`)
    }
  }
  if (typeof candidate.feesEnabled !== 'boolean' || typeof candidate.tPlusOne !== 'boolean') {
    throw new HttpError(400, 'feesEnabled 与 tPlusOne 必须是布尔值')
  }
  return { feesEnabled: candidate.feesEnabled, tPlusOne: candidate.tPlusOne }
}

/** 同一事务更新两项设置，不部分成功；重复保存相同值安全（最后一次成功保存供未来创建使用）。 */
export function saveTrainingSettings(database: DatabaseSync, values: { feesEnabled: boolean; tPlusOne: boolean }): TrainingSettingsView {
  database.exec('BEGIN IMMEDIATE')
  try {
    const upsert = database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    upsert.run('fees_enabled', values.feesEnabled ? '1' : '0')
    upsert.run('t1_enabled', values.tPlusOne ? '1' : '0')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return trainingSettingsView(database)
}

export function registerTrainingSettingsRoutes(app: FastifyInstance, database: DatabaseSync): void {
  app.get('/api/settings/training', async () => trainingSettingsView(database))

  app.put('/api/settings/training', async request => {
    const values = parseTrainingSettingsPut(request.body)
    return saveTrainingSettings(database, values)
  })
}
