import { join } from 'node:path'
import type { AppConfig } from '../config.js'
import { readDayFileRange, type DayBar } from '../tdx/dayfile.js'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from './engine.js'

const BENCHMARKS = {
  sh000001: join('vipdoc', 'sh', 'lday', 'sh000001.day'),
  sz399303: join('vipdoc', 'sz', 'lday', 'sz399303.day'),
} as const

export type EquityComparisonSeries = { date: string; user: number; sh000001?: number; sz399303?: number }
export interface EquityComparisonPayload {
  trainingId: number
  series: EquityComparisonSeries[]
  benchmarks: Record<string, { ok: boolean; reason?: string }>
}

export async function equityComparison(database: DatabaseSync, config: AppConfig, id: number, requested: string[]): Promise<EquityComparisonPayload> {
  const row = database.prepare('SELECT id, status, start_date, settle_date, initial_cash FROM trainings WHERE id = ?').get(id) as unknown as { id: number; status: string; start_date: string; settle_date: string | null; initial_cash: number } | undefined
  if (!row) throw new HttpError(404, `训练 ${id} 不存在`)
  if (row.status !== 'settled' || !row.settle_date) throw new HttpError(409, '训练尚未结算', 'HISTORY_NOT_SETTLED')
  const points = database.prepare('SELECT date, equity FROM equity_curve WHERE training_id = ? AND date >= ? AND date <= ? ORDER BY date').all(id, row.start_date, row.settle_date) as unknown as Array<{ date: string; equity: number }>
  const dates = points.map(point => point.date)
  const result: EquityComparisonPayload = { trainingId: id, series: points.map(point => ({ date: point.date, user: (point.equity - row.initial_cash) / row.initial_cash })), benchmarks: {} }
  for (const key of requested.filter(value => value in BENCHMARKS)) {
    if (!config.tdxRoot) { result.benchmarks[key] = { ok: false, reason: '未连接通达信数据目录' }; continue }
    let bars: DayBar[]
    try { bars = await readDayFileRange(join(config.tdxRoot, BENCHMARKS[key as keyof typeof BENCHMARKS])) }
    catch { result.benchmarks[key] = { ok: false, reason: `${key} 日线缺失或不可读` }; continue }
    const usable = bars.filter(bar => bar.date <= row.settle_date! && Number.isFinite(bar.close) && bar.close > 0)
    const base = [...usable].reverse().find(bar => bar.date <= row.start_date)?.close
    if (!base) { result.benchmarks[key] = { ok: false, reason: `${key} 在训练区间没有有效收盘价` }; continue }
    const byDate = new Map(usable.map(bar => [bar.date, bar.close / base - 1]))
    let previous: number | undefined
    for (const point of result.series) {
      const value = byDate.get(point.date)
      if (value !== undefined) previous = value
      if (previous !== undefined) point[key as 'sh000001' | 'sz399303'] = previous
    }
    result.benchmarks[key] = { ok: true }
  }
  // Keep the response explicitly date-aligned to persisted equity points.
  result.series = result.series.filter(point => dates.includes(point.date))
  return result
}
