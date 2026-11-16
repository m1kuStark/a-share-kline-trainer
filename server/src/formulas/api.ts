import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import type { Timeframe } from '../tdx/kline.js'
import { randomSessionOf } from '../train/random-mode.js'
import { bundleEngineProvider, futureFunctionsOf, type FormulaEngineModule, type FormulaEngineProvider } from './engine.js'
import { normalizeFormulaSource } from './text.js'
import {
  createFormulaRow, deleteFormulaRow, FormulaStoreError, getFormulaRow, listFormulaRows, parseFormulaFields, updateFormulaRow, MAX_SOURCE_LENGTH,
} from './storage.js'
import { evaluateOnBars, validateSource } from './evaluate.js'
import { maskFormulaEvaluationForRandomSession, tdxFormulaData, trainingFormulaData } from './data.js'
import type { FormulaRow, FormulaView } from './types.js'

export interface FormulaRouteOptions {
  /** 测试可注入同源引擎模块；默认按 bundle/源码回退加载 web/src/formula-engine */
  engine?: FormulaEngineProvider
}

const DEFAULT_EVALUATE_LIMIT = 500
const MIN_EVALUATE_LIMIT = 10
const MAX_EVALUATE_LIMIT = 2000
const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M']

function viewOf(row: FormulaRow, futureFunctions: string[]): FormulaView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    placement: row.placement,
    source: row.source,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    futureFunctions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  const body = request.body
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new FormulaStoreError('请求体必须是 JSON 对象')
  return body as Record<string, unknown>
}

async function run(reply: FastifyReply, task: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof FormulaStoreError) return reply.code(error.statusCode).send({ error: error.message })
    throw error
  }
}

function parsePositiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed <= 0) throw new FormulaStoreError(field + ' 必须是正整数')
  return parsed
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_EVALUATE_LIMIT
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < MIN_EVALUATE_LIMIT || parsed > MAX_EVALUATE_LIMIT) {
    throw new FormulaStoreError('limit/bars 必须是 ' + MIN_EVALUATE_LIMIT + '~' + MAX_EVALUATE_LIMIT + ' 的整数')
  }
  return parsed
}

function parseTimeframe(value: unknown): Timeframe {
  if (value === undefined) return '1D'
  if (typeof value !== 'string' || !TIMEFRAMES.includes(value as Timeframe)) throw new FormulaStoreError('timeframe 必须是 1D/1W/1M')
  return value as Timeframe
}

function assertSourceLength(source: string): void {
  if (source.length > MAX_SOURCE_LENGTH) throw new FormulaStoreError('公式源码最长 ' + MAX_SOURCE_LENGTH + ' 字符')
}

/** 列表/详情只做未来函数扫描；引擎不可用时降级为空清单，不让只读列表 500 */
async function futureFunctionsSafely(provider: FormulaEngineProvider, source: string): Promise<string[]> {
  try {
    const engine = await provider()
    return futureFunctionsOf(engine, source)
  } catch {
    return []
  }
}

