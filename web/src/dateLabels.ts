// CHART-WEEKDAY-01（Issue #8-C，用户 2026-11-07 拍板：悬浮卡＋时间轴＋状态条显示星期）：
// 纯展示层的日期标签函数。只接受 ISO 日线日期（YYYY-MM-DD）；周/月键或未知形态原样返回，
// 不臆造星期（周末/节假日外推刻度被既有 revealedTickTimestamp 锚定语义挡在轴外）。
// 星期按 UTC 日历计算（日期串无时区语义，与 randomDatePresentation.presentableDateString 同法）。
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function weekdayLabel(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return ''
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  // 回写校验：2026-02-30 这类"格式合法但日历不存在"的串会被 Date 滚动到 3 月，不得臆造星期
  if (date.toISOString().slice(0, 10) !== isoDate) return ''
  return WEEKDAYS[date.getUTCDay()] ?? ''
}

/** 日线日期 ＋ 星期：'2026-04-15' → '2026-04-15 周三'；非日线/无效串原样 */
export function withWeekday(isoDate: string): string {
  const label = weekdayLabel(isoDate)
  return label ? `${isoDate} ${label}` : isoDate
}

/** 时间轴刻度装饰：仅日K且该刻度命中真实 bar 日期时追加星期；空文本（遮蔽/无锚）原样。
 *  周/月K不加星期（周/月键没有单一日内星期语义）。 */
export function decorateAxisLabel(label: string, barDate: string | null | undefined, timeframe: string): string {
  if (!label || timeframe !== '1D' || !barDate) return label
  const weekday = weekdayLabel(barDate)
  return weekday ? `${label} ${weekday}` : label
}
