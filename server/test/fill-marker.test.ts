import { describe, expect, it, vi } from 'vitest'
const registerOverlay = vi.hoisted(() => vi.fn())
vi.mock('klinecharts', () => ({ registerOverlay }))
import '../../web/src/overlays'
import * as layout from '../../web/src/tradeMarkerLayout'

const ts = Date.parse('2025-01-03T00:00:00Z')
const template = registerOverlay.mock.calls.map(([item]) => item).find(item => item.name === 'bsMark')
function figures(side: string, x = 90, y = 70, bar = ts, pixelIndex = 1) {
  return template.createPointFigures({ coordinates: [{ x, y }], bounding: { width: 200, height: 100 },
    overlay: { points: [{ timestamp: ts, value: 25 }], extendData: { side, shares: 100, price: 35 } },
    xAxis: { convertFromPixel: () => pixelIndex }, chart: { getDataList: () => [{ timestamp: ts - 86400000 }, { timestamp: bar }] } })
}
describe('fill marker geometry', () => {
  it('renders buy and sell figures at the exact period bar and rejects missing bars', () => {
    for (const [side, glyph, direction] of [['buy', 'B', 1], ['sell', 'S', -1]] as const) {
      const ink = figures(side)
      const arrow = ink.find((f: any) => f.type === 'polygon')?.attrs.coordinates
      expect(arrow?.[0]).toEqual({ x: 90, y: 70 })
      expect(arrow.slice(1).every((p: any) => (p.y - 70) * direction > 0)).toBe(true)
      // Two trades can share one weekly candle, with the sell below the buy.
      // Fan their bodies to opposite sides without shifting the price anchor.
      expect(arrow.slice(1).every((p: any) => (p.x - 90) * direction < 0)).toBe(true)
      expect(ink.find((f: any) => f.type === 'text')?.attrs.text).toBe(glyph)
      expect(ink.every((f: any) => f.ignoreEvent === true)).toBe(true)
    }
    expect(figures('buy', 90, 70, ts - 86400000)).toEqual([])
    expect(figures('buy', -1)).toEqual([])
    expect(figures('sell', 90, 101)).toEqual([])
    expect(figures('buy', 90, NaN)).toEqual([])
  })
  it('does not lose a disclosed fill when neighbouring candles share a pixel', () => {
    // Under 1px/bar, a round trip can resolve to the neighbouring candle.
    expect(figures('buy', 23, 70, ts, 0).some((f: any) => f.type === 'polygon')).toBe(true)
    expect(figures('buy', 23, 70, ts + 86400000, 0)).toEqual([])
  })
  it('uses the UTC period start for both chart and rail', () => {
    for (const [tf, expected] of [['1D', '2025-01-03'], ['1W', '2024-12-30'], ['1M', '2025-01-01']] as const) {
      const instant = Date.parse(`${expected}T00:00:00Z`)
      expect(layout.tradePeriodTimestamp('2025-01-03', tf)).toBe(instant)
      const project = vi.fn(() => 15)
      layout.groupTradeMarkers([{ seq: 1, date: '2025-01-03', side: 'buy', shares: 100, price: 25, amount: 2500, fee: 5 }], tf, project, 300)
      expect(project).toHaveBeenCalledWith(instant)
    }
  })
})
