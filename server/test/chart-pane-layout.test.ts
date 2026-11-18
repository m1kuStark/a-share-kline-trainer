import { describe, expect, it } from 'vitest'
import { allocateSubPaneHeights, paneResizeGeometryMatches } from '../../web/src/chartPaneLayout'

const panes = [
  ...['VOL', 'MACD', 'KDJ'].map(id => ({ id, height: 100, minHeight: 30 })),
  ...['F1', 'F2', 'F3'].map(id => ({ id, height: 120, minHeight: 90 })),
]
describe('normal pane height budget', () => {
  it('retains main and every configured subpane minimum at the captured 628px host', () => {
    // Independent capture: 628 host - 26 xAxis - six 1px separators = 596.
    const allocated = allocateSubPaneHeights(596, 100, panes)
    expect(allocated).toHaveLength(6)
    expect(596 - allocated.reduce((sum, pane) => sum + pane.height, 0)).toBeCloseTo(100, 6)
    allocated.forEach((pane, index) => expect(pane.height).toBeGreaterThanOrEqual(panes[index]!.minHeight))
    expect(allocated[0]!.height).toBeCloseTo(61.7333333333, 6)
    expect(allocated[3]!.height).toBeCloseTo(103.6, 6)
  })
  it('leaves ordinary four-pane and roomy six-subpane requests unchanged', () => {
    expect(allocateSubPaneHeights(596, 100, panes.slice(0, 3))).toEqual(panes.slice(0, 3))
    expect(allocateSubPaneHeights(900, 100, panes)).toEqual(panes)
  })
  it('scales all effective minima proportionally when the configured floors cannot fit', () => {
    const allocated = allocateSubPaneHeights(230, 100, panes)
    expect(allocated).toHaveLength(6)
    expect(230 - allocated.reduce((sum, pane) => sum + pane.height, 0)).toBeCloseTo(50, 6)
    allocated.forEach((pane, index) => { expect(pane.height).toBeGreaterThan(0); expect(pane.height).toBeCloseTo(panes[index]!.minHeight / 2, 6); expect(pane.minHeight).toBe(pane.height) })
    expect(allocateSubPaneHeights(900, 100, panes)).toEqual(panes)
  })
})

describe('pane resize gesture geometry', () => {
  const start = { width: 1200, height: 628, paneIds: ['candle_pane', 'VOL', 'MACD', 'F1'] }
  it('accepts unchanged geometry without depending on array identity', () => {
    expect(paneResizeGeometryMatches(start, { ...start, paneIds: [...start.paneIds] })).toBe(true)
  })
  it('rejects width, height, pane removal, insertion, reordering and unavailable host', () => {
    for (const current of [
      { ...start, width: 1199 }, { ...start, height: 627 },
      { ...start, paneIds: start.paneIds.slice(0, -1) },
      { ...start, paneIds: [...start.paneIds, 'F2'] },
      { ...start, paneIds: ['candle_pane', 'MACD', 'VOL', 'F1'] }, null,
    ]) expect(paneResizeGeometryMatches(start, current)).toBe(false)
  })
})
