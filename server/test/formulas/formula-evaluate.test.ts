import { describe, expect, it } from 'vitest'
import { FormulaEngine, scanFutureFunctions } from '../../../web/src/formula-engine/index'
import type { FormulaEngineModule } from '../../src/formulas/engine.js'
import { evaluateOnBars, validateSource } from '../../src/formulas/evaluate.js'
import { timestampOfDate } from '../../src/formulas/data.js'
import type { FormulaBar } from '../../src/formulas/types.js'

const engine = { FormulaEngine, scanFutureFunctions } as unknown as FormulaEngineModule

function localDate(index: number): string {
  const date = new Date(2026, 0, 1 + index)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function barsFromCloses(closes: number[]): { bars: FormulaBar[]; dates: string[] } {
  const dates = closes.map((_, index) => localDate(index))
  const bars = closes.map((close, index) => ({
    timestamp: timestampOfDate(dates[index]),
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
    amount: (100 + index) * close,
  }))
  return { bars, dates }
}

describe('M9-04A 校验与只读求值服务', () => {




  it('MA3 输出线与手算一致（NaN→null、与 bars 等长）', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const { bars, dates } = barsFromCloses(closes)
    const result = evaluateOnBars(engine, { source: 'MA3:MA(CLOSE,3);', bars, dates, limit: bars.length })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outputs).toHaveLength(1)
    const line = result.outputs[0]
    expect(line.name).toBe('MA3')
    expect(line.data).toHaveLength(closes.length)
    expect(line.data[0]).toBeNull()
    expect(line.data[1]).toBeNull()
    expect(line.data[2]).toBeCloseTo(2, 9)
    expect(line.data[9]).toBeCloseTo(9, 9)
    expect(result.bars).toHaveLength(10)
    expect(result.bars[9].date).toBe(localDate(9))
  })

  it('limit 截取最近 N 根（输出线与 bars 同步裁剪）', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const { bars, dates } = barsFromCloses(closes)
    const result = evaluateOnBars(engine, { source: 'MA3:MA(CLOSE,3);', bars, dates, limit: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bars.map(bar => bar.date)).toEqual([localDate(7), localDate(8), localDate(9)])
    expect(result.outputs[0].data).toHaveLength(3)
    expect(result.outputs[0].data[2]).toBeCloseTo(9, 9)
  })

  it('运行时错误返回 ok:false（不 500、不崩溃）', () => {
    const { bars, dates } = barsFromCloses([1, 2, 3])
    const result = evaluateOnBars(engine, { source: 'A:UNKNOWN_FUNCTION(CLOSE);', bars, dates, limit: 3 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('runtime')
    expect(result.error.message).toMatch(/[\\u4e00-\\u9fa5]/)
  })

  it('NaN/Infinity 输出归一为 null（JSON 安全）', () => {
    const { bars, dates } = barsFromCloses([1, 2, 3])
    const result = evaluateOnBars(engine, { source: 'A:CLOSE/0;', bars, dates, limit: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outputs[0].data.every(value => value === null)).toBe(true)
  })
})
