import { describe, expect, it } from 'vitest'
import { calculateRangeStatistics, calculateTwoPointMeasurement, statisticsNumber } from '../../web/src/chartStatistics'

const bars = [
  { date: '2026-01-01', open: 98, high: 102, low: 97, close: 100, volume: 1000, amount: 100000 },
  { date: '2026-01-02', open: 101, high: 110, low: 99, close: 105, volume: 2000, amount: 200000 },
  { date: '2026-01-05', open: 105, high: 108, low: 95, close: 100, volume: 3000, amount: 300000 },
  { date: '2026-01-06', open: 100, high: 103, low: 96, close: 100, volume: 4000, amount: 400000 },
]

describe('two-point bar-range measurement (CHART-MEASURE-02)', () => {
  it('anchors both points to K-line closes and includes both endpoints', () => {
    const result = calculateTwoPointMeasurement(bars, 1, 3)!
    // bars[1].close=105, bars[3].close=100; 3 bars inclusive
    expect(result).toMatchObject({ from: 1, to: 3, count: 3, startDate: '2026-01-02', endDate: '2026-01-06',
      startClose: 105, endClose: 100, change: -5 })
    expect(result.changePct).toBeCloseTo((100 / 105 - 1) * 100)
    expect(result.range).toMatchObject({ high: 110, low: 95, volume: 9000, amount: 900000 })
  })
  it('normalizes reverse clicks to chronological range while keeping the same counts', () => {
    const forward = calculateTwoPointMeasurement(bars, 1, 3)
    expect(calculateTwoPointMeasurement(bars, 3, 1)).toEqual(forward)
  })
  it('supports one bar, clamped endpoints and rejects empty/invalid data', () => {
    expect(calculateTwoPointMeasurement(bars, 2, 2)).toMatchObject({ count: 1, startClose: 100, endClose: 100, change: 0, changePct: 0 })
    expect(calculateTwoPointMeasurement(bars, -99, 99)).toMatchObject({ from: 0, to: 3, count: 4, startClose: 100, endClose: 100 })
    expect(calculateTwoPointMeasurement([], 0, 1)).toBeNull()
    expect(calculateTwoPointMeasurement(bars, NaN, 1)).toBeNull()
    expect(calculateTwoPointMeasurement([{ ...bars[0]!, close: NaN }], 0, 0)).toBeNull()
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
