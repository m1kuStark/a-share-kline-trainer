import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { AppConfig } from '../config.js'
import { trainingBars } from '../train/engine.js'
import { transformRandomPayload, type RandomSession } from '../train/random-mode.js'
import type { Timeframe } from '../tdx/kline.js'
import { readDayFileRange, type DayBar } from '../tdx/dayfile.js'
import { parseTdxSymbol } from '../tdx/symbol.js'
import { industryByCode, loadIndustryCatalog } from '../tdx/industry.js'
import { FormulaStoreError } from './storage.js'
import type { FormulaBar } from './types.js'

export interface FormulaData {
  bars: FormulaBar[]
  dates: string[]
  source: 'training' | 'tdx'
  note: string
  stockContext: Record<string, unknown> | null
  warnings: string[]
}

/** 本地日历日 → 本地午夜毫秒（引擎 HY_INDEX 系列/跨周期按本地日历日对齐的配套约定） */
export function timestampOfDate(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

export function toFormulaBars(rows: DayBar[]): FormulaBar[] {
  return rows.map(bar => ({
    timestamp: timestampOfDate(bar.date),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
  }))
}

export interface FormulaDataRequest {
  trainingId?: number
  code?: string
  timeframe: Timeframe
  limit: number
}

/** M7-01 随机训练：响应照常生成后再按会话规则遮蔽日期/时间戳与代码/名称，禁止旁路泄露 */
export function maskFormulaEvaluationForRandomSession<T>(payload: T, session: RandomSession): T {
  return transformRandomPayload(payload, session) as T
}

/** 训练上下文：必须先截断至推进日、再复权、再聚合（trainingBars 既有唯一链路） */
export async function trainingFormulaData(database: DatabaseSync, config: AppConfig, trainingId: number, timeframe: Timeframe, limit: number): Promise<FormulaData> {
  const row = database.prepare('SELECT code, name FROM trainings WHERE id = ?').get(trainingId) as unknown as { code: string; name: string } | undefined
  if (!row) throw new FormulaStoreError('训练不存在', 404)
  let series: Awaited<ReturnType<typeof trainingBars>>
  try {
    series = await trainingBars(database, config, trainingId, timeframe, 250)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new FormulaStoreError('训练行情读取失败：' + message, 422)
  }
  const bars = series.slice(-limit)
  const warnings: string[] = []
  if (limit > bars.length) warnings.push('训练上下文本次最多返回 ' + bars.length + ' 根（请求 limit=' + limit + '，已按实际行情截断）')
  const context = await buildStockContext(database, config, row.code, row.name)
  return {
    bars: toFormulaBars(bars),
    dates: bars.map(bar => bar.date),
    source: 'training',
    note: '训练上下文：已按推进日截断→复权→聚合（trainingBars 唯一链路）',
    stockContext: context.context,
    warnings: [...context.warnings, ...warnings],
  }
}

/** 独立证券上下文：TDX 日线最近 N 根（不复权；响应显式声明，避免冒充训练空间） */
export async function tdxFormulaData(database: DatabaseSync, config: AppConfig, symbol: string, limit: number): Promise<FormulaData> {
  if (!config.tdxRoot) throw new FormulaStoreError('TDX 目录未配置；独立证券求值不可用', 503)
  let parsed: { code: string; market: string }
  try {
    parsed = parseTdxSymbol(symbol)
  } catch (error) {
    throw new FormulaStoreError('code 非法：' + (error instanceof Error ? error.message : String(error)), 400)
  }
  const dayPath = join(config.tdxRoot, 'vipdoc', parsed.market, 'lday', parsed.market + parsed.code + '.day')
  let daily: DayBar[]
  try {
    daily = await readDayFileRange(dayPath)
  } catch {
    throw new FormulaStoreError('日线缺失或不可读：vipdoc/' + parsed.market + '/lday/' + parsed.market + parsed.code + '.day', 404)
  }
  const rows = daily.slice(-limit)
  const name = (database.prepare('SELECT name FROM stocks WHERE code = ?').get(parsed.code) as unknown as { name: string } | undefined)?.name ?? parsed.code
  const context = await buildStockContext(database, config, parsed.code, name)
  return {
    bars: toFormulaBars(rows),
    dates: rows.map(bar => bar.date),
    source: 'tdx',
    note: '独立证券上下文：TDX 日线最近 ' + rows.length + ' 根，不复权（未经过训练截断/复权链）',
    stockContext: context.context,
    warnings: context.warnings,
  }
}

/** 构造引擎 StockContext（M9-03 契约）：行业归属 + 880 行业指数日线（按本地日历日对齐） */
export async function buildStockContext(database: DatabaseSync, config: AppConfig, code: string, name: string): Promise<{ context: Record<string, unknown> | null; warnings: string[] }> {
  const warnings: string[] = []
  if (!config.tdxRoot) {
    warnings.push('未配置 TDX 目录；FINANCE/NAMELIKE 可用但行业上下文函数不可用')
    return { context: { code, name, industry: null }, warnings }
  }
  const catalog = await loadIndustryCatalog(config)
  if (!catalog.ok) {
    warnings.push('行业目录不可读：' + catalog.reason)
    return { context: { code, name, industry: null }, warnings }
  }
  const entry = industryByCode(catalog.catalog).get(code)
  if (!entry) {
    warnings.push('行业目录中未找到 ' + code + ' 的行业归属')
    return { context: { code, name, industry: null }, warnings }
  }
  const indexCode = /^880\d{3}$/.test(entry.id) ? 'sh' + entry.id : null
  let industryIndexBars: FormulaBar[] | undefined
  if (indexCode) {
    try {
      const daily = await readDayFileRange(join(config.tdxRoot, 'vipdoc', 'sh', 'lday', indexCode + '.day'))
      industryIndexBars = toFormulaBars(daily)
    } catch {
      warnings.push('行业指数日线缺失或不可读：vipdoc/sh/lday/' + indexCode + '.day')
    }
  }
  return {
    context: {
      code,
      name,
      industry: { name: entry.name, blockCode: entry.blockCode ?? null, indexCode },
      ...(industryIndexBars ? { industryIndexBars } : {}),
    },
    warnings,
  }
}
