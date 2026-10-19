// RF2-02 随机时间遮蔽的日期呈现层纯函数（2026-10-19 M2-RANDOM-AXIS-01 自 KlineChart.vue
// 抽出：浏览器本轮被并行 e2e 占用，揭示换算语义需可在单元层锁定）。
// 三个纯函数：
// - presentableTimestamp / presentableDateString：遮蔽期星号、揭示期常量差换算（原 SFC 内联逻辑，
//   行为等价迁移；先例＝SessionReplay.realDateOf 的「偏移起始日↔真实起始日」常量差）。
// - revealedTickTimestamp：M2-RANDOM-AXIS-01 揭示态轴刻度换算入口（含交易日锚定语义）。
// 坐标系约定：入参时间戳/日期串均在「呈现空间」＝运行中遮蔽偏移空间（服务器把真实日期逐响应
// 加会话常量 offsetDays）；shiftDays＝reveal 真实起始日−遮蔽起始日的日历日差（＝−offsetDays），
// 对真实 bar 的日期字符串是精确还原（掩码＝纯日历日平移，逐日保留间距与缺口）。

export const MS_PER_DAY = 86_400_000
export const MASKED_DATE_TEXT = '******'

/** 揭示态时间戳换算：呈现空间 ts ＋ N 天（N=0 原样；整数日恒精确，无时区损耗——两端均 UTC 零点） */
export function presentableTimestamp(timestamp: number, shiftDays: number): number {
  return shiftDays === 0 ? timestamp : timestamp + shiftDays * MS_PER_DAY
}

/** 呈现层日期字符串换算：支持完整日期与月键（周/月观察周期的 bar.date 形态）；未知形态原样 */
export function presentableDateString(date: string, shiftDays: number): string {
  if (shiftDays === 0) return date
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(Date.parse(`${date}T00:00:00Z`) + shiftDays * MS_PER_DAY).toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}$/.test(date)) return new Date(Date.parse(`${date}-01T00:00:00Z`) + shiftDays * MS_PER_DAY).toISOString().slice(0, 7)
  return date
}

/**
 * M2-RANDOM-AXIS-01 揭示态轴刻度换算：真实日期必须以该位置真实 bar 为锚。
 * barTimestamps＝图表已加载 K 线（呈现空间）的时间戳集合；刻度时间戳命中集合＝该位置有真实
 * bar，常量差换算即该 bar 的真实交易日（精确）；未命中＝klinecharts 对越界 dataIndex 的日历日
 * 外推位置（右侧空白边距等，无对应 bar）——返回 null＝不呈现日期，杜绝揭示出周末/节假日假日期。
 * shiftDays=0（未揭示/经典模式）恒原样返回：经典轴显示不在本修复范围。
 */
export function revealedTickTimestamp(timestamp: number, barTimestamps: ReadonlySet<number> | null, shiftDays: number): number | null {
  if (shiftDays === 0) return timestamp
  if (barTimestamps !== null && !barTimestamps.has(timestamp)) return null
  return presentableTimestamp(timestamp, shiftDays)
}
