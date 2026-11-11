import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  FormulaEngine,
  type MarketData,
  type StockContext,
} from '../../../web/src/formula-engine/index'

// M9-03 市场上下文函数族测试（RED 先行）。
// 独立 oracle 原则：期望值全部为手算内嵌常量（前缀真值表/品种类型枚举/日期对齐
// 手算样例），不调用被测引擎生成期望。语义依据＝任务卡 M9-03 冻结判断：
//   · FINANCE(3)＝品种类型，按代码前缀派生常数序列（60/00→1 沪深主板——工作区
//     既有口径冻结；688/689→科创板、300/301→创业板、8/4/92 前缀→北交所——具体
//     返回值速查表无记载，按任务卡授权以 proposed_default 实现：创业板=2、科创板=3、
//     北交所=4，均可经 <>1 剔除）；其他 FINANCE 编号＝显式未实现人话错误。
//   · NAMELIKE(s)/CODELIKE(s)＝名称/代码前缀匹配，布尔常数序列。
//   · HYBLOCK＝所属行业名（字符串常数）；无行业数据＝人话错误。
//   · HY_INDEXC/V/A（含 O/H/L）＝行业指数序列，按股票日线日期对齐：指数缺该日
//     →NaN（比较为假不崩溃，与跨周期 warmup NaN 同语义）。
//   · 未注入 StockContext 而调用上下文函数＝人话运行时错误。

const TDX_FORMULA_DIR = process.env.TRAINER_TDX_FORMULA_DIR ?? 'D:/Superlinear_Academy/Stock_WorkSpace/tdx/选股公式'

/** 手造日线：本地午夜时间戳（与 crossPeriod.test.ts 同约定——对齐按本地日历日） */
function bar(y: number, m: number, d: number, o: number, h: number, l: number, c: number, v: number, a = 0): MarketData {
  return { open: o, high: h, low: l, close: c, volume: v, amount: a, timestamp: new Date(y, m - 1, d).getTime() }
}

/** 五根连续日线（2025-01-06 周一起） */
function fiveBars(): MarketData[] {
  return [
    bar(2025, 1, 6, 10, 11, 9.5, 10.5, 100),
    bar(2025, 1, 7, 10.5, 11.5, 10, 11, 200),
    bar(2025, 1, 8, 11, 12, 10.5, 11.5, 300),
    bar(2025, 1, 9, 11.5, 12.5, 11, 12, 400),
    bar(2025, 1, 10, 12, 13, 11.5, 12.5, 500),
  ]
}

function contextOf(overrides: Partial<StockContext>): StockContext {
  return {
    code: '600519',
    name: '贵州茅台',
    industry: { name: '酿酒' },
    regionName: '浙江',
    conceptName: '白酒',
    styleName: '百元股',
    ...overrides,
  } as StockContext
}

/** 行业指数日线：2025-01-03（股票序列外的多余日，应被忽略）＋ 01-06/01-08/01-09（缺 01-07） */
function indexBarsWithGap(): MarketData[] {
  return [
    bar(2025, 1, 3, 8.8, 9.0, 8.7, 9.0, 90, 900),
    bar(2025, 1, 6, 9.8, 10.2, 9.7, 10.0, 100, 1000),
    bar(2025, 1, 8, 10.5, 11.2, 10.4, 11.0, 110, 1100),
    bar(2025, 1, 9, 11.5, 12.2, 11.4, 12.0, 120, 1200),
  ]
}