export function registerFormulaRoutes(app: FastifyInstance, config: AppConfig, database: DatabaseSync, options: FormulaRouteOptions = {}): void {
  const provider = options.engine ?? bundleEngineProvider

  // 公式库列表：附带未来函数静态标记（M9-04A；不执行公式）
  app.get('/api/formulas', async () => ({
    formulas: await Promise.all(listFormulaRows(database).map(async row => viewOf(row, await futureFunctionsSafely(provider, row.source)))),
  }))

  app.get('/api/formulas/:id', async (request, reply) => run(reply, async () => {
    const row = getFormulaRow(database, parsePositiveInteger((request.params as { id: string }).id, 'id'))
    if (!row) return reply.code(404).send({ error: '公式不存在' })
    return viewOf(row, await futureFunctionsSafely(provider, row.source))
  }))

  // 写公式库：先校验 parse/未来函数再落库；不做训练/画线/录像写入。响应附告警（如全角标点）
  app.post('/api/formulas', async (request, reply) => run(reply, async () => {
    const fields = parseFormulaFields(bodyOf(request), { partial: false })
    const normalized = normalizeFormulaSource(String(fields.source))
    assertSourceLength(normalized.source)
    const engine = await provider()
    const validation = validateSource(engine, normalized.source, normalized.warnings)
    if (!validation.ok) return reply.code(400).send({ error: '公式校验失败', detail: validation.error, warnings: validation.warnings })
    const row = createFormulaRow(database, {
      name: String(fields.name),
      description: String(fields.description ?? ''),
      placement: fields.placement ?? 'main',
      source: normalized.source,
      enabled: fields.enabled ?? 1,
    })
    return reply.code(201).send({ ...viewOf(row, validation.futureFunctions), warnings: validation.warnings })
  }))

  app.put('/api/formulas/:id', async (request, reply) => run(reply, async () => {
    const id = parsePositiveInteger((request.params as { id: string }).id, 'id')
    const fields = parseFormulaFields(bodyOf(request), { partial: true })
    let warnings: string[] = []
    if (fields.source !== undefined) {
      const normalized = normalizeFormulaSource(String(fields.source))
      assertSourceLength(normalized.source)
      warnings = normalized.warnings
      fields.source = normalized.source
    }
    const engine = await provider()
    if (fields.source !== undefined) {
      const validation = validateSource(engine, fields.source, warnings)
      if (!validation.ok) return reply.code(400).send({ error: '公式校验失败', detail: validation.error, warnings: validation.warnings })
      warnings = validation.warnings
    }
    const row = updateFormulaRow(database, id, fields)
    return { ...viewOf(row, futureFunctionsOf(engine, row.source)), warnings }
  }))

  app.delete('/api/formulas/:id', async (request, reply) => run(reply, async () => {
    const id = parsePositiveInteger((request.params as { id: string }).id, 'id')
    if (!deleteFormulaRow(database, id)) return reply.code(404).send({ error: '公式不存在' })
    return reply.code(204).send()
  }))

  // 只读校验（agent 接口）：200 固定 ok 形状；请求形状错误/超长 400
  app.post('/api/formulas/validate', async (request, reply) => run(reply, async () => {
    const body = bodyOf(request)
    if (typeof body.source !== 'string') throw new FormulaStoreError('source 必填')
    const normalized = normalizeFormulaSource(body.source)
    if (normalized.source.length === 0) throw new FormulaStoreError('source 必填（公式源码不能为空）')
    assertSourceLength(normalized.source)
    const engine = await provider()
    return validateSource(engine, normalized.source, normalized.warnings)
  }))

  // 只读求值（agent 接口 + 后续 C 卡预览）：训练上下文/独立证券二选一；随机训练按 M7-01 遮蔽；响应附数据来源说明
  app.post('/api/formulas/evaluate', async (request, reply) => run(reply, async () => {
    const body = bodyOf(request)
    const hasSource = typeof body.source === 'string' && body.source.trim() !== ''
    const hasFormulaId = body.formulaId !== undefined
    if (hasSource && hasFormulaId) throw new FormulaStoreError('source 与 formulaId 只能二选一')
    if (!hasSource && !hasFormulaId) throw new FormulaStoreError('source 或 formulaId 必填')
    let source = ''
    let currentId: number | null = null
    const sourceWarnings: string[] = []
    if (hasFormulaId) {
      currentId = parsePositiveInteger(body.formulaId, 'formulaId')
      const row = getFormulaRow(database, currentId)
      if (!row) throw new FormulaStoreError('公式不存在', 404)
      source = row.source
    } else {
      const normalized = normalizeFormulaSource(String(body.source))
      assertSourceLength(normalized.source)
      source = normalized.source
      sourceWarnings.push(...normalized.warnings)
    }
    const timeframe = parseTimeframe(body.timeframe)
    const limit = parseLimit(body.limit ?? body.bars)
    const hasTraining = body.trainingId !== undefined
    if (hasTraining) {
      if (typeof body.code === 'string' && body.code.trim() !== '') throw new FormulaStoreError('trainingId 与 code 只能二选一')
    } else if (typeof body.code !== 'string' || body.code.trim() === '') {
      throw new FormulaStoreError('trainingId 或 code 必填（决定求值数据来源）')
    } else if (timeframe !== '1D') {
      throw new FormulaStoreError('独立证券求值暂仅支持日线（timeframe=1D）；周期指标请用 trainingId 的训练上下文')
    }
    const trainingId = hasTraining ? parsePositiveInteger(body.trainingId, 'trainingId') : null
    const data = trainingId !== null
      ? await trainingFormulaData(database, config, trainingId, timeframe, limit)
      : await tdxFormulaData(database, config, String(body.code).trim(), limit)
    const session = trainingId !== null ? randomSessionOf(database, trainingId) : null
    if (session?.hideStock) data.stockContext = null
    const warnings = [...data.warnings]
    for (const warning of sourceWarnings) if (!warnings.includes(warning)) warnings.push(warning)
    if (session && !warnings.includes('随机训练会话：返回值已按 M7-01 规则遮蔽日期/代码/名称信息')) {
      warnings.push('随机训练会话：返回值已按 M7-01 规则遮蔽日期/代码/名称信息')
    }
    const engine = await provider()
    const auxiliaryFormulas: Record<string, string> = {}
    for (const row of listFormulaRows(database)) {
      if (currentId !== null && row.id === currentId) continue
      auxiliaryFormulas[row.name] = row.source
    }
    const result = evaluateOnBars(engine, {
      source,
      bars: data.bars,
      dates: data.dates,
      stockContext: data.stockContext,
      auxiliaryFormulas,
      limit: data.bars.length,
      warnings,
    })
    const payload = { ...result, dataSource: { kind: data.source, note: data.note } }
    return session ? maskFormulaEvaluationForRandomSession(payload, session) : payload
  }))
}
