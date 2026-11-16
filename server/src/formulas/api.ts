import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import type { Timeframe } from '../tdx/kline.js'
import { bundleEngineProvider, futureFunctionsOf, type FormulaEngineProvider } from './engine.js'
import { normalizeFormulaSource } from './text.js'
import {
  createFormulaRow, deleteFormulaRow, FormulaStoreError, getFormulaRow, listFormulaRows, parseFormulaFields, updateFormulaRow,
} from './storage.js'
import { evaluateOnBars, validateSource } from './evaluate.js'
import { tdxFormulaData, trainingFormulaData } from './data.js'
import type { FormulaRow, FormulaView } from './types.js'

export interface FormulaRouteOptions {
  /** 测试可注入同源引擎模块；默认按 bundle/源码回退加载 web/src/formula-engine */
  engine?: FormulaEngineProvider
}

const DEFAULT_EVALUATE_LIMIT = 500
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
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed <= 0) throw new FormulaStoreError(field + ' 必须是正整数')
  return parsed
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_EVALUATE_LIMIT
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 50 || parsed > MAX_EVALUATE_LIMIT) {
    throw new FormulaStoreError('limit 必须是 50~' + MAX_EVALUATE_LIMIT + ' 的整数')
  }
  return parsed
}

function parseTimeframe(value: unknown): Timeframe {
  if (value === undefined) return '1D'
  if (typeof value !== 'string' || !TIMEFRAMES.includes(value as Timeframe)) throw new FormulaStoreError('timeframe 必须是 1D/1W/1M')
  return value as Timeframe
}

export function registerFormulaRoutes(app: FastifyInstance, config: AppConfig, database: DatabaseSync, options: FormulaRouteOptions = {}): void {
  const provider = options.engine ?? bundleEngineProvider

  // 公式库列表：附带未来函数静态标记（M9-04A；不执行公式）
  app.get('/api/formulas', async () => {
    const engine = await provider()
    return { formulas: listFormulaRows(database).map(row => viewOf(row, futureFunctionsOf(engine, row.source))) }
  })

  app.get('/api/formulas/:id', async (request, reply) => run(reply, async () => {
    const row = getFormulaRow(database, parsePositiveInteger((request.params as { id: string }).id, 'id'))
    if (!row) return reply.code(404).send({ error: '公式不存在' })
    const engine = await provider()
    return viewOf(row, futureFunctionsOf(engine, row.source))
  }))

  // 写公式库：先校验 parse/未来函数再落库；不做训练/画线/录像写入
  app.post('/api/formulas', async (request, reply) => run(reply, async () => {
    const fields = parseFormulaFields(bodyOf(request), { partial: false })
    const normalized = normalizeFormulaSource(String(fields.source))
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
    return reply.code(201).send(viewOf(row, validation.futureFunctions))
  }))

  app.put('/api/formulas/:id', async (request, reply) => run(reply, async () => {
    const id = parsePositiveInteger((request.params as { id: string }).id, 'id')
    const fields = parseFormulaFields(bodyOf(request), { partial: true })
    let normalizedWarnings: string[] = []
    if (fields.source !== undefined) {
      const normalized = normalizeFormulaSource(String(fields.source))
      normalizedWarnings = normalized.warnings
      fields.source = normalized.source
    }
    const engine = await provider()
    if (fields.source !== undefined) {
      const validation = validateSource(engine, fields.source, normalizedWarnings)
      if (!validation.ok) return reply.code(400).send({ error: '公式校验失败', detail: validation.error, warnings: validation.warnings })
    }
    const row = updateFormulaRow(database, id, fields)
    return viewOf(row, futureFunctionsOf(engine, row.source))
  }))

  app.delete('/api/formulas/:id', async (request, reply) => run(reply, async () => {
    const id = parsePositiveInteger((request.params as { id: string }).id, 'id')
    if (!deleteFormulaRow(database, id)) return reply.code(404).send({ error: '公式不存在' })
    return reply.code(204).send()
  }))

  // 只读校验（agent 接口）：200 固定 ok 形状；请求形状错误 400
  app.post('/api/formulas/validate', async (request, reply) => run(reply, async () => {
    const body = bodyOf(request)
    if (typeof body.source !== 'string') throw new FormulaStoreError('source 必填')
    const normalized = normalizeFormulaSource(body.source)
    if (normalized.source.length === 0) throw new FormulaStoreError('source 必填（公式源码不能为空）')
    const engine = await provider()
    return validateSource(engine, normalized.source, normalized.warnings)
  }))

  // 只读求值（agent 接口 + 后续 C 卡预览）：训练上下文/独立证券二选一；响应附数据来源说明
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
      source = normalized.source
      sourceWarnings.push(...normalized.warnings)
    }
    const timeframe = parseTimeframe(body.timeframe)
    const limit = parseLimit(body.limit)
    let data: Awaited<ReturnType<typeof trainingFormulaData>>
    if (body.trainingId !== undefined) {
      data = await trainingFormulaData(database, config, parsePositiveInteger(body.trainingId, 'trainingId'), timeframe, limit)
    } else if (typeof body.code === 'string' && body.code.trim() !== '') {
      data = await tdxFormulaData(database, config, body.code.trim(), limit)
    } else {
      throw new FormulaStoreError('trainingId 或 code 必填（决定求值数据来源）')
    }
    const engine = await provider()
    const auxiliaryFormulas: Record<string, string> = {}
    for (const row of listFormulaRows(database)) {
      if (currentId !== null && row.id === currentId) continue
      auxiliaryFormulas[row.name] = row.source
    }
    const warnings = [...data.warnings]
    for (const warning of sourceWarnings) if (!warnings.includes(warning)) warnings.push(warning)
    const result = evaluateOnBars(engine, {
      source,
      bars: data.bars,
      dates: data.dates,
      stockContext: data.stockContext,
      auxiliaryFormulas,
      limit: data.bars.length,
      warnings,
    })
    return { ...result, dataSource: { kind: data.source, note: data.note } }
  }))
}
