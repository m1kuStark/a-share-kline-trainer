import { describe, it, expect } from 'vitest'
import {
  FormulaEngine,
  scanFutureFunctions,
  FUTURE_FUNCTIONS,
  type MarketData,
  type Program,
  NodeType,
} from '../../../web/src/formula-engine/index'
import { BACKSET } from '../../../web/src/formula-engine/interpreter/functions/reference'

// M9-01 补丁层测试（RED 先行）。
// 独立 oracle 原则：所有期望值为手算/文档口径内嵌常量，不反推实现。
// 依据：TECH-FORMULA-RECON（ai-harness-lab/formula-recon/REPORT.md）钉死的缺口
// ＋《通达信函数速查表》BACKSET/DRAWNUMBER/VARCAT 条目。

/** 12 根手造日线：close=[10×8,9,10,10,12]，上涨 bar＝{9,11}（10>9、12>10） */
function fixtureBars(): MarketData[] {
  const closes = [10, 10, 10, 10, 10, 10, 10, 10, 9, 10, 10, 12]
  return closes.map((close, i) => ({
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + i,
    timestamp: new Date('2025-01-06').getTime() + i * 86400000,
  }))
}

describe('M9-01 patches', () => {
  const engine = new FormulaEngine()

  // ---------- 缺口 1：!= 运算符（FE-NE-OPERATOR） ----------

  it('parses ne operator inside SUMBARS MONTH REF form from qiniu3 strict formula', () => {
    // 骑牛买3 严格版原句形态（侦察实证：lexer 在 ! 处失败）
    const ast = engine.parse('XG: SUMBARS(MONTH!=REF(MONTH,1),1);')
    expect(ast.type).toBe(NodeType.Program)
  })

  it('evaluates ne operator as inequality on series and scalars', () => {
    const result = engine.evaluate('A:=5!=3; B:=5!=5; C:=CLOSE!=CLOSE; XG:A+B+C;', fixtureBars())
    // 手算 oracle：5!=3 → 1；5!=5 → 0；CLOSE!=CLOSE → 0（NaN 比较=假）
    expect(result.variables['A'][0]).toBe(1)
    expect(result.variables['B'][0]).toBe(0)
    expect(result.variables['C'][0]).toBe(0)
  })

  it('keeps legacy angle bracket neq operator working', () => {
    const result = engine.evaluate('A:=5<>3; B:=5<>5; XG:A+B;', fixtureBars())
    expect(result.variables['A'][0]).toBe(1)
    expect(result.variables['B'][0]).toBe(0)
  })

  // ---------- 缺口 2：语句级颜色/线型修饰（FE-STMT-MODIFIER） ----------

  it('parses expression statement with color modifier STICKLINE form', () => {
    expect(() => engine.parse('STICKLINE(CLOSE>OPEN,CLOSE,OPEN,1,0),COLORRED;')).not.toThrow()
  })

  it('parses variable declaration with modifier as in liulonglianshan corpus block', () => {
    // 六龙连山-1 实测失败形态：X:=SMA(...),COLORRED;
    const ast = engine.parse('B22:=SMA(CLOSE,5),COLORRED;') as Program
    const stmt = ast.body[0]
    expect(stmt.type).toBe(NodeType.VariableDeclaration)
    if (stmt.type === NodeType.VariableDeclaration) {
      expect(stmt.style?.color).toBe('COLORRED')
    }
  })

  it('parses bare expression statement with modifier and captures linethick style', () => {
    const ast = engine.parse('X:=MA(CLOSE,3),LINETHICK2; Y:MA(CLOSE,3);') as Program
    const stmt = ast.body[0]
    if (stmt.type === NodeType.VariableDeclaration) {
      expect(stmt.style?.size).toBe(2)
    } else {
      throw new Error('expected VariableDeclaration with style')
    }
  })

  it('keeps numeric semantics identical with or without statement modifier', () => {
    // 数值语义与无修饰一致：X（带修饰）与 Y（无修饰）逐 bar 相等
    const result = engine.evaluate('X:=MA(CLOSE,3),COLORRED; Y:MA(CLOSE,3);', fixtureBars())
    expect(result.variables['X']).toEqual(result.variables['Y'])
  })

  it('attaches style metadata to drawing events from modified STICKLINE statement', () => {
    const result = engine.evaluate('STICKLINE(CLOSE>10,CLOSE,OPEN,1,0),COLORRED;', fixtureBars())
    expect(result.drawings?.length).toBeGreaterThan(0)
    for (const event of result.drawings ?? []) {
      expect(event.style?.color).toBe('COLORRED')
    }
  })

  // ---------- 缺口 3：DRAWNUMBER 四参（FE-DRAWNUMBER-4） ----------

  it('evaluates four-arg DRAWNUMBER carrying decimals metadata per event', () => {
    const result = engine.evaluate('DRAWNUMBER(CLOSE>REF(CLOSE,1),HIGH,CLOSE,2);', fixtureBars())
    // 手算 oracle：上涨 bar＝index 9（10>9）与 index 11（12>10）→ 2 个事件
    expect(result.drawings).toHaveLength(2)
    const [first, second] = result.drawings ?? []
    expect(first?.barIndex).toBe(9)
    expect(first?.values.value).toBe(10)
    expect(first?.values.price).toBe(11)
    expect(first?.values.decimals).toBe(2)
    expect(second?.barIndex).toBe(11)
    expect(second?.values.value).toBe(12)
    expect(second?.values.price).toBe(13)
    expect(second?.values.decimals).toBe(2)
  })

  it('keeps three-arg DRAWNUMBER compatible without decimals key', () => {
    const result = engine.evaluate('DRAWNUMBER(CLOSE>REF(CLOSE,1),HIGH,CLOSE);', fixtureBars())
    expect(result.drawings).toHaveLength(2)
    const event = result.drawings?.[0]
    expect(event?.values.value).toBe(10)
    expect(event?.values.decimals).toBeUndefined()
  })

  it('rejects five-arg DRAWNUMBER', () => {
    expect(() => engine.evaluate('DRAWNUMBER(C,O,C,2,1);', fixtureBars())).toThrow()
  })

  // ---------- 缺口 4：BACKSET（FE-BACKSET，手算 oracle） ----------

  it('computes BACKSET window backward from condition bar with hand oracle', () => {
    // 手算 oracle：X 仅第 10 根（index 9）为真，N=3 → 第 8~10 根（index 7,8,9）为 1，其余 0
    const X = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]
    const expected = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0]
    expect(BACKSET(X, 3)).toEqual(expected)
  })

  it('unions overlapping BACKSET windows from multiple condition bars', () => {
    // 手算 oracle：X 在 index 4、5 为真，N=3 → 窗口 [2,4]∪[3,5] = index 2..5 全 1
    const X = [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0]
    const expected = [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]
    expect(BACKSET(X, 3)).toEqual(expected)
  })

  it('clamps BACKSET window at series start', () => {
    // 手算 oracle：X 在 index 1 为真，N=3 → 窗口 [-1,1] 截为 index 0,1
    const X = [0, 1, 0, 0]
    expect(BACKSET(X, 3)).toEqual([1, 1, 0, 0])
  })

  it('returns single bar for N=1 and all zeros when no condition or N=0', () => {
    expect(BACKSET([0, 1, 0], 1)).toEqual([0, 1, 0])
    expect(BACKSET([0, 0, 0], 3)).toEqual([0, 0, 0])
    expect(BACKSET([1, 1], 0)).toEqual([0, 0])
  })

  it('evaluates BACKSET end to end through the formula engine', () => {
    // 手算 oracle：上涨 bar＝{9,11} → BACKSET(X,3) 窗口 [7,9]∪[9,11] ＝ index 7..11 为 1
    const result = engine.evaluate('X:=CLOSE>REF(CLOSE,1); B:BACKSET(X,3);', fixtureBars())
    expect(result.outputs.map(o => o.name)).toContain('B')
    const b = result.outputs.find(o => o.name === 'B')
    expect(b?.data).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
  })

  // ---------- 缺口 5：VARCAT（FE-VARCAT） ----------

  it('concatenates two string literals as DRAWTEXT text argument', () => {
    const result = engine.evaluate("X:=CLOSE>REF(CLOSE,1); DRAWTEXT(X,LOW,VARCAT('买','点'));", fixtureBars())
    // 手算 oracle：上涨 bar＝{9,11} → 2 个事件，文本均为拼接结果
    expect(result.drawings).toHaveLength(2)
    for (const event of result.drawings ?? []) {
      expect(event.text).toBe('买点')
    }
  })

  it('concatenates nested VARCAT and STRCAT alias', () => {
    const result = engine.evaluate(
      "X:=CLOSE>REF(CLOSE,1); DRAWTEXT(X,LOW,VARCAT(STRCAT('买','入'),VARCAT('信','号')));",
      fixtureBars(),
    )
    expect(result.drawings?.[0]?.text).toBe('买入信号')
  })

  it('stringifies numeric series argument by latest bar value in VARCAT', () => {
    // 披露口径：数值序列参数取末根值（CONST 展示口径）；手造行情末根 close＝12
    const result = engine.evaluate("X:=CLOSE>REF(CLOSE,1); DRAWTEXT(X,LOW,VARCAT('收',CLOSE));", fixtureBars())
    expect(result.drawings?.[0]?.text).toBe('收12')
  })

  // ---------- 缺口 6：未来函数静态标记（FE-FUTURE-MARK） ----------

  it('marks BACKSET usage in formula source', () => {
    expect(scanFutureFunctions('X:=BACKSET(A,3); Y:MA(C,5);')).toEqual(['BACKSET'])
  })

  it('marks REFX family members and dedupes repeated usage', () => {
    const marked = scanFutureFunctions('A:=REFX(C,1); B:=REFXV(A,2); C1:=REFX(C,1); D:=MA(C,5);')
    expect(marked.sort()).toEqual(['REFX', 'REFXV'])
  })

  it('returns empty list for formulas without future functions (no false positives)', () => {
    expect(scanFutureFunctions('X:=REF(C,1); Y:=MA(C,5); Z:=IF(X>Y,1,0);')).toEqual([])
  })

  it('exports FUTURE_FUNCTIONS table containing the starter families', () => {
    expect(FUTURE_FUNCTIONS).toContain('BACKSET')
    expect(FUTURE_FUNCTIONS).toContain('REFX')
    expect(FUTURE_FUNCTIONS).toContain('REFXV')
    expect(FUTURE_FUNCTIONS).toContain('ZIG')
  })

  it('scanning does not change execution results', () => {
    const formula = 'X:=BACKSET(CLOSE>REF(CLOSE,1),3); Y:MA(CLOSE,3);'
    const marked = scanFutureFunctions(formula)
    expect(marked).toEqual(['BACKSET'])
    const before = JSON.stringify(engine.evaluate(formula, fixtureBars()))
    scanFutureFunctions(formula)
    const after = JSON.stringify(engine.evaluate(formula, fixtureBars()))
    expect(after).toBe(before)
  })
})
