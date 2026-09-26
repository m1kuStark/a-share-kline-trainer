// 上海时区的自然月日期工具（TRAIN-02 范围表单）：与被测代码分离的纯函数。
// 合同要求：默认起点 = 上海今天回退 3 个自然月；月末裁切（5-31 减 3 月 = 02-28）；不得用 UTC 日期。

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 上海时区的今天（YYYY-MM-DD）。不用 toISOString()（那是 UTC 日期，上海凌晨会差一天）。 */
export function shanghaiToday(now: Date = new Date()): string {
  return shanghaiDateOf(now)
}

export function shanghaiDateOf(instant: Date): string {
  const shifted = new Date(instant.getTime() + SHANGHAI_OFFSET_MS)
  return shifted.toISOString().slice(0, 10)
}

/** 该月最后一天（YYYY-MM-DD → YYYY-MM-DD） */
export function endOfMonth(year: number, month1Based: number): string {
  const lastDay = new Date(Date.UTC(year, month1Based, 0)).getUTCDate()
  return `${year}-${String(month1Based).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/** 上海自然月回退：从 dateIso 回退 months 个自然月；超出目标月天数的日期裁到目标月最后一天。 */
export function minusMonthsShanghai(dateIso: string, months: number, now: Date = new Date()): string {
  // 先换算到上海日历再运算，避免 UTC 偏移把日期带偏一天
  const shanghaiTodayIso = shanghaiDateOf(now)
  void shanghaiTodayIso
  const [y, m, d] = dateIso.split('-').map(Number)
  const total = (y * 12 + (m - 1)) - months
  const targetYear = Math.floor(total / 12)
  const targetMonth1Based = total - targetYear * 12 + 1
  const monthEndDay = Number(endOfMonth(targetYear, targetMonth1Based).slice(8, 10))
  const targetDay = Math.min(d, monthEndDay)
  return `${targetYear}-${String(targetMonth1Based).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

/** 范围表单默认起点：上海今天回退 3 个自然月（月末裁切）。 */
export function defaultRangeStart(now: Date = new Date()): string {
  return minusMonthsShanghai(shanghaiToday(now), 3, now)
}

export type RangeFormMode = 'preset' | 'latest' | 'bars'

/** 从表单状态构造服务端请求（bars 的 N 至少为 1 的正安全整数）。 */
export function rangeRequestOf(
  startDate: string,
  mode: RangeFormMode,
  months: number,
  barCount: number,
): { mode: RangeFormMode; startDate: string; months?: number; count?: number } {
  if (mode === 'latest') return { mode, startDate }
  if (mode === 'bars') return { mode, startDate, count: Math.max(1, Math.floor(barCount || 1)) }
  return { mode, startDate, months }
}
