import { describe, expect, it } from 'vitest'
import { decorateAxisLabel, weekdayLabel, withWeekday } from '../../web/src/dateLabels'

// CHART-WEEKDAY-01（Issue #8-C，用户 2026-11-07 拍板）：悬浮卡/时间轴/状态条显示星期。
// oracle 独立性：星期值按公历手算（2026-01-01＝周四；2024-02-29＝周四），不调用实现函数反推。
describe('CHART-WEEKDAY-01 日期标签纯函数', () => {
  it('ISO 日线日期给出中文星期（手算公历 oracle）', () => {
    expect(weekdayLabel('2026-04-15')).toBe('周三') // 2026 年第 105 天（01-01 周四）→ 周三
    expect(weekdayLabel('2026-11-07')).toBe('周六') // 第 311 天 → 周六
    expect(weekdayLabel('2024-02-29')).toBe('周四') // 闰日：2024-01-01 周一，第 60 天 → 周四
    expect(weekdayLabel('2026-01-01')).toBe('周四')
  })

  it('withWeekday 只装饰合法日线日期；周/月键与未知形态原样返回', () => {
    expect(withWeekday('2026-04-15')).toBe('2026-04-15 周三')
    expect(withWeekday('2026-11')).toBe('2026-11')
    expect(withWeekday('')).toBe('')
    expect(withWeekday('not-a-date')).toBe('not-a-date')
    expect(withWeekday('2026-02-30')).toBe('2026-02-30') // 非法日历日不臆造星期
  })

  it('时间轴刻度仅日K且命中真实 bar 日期时追加星期', () => {
    expect(decorateAxisLabel('04-15', '2026-04-15', '1D')).toBe('04-15 周三')
    expect(decorateAxisLabel('2026-04-15', '2026-04-15', '1D')).toBe('2026-04-15 周三')
    // 周/月K 不加
    expect(decorateAxisLabel('2026-04-15', '2026-04-15', '1W')).toBe('2026-04-15')
    expect(decorateAxisLabel('2026-04', '2026-04', '1M')).toBe('2026-04')
    // 遮蔽/无锚空文本、无 bar 日期原样
    expect(decorateAxisLabel('', '2026-04-15', '1D')).toBe('')
    expect(decorateAxisLabel('04-15', null, '1D')).toBe('04-15')
    expect(decorateAxisLabel('04-15', '', '1D')).toBe('04-15')
  })
})
