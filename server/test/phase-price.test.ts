import { describe, expect, it } from 'vitest'
import { previousDailyClose } from '../../web/src/phasePrice'
import * as helpers from '../../web/src/phasePrice'

describe('phase price reference close', () => {
  const daily = [{ close: 10 }, { close: 11 }, { close: 12 }]

  it('uses the latest completed day before an open-phase execution price', () => {
    expect(previousDailyClose(daily, 'open')).toBe(12)
  })

  it('uses the previous completed day once the current day is closed', () => {
    expect(previousDailyClose(daily, 'close')).toBe(11)
  })

  it('returns null when there is no completed reference day', () => {
    expect(previousDailyClose([], 'open')).toBeNull()
    expect(previousDailyClose([{ close: 10 }], 'close')).toBeNull()
  })

  it('treats a missing phase as the legacy close-only mode', () => {
    expect(previousDailyClose(daily, undefined)).toBe(11)
    expect(previousDailyClose(daily, null)).toBe(11)
  })
})

describe('execution price color and visibility', () => {
  const helper = (name: string): (...args: unknown[]) => unknown => {
    const fn = (helpers as Record<string, unknown>)[name]
    expect(fn, `missing price helper ${name}`).toBeTypeOf('function')
    return fn as (...args: unknown[]) => unknown
  }

  it.each([
    { current: 9, previous: 10, want: '#16a34a' },
    { current: 11, previous: 10, want: '#ef4444' },
    { current: 10, previous: 10, want: '#94a3b8' },
    { current: 11, previous: null, want: '#94a3b8' },
    { current: NaN, previous: 10, want: '#94a3b8' },
  ])('colors $current against the explicit daily reference $previous', ({ current, previous, want }) => {
    expect(helper('phasePriceColor')(current, previous)).toBe(want)
  })

  it('only suppresses the built-in last marker for a finite positive execution price', () => {
    const usable = helper('hasPhasePrice')
    expect(usable(33.4)).toBe(true)
    for (const input of [null, undefined, 0, -1, NaN, Infinity]) expect(usable(input)).toBe(false)
  })

  it('includes a gap execution price in the normal axis range without changing data', () => {
    const include = helper('includePhasePriceRange')
    const range = { from: 10, to: 20, range: 10, realFrom: 10, realTo: 20, realRange: 10, displayFrom: 10, displayTo: 20, displayRange: 10 }
    expect(include(range, 30)).toEqual({ from: 10, to: 30, range: 20, realFrom: 10, realTo: 30, realRange: 20, displayFrom: 10, displayTo: 30, displayRange: 20 })
    expect(include(range, 5)).toEqual({ from: 5, to: 20, range: 15, realFrom: 5, realTo: 20, realRange: 15, displayFrom: 5, displayTo: 20, displayRange: 15 })
    expect(range.from).toBe(10)
    expect(range.to).toBe(20)
    expect(include(range, 15)).toBe(range)
    expect(include(range, null)).toBe(range)
  })
})
