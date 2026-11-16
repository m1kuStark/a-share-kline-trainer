import { describe, expect, it } from 'vitest'
import { FormulaEngine, scanFutureFunctions } from '../../../web/src/formula-engine/index'
import type { FormulaEngineModule } from '../../src/formulas/engine.js'
import { validateSource } from '../../src/formulas/evaluate.js'
import { normalizeFormulaSource } from '../../src/formulas/text.js'

const engine = { FormulaEngine, scanFutureFunctions } as unknown as FormulaEngineModule

describe('M9-04A 公式校验（parse + 未来函数标记）', () => {
  it('合法公式 ok + 未来函数清单', () => {
    const result = validateSource(engine, 'MA5:MA(CLOSE,5); 未来:BACKSET(CLOSE>OPEN,3);')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.futureFunctions).toContain('BACKSET')
  })

  it('语法错误返回 lexer/parser 分类与行号人话', () => {
    const result = validateSource(engine, 'A:MA(CLOSE,;')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(['lexer', 'parser']).toContain(result.error.kind)
    expect(result.error.message.length).toBeGreaterThan(0)
    expect(typeof result.error.line).toBe('number')
  })

  it('通达信文本导入规范化：BOM/CRLF/注释保留，全角标点告警', () => {
    const normalized = normalizeFormulaSource('\uFEFFMA5:MA(CLOSE,5);\r\n// 注释\r\n{块注释}\r\nMA10:MA(CLOSE，10);')
    expect(normalized.source.startsWith('MA5:MA(CLOSE,5);')).toBe(true)
    expect(normalized.source).not.toContain('\r')
    expect(normalized.source).toContain('// 注释')
    expect(normalized.warnings.join()).toContain('全角')
    const validated = validateSource(engine, 'MA5:MA(CLOSE,5);\n// 注释\n{块注释}\nMA10:MA(CLOSE,10);')
    expect(validated.ok).toBe(true)
  })

  it('单行粘贴版直接可校验', () => {
    const result = validateSource(engine, 'MA5:MA(CLOSE,5); MA10:MA(CLOSE,10);')
    expect(result.ok).toBe(true)
  })
})
