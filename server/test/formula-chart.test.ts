import { describe, expect, it } from 'vitest'
import type { Bar, FormulaView } from '../../web/src/api'
import {
  barTimestamp, evaluateFormulaChart, formulaIndicatorName, formulaPaneIdsOf,
  isFormulaIndicatorName, paneHeightsForCapture,
} from '../../web/src/formulaIndicators'

function barsFromCloses(closes: number[]): Bar[] {
  return closes.map((close, index) => ({
    date: '2026-01-0' + (index + 1),
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
    amount: 1000 + index,
  }))
}

function formula(overrides: Partial<FormulaView> = {}): FormulaView {
  return {
    id: 1, name: 'FORM_A', description: '', placement: 'main', source: 'MA3:MA(CLOSE,3);',
    enabled: true, builtin: false, futureFunctions: [], createdAt: '', updatedAt: '', ...overrides,
  }
}

describe('M9-04C 公式图表求值（浏览器侧纯函数）', () => {
  it('图表 timestamp 统一 UTC 午夜（与 KlineChart dateTimestamp 同源）', () => {
    expect(barTimestamp('2026-01-05')).toBe(Date.parse('2026-01-05T00:00:00Z'))
    expect(barTimestamp('2026-01')).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('按 timestamp 对齐 bars，NaN→null（前两根暖机为空）', () => {
    const bars = barsFromCloses([1, 2, 3, 4, 5])
    const renders = evaluateFormulaChart({ bars, formulas: [formula()] })
    expect(renders).toHaveLength(1)
    const render = renders[0]
    expect(render.error).toBeNull()
    expect(render.lines[0].name).toBe('MA3')
    expect(render.lines[0].points).toHaveLength(5)
    expect(render.lines[0].points[0]).toEqual({ timestamp: barTimestamp('2026-01-01'), value: null })
    expect(render.lines[0].points[1].value).toBeNull()
    expect(render.lines[0].points[2].value).toBeCloseTo(2, 9)
    expect(render.lines[0].points[4].value).toBeCloseTo(4, 9)
  })

  it('只渲染 enabled 公式；disabled/无 placement 的公式被忽略', () => {
    const renders = evaluateFormulaChart({
      bars: barsFromCloses([1, 2, 3]),
      formulas: [formula(), formula({ id: 2, name: 'OFF', enabled: false }), formula({ id: 3, name: 'BAD', placement: 'main', enabled: false })],
    })
    expect(renders.map(render => render.name)).toEqual(['FORM_A'])
  })

  it('无 StockContext（随机训练/回放）时上下文函数给人话错误且不影响其他公式', () => {
    const bars = barsFromCloses([1, 2, 3, 4, 5])
    const renders = evaluateFormulaChart({
      bars,
      formulas: [formula({ id: 9, name: 'CTX', source: "CTX:NAMELIKE('贵');" }), formula({ id: 10, name: 'PLAIN', source: 'PLAIN:MA(CLOSE,3);' })],
      stockContext: null,
    })
    const contextRender = renders.find(render => render.name === 'CTX')!
    expect(contextRender.lines).toEqual([])
    expect(contextRender.error).toContain('上下文')
    expect(contextRender.error).toContain('CTX')
    const plain = renders.find(render => render.name === 'PLAIN')!
    expect(plain.error).toBeNull()
    expect(plain.lines[0].points[4].value).toBeCloseTo(4, 9)
  })

  it('注入 StockContext 时 NAMELIKE 正常工作（经典训练路径）', () => {
    const renders = evaluateFormulaChart({
      bars: barsFromCloses([1, 2, 3]),
      formulas: [formula({ id: 11, name: 'CTXOK', source: "CTXOK:NAMELIKE('贵');" })],
      stockContext: { code: '600519', name: '贵州茅台', industry: null },
    })
    expect(renders[0].error).toBeNull()
    expect(renders[0].lines[0].points.map(point => point.value)).toEqual([1, 1, 1])
  })

  it('公式指标命名与 pane 归属探针', () => {
    expect(formulaIndicatorName(7, 2)).toBe('FORMULA_7_2')
    expect(isFormulaIndicatorName('FORMULA_7_2')).toBe(true)
    expect(isFormulaIndicatorName('MA')).toBe(false)
    const ids = formulaPaneIdsOf([{ name: 'FORMULA_1_0', paneId: 'pane-f1' }, { name: 'VOL', paneId: 'pane-vol' }])
    expect([...ids]).toEqual(['pane-f1'])
  })

  it('录像 paneHeights 捕获跳过公式 pane，不写回 candle_pane', () => {
    const panes = [
      { id: 'candle_pane', height: 300 },
      { id: 'pane-vol', height: 100 },
      { id: 'pane-formula', height: 90 },
      { id: 'x_axis_pane', height: 20 },
    ]
    const formulaPaneIds = formulaPaneIdsOf([{ name: 'FORMULA_1_0', paneId: 'pane-formula' }])
    const heights = paneHeightsForCapture(panes, formulaPaneIds, paneId => paneId === 'pane-vol' ? 'VOL' : 'candle_pane')
    expect(heights).toEqual({ candle_pane: 300, VOL: 100 })
    expect(heights.pane_formula).toBeUndefined()
    expect(heights.candle_pane).toBe(300)
  })
})