describe('M9-03 market context functions', () => {
  const engine = new FormulaEngine()
  const bars = fiveBars()

  // ---------- MC-FINANCE-TYPE：品种类型枚举手算真值表 ----------

  it('derives FINANCE 3 board type by code prefix truth table', () => {
    // 手算真值表：前缀→品种类型（1＝沪深主板为工作区冻结口径；2/3/4 为 proposed_default）
    const truthTable: Array<[string, number, string]> = [
      ['600519', 1, '主板沪 600'],
      ['601318', 1, '主板沪 601'],
      ['605499', 1, '主板沪 605'],
      ['000001', 1, '主板深 000'],
      ['002415', 1, '主板深 002'],
      ['003816', 1, '主板深 003'],
      ['300750', 2, '创业板 300'],
      ['301236', 2, '创业板 301'],
      ['688981', 3, '科创板 688'],
      ['689009', 3, '科创板 689'],
      ['830799', 4, '北交所 8 前缀'],
      ['430047', 4, '北交所 4 前缀'],
      ['920002', 4, '北交所 92 前缀'],
    ]
    for (const [code, expected, label] of truthTable) {
      const result = engine.evaluate('T1:FINANCE(3);', bars, {
        stockContext: contextOf({ code, industry: null }),
      })
      expect(result.outputs[0].data, `${label}（code=${code}）应返回常数 ${expected}`).toEqual(
        Array(bars.length).fill(expected),
      )
    }
  })

  it('raises human readable error for unsupported FINANCE argument numbers', () => {
    for (const source of ['T1:FINANCE(1);', 'T1:FINANCE(33);', 'T1:FINANCE(0);']) {
      expect(() =>
        engine.evaluate(source, bars, { stockContext: contextOf({}) }),
        `${source} 应报未实现人话错误`).toThrow(/FINANCE.*仅.*3|仅实现.*3|未实现/)
    }
  })

  it('raises human readable error for unrecognized code prefix', () => {
    // 200011＝深市 B 股，不属四类前缀家族——不得返回假值
    expect(() =>
      engine.evaluate('T1:FINANCE(3);', bars, { stockContext: contextOf({ code: '200011' }) }),
    ).toThrow(/前缀|品种类型/)
  })

  // ---------- MC-NAME-CODE-LIKE：名称/代码前缀匹配真值表 ----------

  it('matches stock name prefixes with NAMELIKE truth table', () => {
    const truthTable: Array<[string, string, number]> = [
      ['贵州茅台', 'ST', 0],
      ['贵州茅台', '贵', 1],
      ['ST摩登', 'ST', 1],
      ['*ST长生', '*ST', 1],
      ['*ST长生', 'ST', 0],
      ['ST长生', '*ST', 0],
    ]
    for (const [name, pattern, expected] of truthTable) {
      const result = engine.evaluate("N1:NAMELIKE('ST');X2:NAMELIKE('贵');X3:NAMELIKE('*ST');", bars, {
        stockContext: contextOf({ name }),
      })
      expect(result.outputs, `name=${name} 应输出三线`).toHaveLength(3)
      const byName = new Map(result.outputs.map(o => [o.name, o.data]))
      const target = pattern === 'ST' ? 'N1' : pattern === '贵' ? 'X2' : 'X3'
      expect(byName.get(target), `name=${name} NAMELIKE(${pattern}) 应为 ${expected}`).toEqual(
        Array(bars.length).fill(expected),
      )
    }
  })

  it('matches code prefixes with CODELIKE truth table', () => {
    const truthTable: Array<[string, string, number]> = [
      ['688981', '688', 1],
      ['600519', '688', 0],
      ['000001', '00', 1],
      ['300750', '00', 0],
      ['600519', '60', 1],
      ['300750', '30', 1],
    ]
    for (const [code, pattern, expected] of truthTable) {
      const source = `C1:CODELIKE('${pattern}');`
      const result = engine.evaluate(source, bars, { stockContext: contextOf({ code }) })
      expect(result.outputs[0].data, `code=${code} CODELIKE(${pattern}) 应为 ${expected}`).toEqual(
        Array(bars.length).fill(expected),
      )
    }
  })

  it('supports NOT with NAMELIKE as in the fangliang formula', () => {
    // 放量解放组合口径：NOT(NAMELIKE('ST'))——主板非 ST 股为 1、ST 股为 0
    const ok = engine.evaluate("G:NOT(NAMELIKE('ST'));", bars, { stockContext: contextOf({}) })
    expect(ok.outputs[0].data).toEqual(Array(bars.length).fill(1))
    const st = engine.evaluate("G:NOT(NAMELIKE('ST'));", bars, { stockContext: contextOf({ name: 'ST摩登' }) })
    expect(st.outputs[0].data).toEqual(Array(bars.length).fill(0))
  })

  it('replays fangliang formula with mainboard context passing BD gate', () => {
    const file = join(TDX_FORMULA_DIR, 'my_xg', '放量解放选股_单行粘贴版.txt')
    if (!existsSync(file)) {
      console.warn(`[marketContext] 放量解放语料缺失，跳过该文件：${file}`)
      return
    }
    const source = readFileSync(file, 'utf8')
    // 主板非 ST：FILT=1 时 BD＝FINANCE(3)=1 AND NOT NAMELIKE ST AND NOT NAMELIKE *ST → 全 1
    const mainboard = engine.evaluate(source, bars, { stockContext: contextOf({}) })
    const bd = mainboard.variables['BD'] as number[]
    expect(bd, '主板非ST 上下文下 BD 应恒 1').toEqual(Array(bars.length).fill(1))
    // 科创板 ST：FINANCE(3)=3≠1 → BD 全 0（板块闸门正确关闭）
    const starSt = engine.evaluate(source, bars, {
      stockContext: contextOf({ code: '688981', name: 'ST国望' }),
    })
    expect(starSt.variables['BD'], '科创板 ST 上下文下 BD 应恒 0').toEqual(Array(bars.length).fill(0))
  })

  // ---------- MC-HYBLOCK：行业名字符串常数 ----------

  it('returns industry name string from HYBLOCK', () => {
    // HYBLOCK 返回行业名字符串；经 STRCAT＋DRAWTEXT 观察文本（变量层字符串中间态）
    const result = engine.evaluate("T:DRAWTEXT(C>0,C,STRCAT('行业',HYBLOCK));", bars, {
      stockContext: contextOf({}),
    })
    expect(result.drawings.length).toBeGreaterThan(0)
    expect(result.drawings[0].text).toBe('行业酿酒')
    // 六龙连山-3 形态：字符串链式拼接进变量再消费，不抛错
    expect(() =>
      engine.evaluate(
        "Z10:=STRCAT(' 行业： ',HYBLOCK);Z11:=STRCAT(Z10,' 地域：');Z21:=STRCAT(Z11,DYBLOCK);X:=1;",
        bars,
        { stockContext: contextOf({}) },
      ),
    ).not.toThrow()
  })

  it('raises human readable error when HYBLOCK has no industry data', () => {
    expect(() => engine.evaluate('X:=HYBLOCK;', bars, { stockContext: contextOf({ industry: null }) })).toThrow(
      /HYBLOCK|行业/,
    )
  })

  it('supports region concept style block name functions for corpus block replay', () => {
    const result = engine.evaluate(
      'T:DRAWTEXT(C>0,C,STRCAT(STRCAT(STRCAT(HYBLOCK,DYBLOCK),GNBLOCK),FGBLOCK));',
      bars,
      { stockContext: contextOf({}) },
    )
    expect(result.drawings[0].text).toBe('酿酒浙江白酒百元股')
    // 上下文未提供地域名 → 人话错误（不得静默返回假值）
    const partial = { ...contextOf({}) } as StockContext
    delete (partial as { regionName?: string }).regionName
    expect(() => engine.evaluate('X:=DYBLOCK;', bars, { stockContext: partial })).toThrow(/DYBLOCK/)
  })

  // ---------- MC-HY-INDEX-SERIES：日期对齐手算样例（含缺失日 NaN） ----------

  it('aligns industry index series to stock daily dates with NaN for missing days', () => {
    const stockAxis = [
      bar(2025, 1, 6, 10, 11, 9.5, 10.5, 100),
      bar(2025, 1, 7, 10.5, 11.5, 10, 11, 200),
      bar(2025, 1, 8, 11, 12, 10.5, 11.5, 300),
      bar(2025, 1, 9, 11.5, 12.5, 11, 12, 400),
    ]
    const source =
      'IC:HY_INDEXC;IO:HY_INDEXO;IH:HY_INDEXH;IL:HY_INDEXL;IV:HY_INDEXV;IA:HY_INDEXA;GATE:HY_INDEXC>10;'
    const result = engine.evaluate(source, stockAxis, {
      stockContext: contextOf({ industryIndexBars: indexBarsWithGap() }),
    })
    const byName = new Map(result.outputs.map(o => [o.name, o.data]))
    // 手算：股票轴＝01-06/07/08/09；指数在 01-03（多余日，忽略）、01-06、01-08、01-09 有值、缺 01-07
    expect(byName.get('IC')).toEqual([10.0, NaN, 11.0, 12.0])
    expect(byName.get('IO')).toEqual([9.8, NaN, 10.5, 11.5])
    expect(byName.get('IH')).toEqual([10.2, NaN, 11.2, 12.2])
    expect(byName.get('IL')).toEqual([9.7, NaN, 10.4, 11.4])
    expect(byName.get('IV')).toEqual([100, NaN, 110, 120])
    expect(byName.get('IA')).toEqual([1000, NaN, 1100, 1200])
    // 缺日 NaN 的比较为假不崩溃：[10>10=0, NaN>10=0(假), 11>10=1, 12>10=1]
    expect(byName.get('GATE')).toEqual([0, 0, 1, 1])
  })

  it('yields NaN amount series when index bars carry no amount field', () => {
    const noAmount = indexBarsWithGap().map(({ amount: _omit, ...rest }) => rest)
    const result = engine.evaluate('IA:HY_INDEXA;', bars, {
      stockContext: contextOf({ industryIndexBars: noAmount }),
    })
    expect(result.outputs[0].data).toEqual(Array(bars.length).fill(NaN))
  })

  it('raises human readable error when industry index bars are missing', () => {
    expect(() => engine.evaluate('IC:HY_INDEXC;', bars, { stockContext: contextOf({ industryIndexBars: undefined }) })).toThrow(
      /HY_INDEXC|行业指数/,
    )
  })

  // ---------- MC-PROVIDER-INJECT：未注入上下文＝人话错误 ----------

  it('raises human readable errors when context functions lack injected StockContext', () => {
    for (const source of [
      'X:=FINANCE(3);',
      "X:=NAMELIKE('ST');",
      "X:=CODELIKE('688');",
      'X:=HYBLOCK;',
      'X:=HY_INDEXC;',
      'X:=HY_INDEXV;',
      'X:=HY_INDEXA;',
    ]) {
      expect(() => engine.evaluate(source, bars), `${source} 未注入上下文应报人话错误`).toThrow(/StockContext|上下文/)
    }
  })
})
