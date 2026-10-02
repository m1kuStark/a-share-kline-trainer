import { describe, expect, it, vi } from 'vitest'
import type { Chart, OverlayCreateFiguresCallbackParams, OverlayFigure } from 'klinecharts'
const registerOverlay = vi.hoisted(() => vi.fn())
vi.mock('klinecharts', () => ({ registerOverlay }))
import '../../web/src/overlays'

function figures(price: number, color = '#ef4444', fromZero = true): { point: OverlayFigure[]; axis: OverlayFigure[] } {
  const template = registerOverlay.mock.calls.map(([item]) => item).find((item: { name: string }) => item.name === 'phasePriceLine')
  expect(template).toBeTruthy()
  const overlay = { points: [{ value: price }], extendData: { price, color } }
  const last = {
    line: { show: true, style: 'dashed', size: 1, dashedValue: [4, 4] },
    text: { size: 12, color: '#ffffff', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4 },
  }
  // Figure callback inputs are public library boundaries; no chart state is mutated.
  const params = {
    overlay, coordinates: [{ x: 0, y: 40 }],
    bounding: { top: 0, bottom: 0, left: 0, right: 0, width: 400, height: 200 },
    chart: { getStyles: () => ({ candle: { priceMark: { last } } }) } as unknown as Chart,
    yAxis: { isFromZero: () => fromZero }, xAxis: null,
  } as OverlayCreateFiguresCallbackParams<unknown>
  const list = (result: OverlayFigure | OverlayFigure[] | undefined): OverlayFigure[] => result ? Array.isArray(result) ? result : [result] : []
  return { point: list(template.createPointFigures?.(params)), axis: list(template.createYAxisFigures?.(params)) }
}

describe('current execution price marker', () => {
  it('draws one latest-price dashed line without any price text inside the plot', () => {
    const result = figures(33.4)
    expect(result.point.map(item => item.type)).toEqual(['line'])
    expect(result.point[0].styles).toMatchObject({ style: 'dashed', size: 1, dashedValue: [4, 4], color: '#ef4444' })
  })

  it.each([
    { price: 33.4, color: '#ef4444', fromZero: true, x: 0, align: 'left', text: '33.40' },
    { price: 27.55, color: '#16a34a', fromZero: false, x: 400, align: 'right', text: '27.55' },
  ])('puts $text once on the price axis with the same direction color', ({ price, color, fromZero, x, align, text }) => {
    const result = figures(price, color, fromZero)
    expect(result.axis).toHaveLength(1)
    expect(result.axis[0]).toMatchObject({
      type: 'text', attrs: { x, y: 40, align, baseline: 'middle', text },
      styles: { color: '#ffffff', backgroundColor: color, size: 12 }, ignoreEvent: true,
    })
  })
})
