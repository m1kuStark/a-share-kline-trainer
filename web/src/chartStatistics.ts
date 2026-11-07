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

/** Pick order is significant: a backward drag still uses its first price as base. */
export function calculatePointMeasurement(startPrice: number, endPrice: number, startIndex: number, endIndex: number): {
  startPrice: number; endPrice: number; change: number; changePct: number | null; count: number
} | null {
  if (![startPrice, endPrice, startIndex, endIndex].every(Number.isFinite)
    || !Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < 0) return null
  const change = endPrice - startPrice
  if (!Number.isFinite(change)) return null
  const pct = startPrice > 0 ? change / startPrice * 100 : null
  return { startPrice, endPrice, change, changePct: pct !== null && Number.isFinite(pct) ? pct : null, count: Math.abs(endIndex - startIndex) + 1 }
}
