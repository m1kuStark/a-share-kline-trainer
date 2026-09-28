// 上海时区/自然月裁切反例（control-handoff-20260926-08 P2-3）：
// 上海 2026-09-26 00:30 回退起点应为 06-26（UTC toISOString 会错给 06-25）；
// 2026-05-31 减 3 月应为 02-28（月末裁切，不得溢出到 03-03）。
import { describe, expect, it } from 'vitest'
import { isBarCountValid, minusMonthsShanghai, rangeRequestOf, shanghaiToday } from '../../web/src/rangeDate'

describe('shanghai calendar date helpers', () => {
  it('shanghaiToday uses the Shanghai calendar date, not UTC', () => {
    // 2026-09-25T16:30Z = 上海 2026-09-26 00:30
    expect(shanghaiToday(new Date('2026-09-25T16:30:00Z'))).toBe('2026-09-26')
    // 2026-09-25T15:59Z = 上海 2026-09-25 23:59，仍是 25 日
    expect(shanghaiToday(new Date('2026-09-25T15:59:00Z'))).toBe('2026-09-25')
  })

  it('minusMonths rolls back three calendar months with month-end clamping', () => {
    // 普通日
    expect(minusMonthsShanghai('2026-09-26', 3)).toBe('2026-06-26')
    // 月末裁切：05-31 减 3 月落在 02-28
    expect(minusMonthsShanghai('2026-05-31', 3)).toBe('2026-02-28')
    // 跨年：2026-02-15 减 3 月 = 2025-11-15
    expect(minusMonthsShanghai('2026-02-15', 3)).toBe('2025-11-15')
  })
})

// control-handoff-20260926-09 P2：非法 N 必须被拒绝并保留用户输入，不得静默缩量为 1
describe('bar count validation', () => {
  it('rejects empty, zero, negative, fractional, non-finite and unsafe values', () => {
    const invalid = ['', 'abc', -1, 0, 1.5, 2.9, NaN, Infinity, -Infinity, 2 ** 53]
    for (const value of invalid) {
      expect(isBarCountValid(value), `value=${String(value)}`).toBe(false)
    }
  })

  it('accepts positive safe integers including 1', () => {
    for (const value of [1, 2, 61, 2 ** 40]) {
      expect(isBarCountValid(value), `value=${String(value)}`).toBe(true)
    }
  })

  it('rangeRequestOf passes barCount through verbatim (no silent clamping)', () => {
    expect(rangeRequestOf('2026-09-01', 'bars', 3, 0).count).toBe(0)
    expect(rangeRequestOf('2026-09-01', 'bars', 3, 1.5).count).toBe(1.5)
    expect(rangeRequestOf('2026-09-01', 'bars', 3, 5).count).toBe(5)
  })
})
