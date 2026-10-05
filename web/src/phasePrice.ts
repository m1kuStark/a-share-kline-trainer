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
 * M6-03 起该口径由悬浮信息卡的"涨幅"行携带（徽标形式废止），冻结公式不变。
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

// M6-03 悬浮信息卡（candle-percent-hover 矩阵 v2，用户 2026-10-05 验收拍板）：
// 指针停留同一根 K 线 ≥1000ms 触发（通达信参照）；该常量为冻结口径，导出供组件定时器引用。
export const HOVER_CARD_DWELL_MS = 1000

export type HoverCardRow = { label: string; value: string }
export type HoverCardModel = { date: string; rows: HoverCardRow[]; pct: PercentBadge }

/**
 * M6-03 信息卡内容（日期＋开/高/低/收两位小数＋涨幅）：
 * 涨幅沿用 formatPercentBadge 冻结公式（首根/前收不可用 → "--" 灰，除零保护在彼处）；
 * OHLC 四值任一非有限数字时不产出卡（buildHoverModel 对缺行返回 null，模板不渲染）。
 * 卡内不包含星期/量能字段（呈现类待拍板，默认不加）。
 */
export function formatHoverCard(
  bar: { date?: string; open: number; high: number; low: number; close: number } | null | undefined,
  previousClose: number | null | undefined,
): HoverCardModel | null {
  if (!bar) return null
  const { open, high, low, close } = bar
  if (![open, high, low, close].every(value => typeof value === 'number' && Number.isFinite(value))) return null
  return {
    date: typeof bar.date === 'string' ? bar.date : '',
    rows: [
      { label: '开', value: open.toFixed(2) },
      { label: '高', value: high.toFixed(2) },
      { label: '低', value: low.toFixed(2) },
      { label: '收', value: close.toFixed(2) },
    ],
    pct: formatPercentBadge(close, previousClose),
  }
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
