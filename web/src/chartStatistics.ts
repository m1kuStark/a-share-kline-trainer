export interface StatisticsBar {
  date?: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
  amount?: number
}
export interface RangeStatistics {
  count: number
  start: string
  end: string
  open: number
  close: number
  high: number
  low: number
  highDate: string
  lowDate: string
  base: number | null
  baseKind: 'previousClose' | 'firstOpen'
  change: number | null
  changePct: number | null
  amplitudePct: number | null
  highPct: number | null
  lowPct: number | null
  volume: number | null
  amount: number | null
  up: number
  down: number
  flat: number
  unclassified: number
}
const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

/** Inclusive range over the already cutoff/adjusted chart data. No reads or writes. */
export function calculateRangeStatistics(bars: readonly StatisticsBar[], a: number, b: number): RangeStatistics | null {
  if (!bars.length || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const from = Math.max(0, Math.min(bars.length - 1, Math.floor(Math.min(a, b))))
  const to = Math.max(0, Math.min(bars.length - 1, Math.floor(Math.max(a, b))))
  const selected = bars.slice(from, to + 1)
  if (selected.some(bar => ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))) return null
  const first = selected[0]!, last = selected.at(-1)!
  const prior = bars[from - 1]?.close
  const baseKind = positive(prior) ? 'previousClose' : 'firstOpen'
  const base = positive(prior) ? prior : positive(first.open) ? first.open : null
  const pct = (price: number) => base === null ? null : (price / base - 1) * 100
  const highest = selected.reduce((result, bar) => bar.high > result.high ? bar : result, first)
  const lowest = selected.reduce((result, bar) => bar.low < result.low ? bar : result, first)
  let up = 0, down = 0, flat = 0, unclassified = 0
  for (let index = from; index <= to; index++) {
    const previous = bars[index - 1]?.close
    if (!positive(previous)) { unclassified++; continue }
    const close = bars[index]!.close
    if (close > previous) up++
    else if (close < previous) down++
    else flat++
  }
  const sum = (key: 'volume' | 'amount'): number | null => {
    if (selected.some(bar => typeof bar[key] !== 'number' || !Number.isFinite(bar[key]) || bar[key]! < 0)) return null
    return selected.reduce((value, bar) => value + bar[key]!, 0)
  }
  return {
    count: selected.length, start: first.date ?? '--', end: last.date ?? '--', open: first.open, close: last.close,
    high: highest.high, low: lowest.low, highDate: highest.date ?? '--', lowDate: lowest.date ?? '--', base, baseKind,
    change: base === null ? null : last.close - base, changePct: pct(last.close),
    amplitudePct: base === null ? null : (highest.high - lowest.low) / base * 100,
    highPct: pct(highest.high), lowPct: pct(lowest.low), volume: sum('volume'), amount: sum('amount'),
    up, down, flat, unclassified,
  }
}

export function statisticsNumber(value: number | null, suffix = '', signed = false): string {
  if (value === null || !Number.isFinite(value)) return '--'
  const rounded = Number(value.toFixed(2))
  return `${signed && rounded > 0 ? '+' : ''}${rounded.toFixed(2)}${suffix}`
}

export interface TwoPointMeasurement {
  from: number
  to: number
  count: number
  startDate: string
  endDate: string
  startClose: number
  endClose: number
  change: number
  changePct: number | null
  range: RangeStatistics
}

/**
 * CHART-MEASURE-02：两点测量改为「K 线区间」口径——两次 Shift 点击确定起止 K 线，
 * 涨跌幅/价差按起止两根的收盘价计算，K 线数量含首尾；区间高/低/振幅/量额沿用区间统计。
 */
export function calculateTwoPointMeasurement(bars: readonly StatisticsBar[], a: number, b: number): TwoPointMeasurement | null {
  const range = calculateRangeStatistics(bars, a, b)
  if (!range || !bars.length) return null
  const from = Math.max(0, Math.min(bars.length - 1, Math.floor(Math.min(a, b))))
  const to = Math.max(0, Math.min(bars.length - 1, Math.floor(Math.max(a, b))))
  const startClose = bars[from]!.close
  const endClose = bars[to]!.close
  if (!Number.isFinite(startClose) || !Number.isFinite(endClose)) return null
  const change = endClose - startClose
  const changePct = startClose > 0 ? change / startClose * 100 : null
  return {
    from, to, count: range.count, startDate: range.start, endDate: range.end,
    startClose, endClose, change, changePct: changePct !== null && Number.isFinite(changePct) ? changePct : null,
    range,
  }
}
