import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { appMaSettings, MA_STORAGE_KEY, maPreset, maValidationError, maWarmup, readMaSettings, saveMaSettings } from '../../web/src/maSettings'
import { trainingLoadBars } from '../src/train/engine'

afterEach(() => { vi.unstubAllGlobals(); appMaSettings.value = maPreset() })

describe('MA preferences', () => {
  it('retains old defaults and recovers from corrupt, future or inaccessible storage', () => {
    const defaults = maPreset()
    expect(defaults.lines.map(line => line.period)).toEqual([25, 60, 144, 0, 0, 0, 0, 0])
    for (const raw of [null, '{', '{}', JSON.stringify({ ...defaults, version: 2 }), JSON.stringify({ ...defaults, lines: [] })]) {
      expect(readMaSettings({ getItem: () => raw })).toEqual(defaults)
    }
    expect(readMaSettings({ getItem: () => { throw new Error('denied') } })).toEqual(defaults)
  })
  it('accepts zero and 1000, rejects duplicate, fractional, blank and out-of-range periods', () => {
    expect(maValidationError(maPreset([1000]))).toBeNull()
    expect(maValidationError(maPreset([]))).toBeNull()
    for (const periods of [[5, 5], [-1], [1.5], [1001], [NaN]]) expect(maValidationError(maPreset(periods))).not.toBeNull()
    const blank = maPreset() as unknown as { version: number; lines: Array<{ period: unknown; color: string }> }
    blank.lines[0].period = ''
    expect(maValidationError(blank)).toContain('第 1 条')
    const invalidColor = maPreset(); invalidColor.lines[2].color = 'red'
    expect(maValidationError(invalidColor)).toContain('第 3 条颜色')
  })
  it('persists an independent copy and does not publish a failed write', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => store.set(key, value) })
    const settings = maPreset([5, 10, 25, 60]); settings.lines[0].color = '#123456'
    saveMaSettings(settings)
    settings.lines[0].period = 9
    expect(appMaSettings.value.lines[0]).toEqual({ period: 5, color: '#123456' })
    expect(readMaSettings({ getItem: key => store.get(key) ?? null })).toEqual(appMaSettings.value)
    expect(store.has(MA_STORAGE_KEY)).toBe(true)
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(() => saveMaSettings(maPreset([250]))).toThrow('quota')
    expect(appMaSettings.value.lines[0].period).toBe(5)
  })
})

describe('MA history and pinned library calculation', () => {
  it('loads extra history only for enabled long periods, retaining the old window for defaults and short presets', () => {
    for (const periods of [[25, 60, 144], [5, 10, 20, 60], [], [201]]) {
      expect(trainingLoadBars(maWarmup(maPreset(periods)))).toBe(1040)
    }
    expect(trainingLoadBars(maWarmup(maPreset([250])))).toBe(1089)
    expect(trainingLoadBars(maWarmup(maPreset([1000])))).toBe(1839)
  })
  it('retains the default load window and bounds the extended warmup', () => {
    expect(trainingLoadBars()).toBe(1040)
    expect(trainingLoadBars(0)).toBe(840)
    expect(trainingLoadBars(999)).toBe(1839)
    for (const warmup of [-1, 1.5, 1000, NaN]) expect(() => trainingLoadBars(warmup)).toThrow('warmup')
  })
  it('calculates equal-weight closes only once the full requested window exists', () => {
    // Evaluate the actual pinned library template, without constructing a canvas or copying its algorithm.
    const source = readFileSync(new URL('../../node_modules/klinecharts/dist/index.esm.js', import.meta.url), 'utf8')
    const start = source.indexOf('var movingAverage = {')
    const end = source.indexOf('\n};', start)
    expect(start).toBeGreaterThan(0)
    const ma = runInNewContext(`${source.slice(start, end + 3)}; movingAverage`) as {
      regenerateFigures: (periods: number[]) => Array<{ key: string }>
      calc: (bars: Array<{ close: number }>, indicator: unknown) => Array<Record<string, number>>
    }
    const periods = [1, 3, 1000]
    const result = ma.calc(Array.from({ length: 1001 }, (_, index) => ({ close: index + 1 })), { calcParams: periods, figures: ma.regenerateFigures(periods) })
    expect(result[0]).toEqual({ ma1: 1 })
    expect(result[2].ma2).toBe(2)
    expect(result[3].ma2).toBe(3)
    expect(result[998].ma3).toBeUndefined()
    expect(result[999].ma3).toBe(500.5)
    expect(result[1000].ma3).toBe(501.5)
  })
})
