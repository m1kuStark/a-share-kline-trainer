import { describe, expect, it } from 'vitest'
import { createEngineProvider } from '../../src/formulas/engine.js'
import { evaluateOnBars } from '../../src/formulas/evaluate.js'

function bars(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(2026, 0, 1 + index).getTime(),
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10 + index,
    volume: 100 + index,
    amount: 1000 + index,
  }))
}

describe('M9-04A 引擎加载器（dev/测试源码回退路径）', () => {
  it('bundle 不存在时回退 web/src 纯值入口，可求值并扫描未来函数', async () => {
    const engine = await createEngineProvider()()
    expect(typeof engine.FormulaEngine).toBe('function')
    expect(typeof engine.scanFutureFunctions).toBe('function')
    expect(engine.scanFutureFunctions('A:BACKSET(CLOSE>OPEN,3);')).toContain('BACKSET')
    const series = bars(5)
    const dates = series.map((_, index) => '2026-01-0' + (index + 1))
    const result = evaluateOnBars(engine, { source: 'MA2:MA(CLOSE,2);', bars: series, dates, limit: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outputs[0].name).toBe('MA2')
    expect(result.outputs[0].data[4]).toBeCloseTo((13 + 14) / 2, 9)
  })
})
