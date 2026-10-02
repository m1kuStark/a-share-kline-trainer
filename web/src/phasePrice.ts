import type { AxisRange } from 'klinecharts'

export type TrainingPhase = 'open' | 'close'

export function previousDailyClose<T extends { close: number }>(dailyBars: readonly T[], phase: TrainingPhase | null | undefined): number | null {
  const index = phase === 'open' ? dailyBars.length - 1 : dailyBars.length - 2
  const value = dailyBars[index]?.close
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function hasPhasePrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0
}

export function phasePriceColor(price: number | null | undefined, previousClose: number | null | undefined): string {
  if (!hasPhasePrice(price) || !hasPhasePrice(previousClose)) return '#94a3b8'
  return price > previousClose ? '#ef4444' : price < previousClose ? '#16a34a' : '#94a3b8'
}

// Only the normal price axis uses this range. The library adds its own top/bottom
// padding afterwards; no synthetic candle or hidden OHLC is added to chart data.
export function includePhasePriceRange(range: AxisRange, price: number | null | undefined): AxisRange {
  if (!hasPhasePrice(price) || (price >= range.from && price <= range.to)) return range
  const from = Math.min(range.from, price)
  const to = Math.max(range.to, price)
  const span = to - from
  return { from, to, range: span, realFrom: from, realTo: to, realRange: span, displayFrom: from, displayTo: to, displayRange: span }
}
