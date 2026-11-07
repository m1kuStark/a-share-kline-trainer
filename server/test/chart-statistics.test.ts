import { describe, expect, it } from 'vitest'
import { calculatePointMeasurement, calculateRangeStatistics, statisticsNumber } from '../../web/src/chartStatistics'

const bars = [
  { date: '2026-01-01', open: 98, high: 102, low: 97, close: 100, volume: 1000, amount: 100000 },
  { date: '2026-01-02', open: 101, high: 110, low: 99, close: 105, volume: 2000, amount: 200000 },
  { date: '2026-01-05', open: 105, high: 108, low: 95, close: 100, volume: 3000, amount: 300000 },
  { date: '2026-01-06', open: 100, high: 103, low: 96, close: 100, volume: 4000, amount: 400000 },
]

describe('two-point price measurement', () => {
  it('uses the actual first picked price and preserves reverse direction instead of date sorting', () => {
    expect(calculatePointMeasurement(80, 100, 10, 30)).toEqual({ startPrice: 80, endPrice: 100, change: 20, changePct: 25, count: 21 })
    expect(calculatePointMeasurement(100, 80, 30, 10)).toEqual({ startPrice: 100, endPrice: 80, change: -20, changePct: -20, count: 21 })
  })
  it('includes both endpoints and permits vertical measurement within one candle', () => {
    expect(calculatePointMeasurement(100, 103, 4, 4)).toMatchObject({ count: 1, change: 3, changePct: 3 })
    expect(calculatePointMeasurement(100, 100, 4, 5)).toMatchObject({ count: 2, change: 0, changePct: 0 })
    expect(calculatePointMeasurement(0, 5, 0, 1)).toMatchObject({ change: 5, changePct: null })
    expect(calculatePointMeasurement(-2, 5, 0, 1)?.changePct).toBeNull()
  })
  it('rejects invalid geometry and never returns an infinite percentage', () => {
    expect(calculatePointMeasurement(NaN, 1, 0, 1)).toBeNull()
    expect(calculatePointMeasurement(1, Infinity, 0, 1)).toBeNull()
    expect(calculatePointMeasurement(1, 2, -1, 1)).toBeNull()
    expect(calculatePointMeasurement(1, 2, 0, 1.5)).toBeNull()
    expect(calculatePointMeasurement(Number.MIN_VALUE, 1, 0, 1)?.changePct).toBeNull()
  })
})
describe('selected chart range statistics', () => {
  it('includes endpoints in both directions and calculates against the first selected prior close', () => {
    const result = calculateRangeStatistics(bars, 1, 3)!
    expect(result).toMatchObject({ count: 3, start: '2026-01-02', end: '2026-01-06', open: 101, close: 100,
      high: 110, low: 95, highDate: '2026-01-02', lowDate: '2026-01-05', base: 100, baseKind: 'previousClose',
      change: 0, changePct: 0, amplitudePct: 15, volume: 9000, amount: 900000, up: 1, down: 1, flat: 1, unclassified: 0 })
    expect(result.highPct).toBeCloseTo(10)
    expect(result.lowPct).toBeCloseTo(-5)
    expect(calculateRangeStatistics(bars, 3, 1)).toEqual(result)
    expect(bars[1]!.close).toBe(105)
  })
  it('supports one bar, clamped endpoints, missing previous close and unavailable volume without invented zeroes', () => {
    expect(calculateRangeStatistics(bars, 1, 1)).toMatchObject({ count: 1, change: 5, up: 1 })
    expect(calculateRangeStatistics(bars, -99, 99)).toMatchObject({ count: 4, base: 98, baseKind: 'firstOpen', unclassified: 1 })
    const only = [{ date: '****', open: 0, high: 0, low: 0, close: 0 }]
    expect(calculateRangeStatistics(only, 0, 0)).toMatchObject({ base: null, changePct: null, amplitudePct: null, volume: null, amount: null, start: '****' })
    expect(calculateRangeStatistics([], 0, 0)).toBeNull()
    expect(calculateRangeStatistics(bars, NaN, 0)).toBeNull()
    expect(calculateRangeStatistics([{ ...bars[0]!, high: NaN }], 0, 0)).toBeNull()
  })
  it('uses only the supplied cutoff data, handles weekly/monthly bars and clears negative zero', () => {
    const result = calculateRangeStatistics(bars.slice(0, 2), 0, 999)!
    expect(result.count).toBe(2)
    expect(result.end).toBe('2026-01-02')
    expect(result.low).toBe(97)
    expect(calculateRangeStatistics(bars.map(bar => ({ ...bar, date: '2026-01' })), 0, 1)?.count).toBe(2)
    expect(statisticsNumber(-0.0001, '%', true)).toBe('0.00%')
    expect(statisticsNumber(5, '%', true)).toBe('+5.00%')
    expect(statisticsNumber(null)).toBe('--')
  })
})
