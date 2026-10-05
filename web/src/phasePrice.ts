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

export type PercentBadge = { text: string; cls: string }

/**
 * M6-02 涨幅徽标文本与配色档（candle-percent-hover 矩阵）：
 * pct=(close−previousClose)/previousClose×100 保留两位小数带符号（"+5.00%" "-2.00%"），
 * 红涨 pct-up / 绿跌 pct-down / 零与无变化 pct-flat（全工程红涨绿跌约定，同 phasePriceColor）。
 * 首根或前收不可用（null/undefined/0/非有限）与当前价缺失一律占位 "--"（灰），绝不做除零运算；
 * 两位小数下归零的小涨跌显示无符号 "0.00%"，不得出现 "-0.00%"。
 */
export function formatPercentBadge(close: number | null | undefined, previousClose: number | null | undefined): PercentBadge {
  const hasClose = typeof close === 'number' && Number.isFinite(close)
  const hasPrev = typeof previousClose === 'number' && Number.isFinite(previousClose) && previousClose !== 0
  if (!hasClose || !hasPrev) return { text: '--', cls: 'pct-flat' }
  const pct = ((close - previousClose) / previousClose) * 100
  const rounded = Math.round(pct * 100) / 100
  if (rounded === 0) return { text: '0.00%', cls: 'pct-flat' }
  return { text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`, cls: rounded > 0 ? 'pct-up' : 'pct-down' }
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
