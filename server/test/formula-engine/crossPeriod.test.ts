import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  FormulaEngine,
  ParserError,
  type MarketData,
  resampleBars,
} from '../../../web/src/formula-engine/index'

// M9-02 跨周期/跨公式引用测试（RED 先行）。
// 独立 oracle 原则：期望值全部为手算内嵌常量或测试内按《通达信函数速查表》
// 文档口径独立复写的参考实现（refEMA：前 N-1 项 NaN、种子=SMA、系数 2/(N+1)），
// 不调用被测引擎生成期望。语义依据＝任务卡冻结判断：
//   · 周值广播到该周全部日 bar；当周（数据末组）未走完＝按截至当日的部分周聚合、
//     组内随日线推进；前序周＝单值广播（骑牛买1 注释「确保取的是上周五数据」）。
//   · 自然周周一始、节假日周＝实际交易日聚合；自然月按日历月。
//   · 通达信 MACD：DIF=EMA(C,12)−EMA(C,26)、DEA=EMA(DIF,9)、柱=2×(DIF−DEA)。
//   · 跨公式引用＝注入式注册表（递归、环检测、深度上限 8、人话错误）。

const TDX_FORMULA_DIR = process.env.TRAINER_TDX_FORMULA_DIR ?? 'D:/Superlinear_Academy/Stock_WorkSpace/tdx/选股公式'

/** 手造日线：三元组显式给出，oracle 全部手算 */
function bar(y: number, m: number, d: number, o: number, h: number, l: number, c: number, v: number): MarketData {
  return { open: o, high: h, low: l, close: c, volume: v, amount: 0, timestamp: new Date(y, m - 1, d).getTime() }
}

/**
 * 2025-01-06（周一）起的连续日线。前 20 根＝1 月整月，随后 2 月一周、3 月两日。
 * 周组视角：W1(1/6-1/10) W2(1/13-1/17) W3(1/20-1/24) W4(1/27-1/31)；
 * 月组视角：1 月(20 根) 2 月(5 根) 3 月(2 根)。
 */
function januaryThroughMarchBars(): MarketData[] {
  const rows: Array<[number, number, number, number, number, number, number, number]> = [
    // 1 月：每天 close 从 10.5 递增 1，V 每 100 递增
    [1, 6, 10, 11, 9, 10.5, 100], [1, 7, 10.5, 12, 10, 11.5, 200], [1, 8, 11.5, 13, 11, 12.5, 300],
    [1, 9, 12.5, 14, 12, 13.5, 400], [1, 10, 13.5, 15, 13, 14.5, 500],
    [1, 13, 14.5, 16, 14, 15.5, 600], [1, 14, 15.5, 17, 15, 16.5, 700], [1, 15, 16.5, 18, 16, 17.5, 800],
    [1, 16, 17.5, 19, 17, 18.5, 900], [1, 17, 18.5, 20, 18, 19.5, 1000],
    [1, 20, 19.5, 21, 19, 20.5, 1100], [1, 21, 20.5, 22, 20, 21.5, 1200], [1, 22, 21.5, 23, 21, 22.5, 1300],
    [1, 23, 22.5, 24, 22, 23.5, 1400], [1, 24, 23.5, 25, 23, 24.5, 1500],
    [1, 27, 24.5, 26, 24, 25.5, 1600], [1, 28, 25.5, 27, 25, 26.5, 1700], [1, 29, 26.5, 28, 26, 27.5, 1800],
    [1, 30, 27.5, 29, 27, 28.5, 1900], [1, 31, 28.5, 30, 28, 29.5, 2000],
    // 2 月一周（2/3-2/7）
    [2, 3, 29.5, 31, 29, 30.5, 2100], [2, 4, 30.5, 32, 30, 31.5, 2200], [2, 5, 31.5, 33, 31, 32.5, 2300],
    [2, 6, 32.5, 34, 32, 33.5, 2400], [2, 7, 33.5, 35, 33, 34.5, 2500],
    // 3 月两日（3/3-3/4，周一周二）
    [3, 3, 34.5, 36, 34, 35.5, 2600], [3, 4, 35.5, 37, 35, 36.5, 2700],
  ]
  return rows.map(([m, d, o, h, l, c, v]) => bar(2025, m, d, o, h, l, c, v))
}

/** 前 18 根＝W1..W3 完整＋W4 只有 Mon-Wed（当周未走完形态） */
function threeWeeksPlusTrailingWeek(): MarketData[] {
  return januaryThroughMarchBars().slice(0, 18)
}

/**
 * MACD 周线夹具：39 个完整周（close 恒 100）＋末周 3 日 close=100/120/140。
 * 手算锚点（EMA 种子=SMA、a12=2/13、a26=2/27、a9=2/10，39 周 EMA 状态全为 100、DEA 状态 0）：
 *   末周周二 partial bar close=120 → DIF=(2/13−2/27)×20=560/351，DEA=0.2×DIF=112/351，柱=2×(560−112)/351=896/351
 *   末周周三 partial bar close=140 → DIF=1120/351，DEA=224/351，柱=1792/351
 */
function macdWeeklyFixture(): MarketData[] {
  const bars: MarketData[] = []
  const dayOf = (week: number, dow: number) => new Date(2025, 0, 6 + (week - 1) * 7 + dow).getTime()
  for (let w = 1; w <= 39; w++) {
    for (let d = 0; d <= 4; d++) {
      bars.push({ open: 100, high: 100, low: 100, close: 100, volume: 1000, amount: 0, timestamp: dayOf(w, d) })
    }
  }
  const trailingCloses = [100, 120, 140]
  trailingCloses.forEach((c, d) => {
    bars.push({ open: c, high: c, low: c, close: c, volume: 1000, amount: 0, timestamp: dayOf(40, d) })
  })
  return bars
}

/** 测试内参考实现：按速查表文档口径独立复写（非引擎导入）；前导 NaN 跳过后播种 */
function refEMA(data: number[], period: number): number[] {
  const out: number[] = new Array(data.length).fill(NaN)
  const a = 2 / (period + 1)
  const firstValid = data.findIndex((v) => !Number.isNaN(v))
  if (firstValid < 0) return out
  for (let i = firstValid + period - 1; i < data.length; i++) {
    if (i === firstValid + period - 1) {
      let s = 0
      for (let j = 0; j < period; j++) s += data[i - j]
      out[i] = s / period
    } else {
      out[i] = (data[i] - out[i - 1]) * a + out[i - 1]
    }
  }
  return out
}

function refMacdLines(closes: number[]): { dif: number[]; dea: number[]; hist: number[] } {
  const dif: number[] = new Array(closes.length).fill(NaN)
  const ema12 = refEMA(closes, 12)
  const ema26 = refEMA(closes, 26)
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isNaN(ema12[i]) && !Number.isNaN(ema26[i])) dif[i] = ema12[i] - ema26[i]
  }
  const dea = refEMA(dif.map((v) => (Number.isNaN(v) ? NaN : v)), 9)
  const hist: number[] = new Array(closes.length).fill(NaN)
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isNaN(dif[i]) && !Number.isNaN(dea[i])) hist[i] = 2 * (dif[i] - dea[i])
  }
  return { dif, dea, hist }
}

describe('M9-02 cross period references', () => {
  const engine = new FormulaEngine()

  // ---------- XPER-WEEK-MAP：自然周重采样＋广播 ----------

  it('resamples daily bars into natural weeks with monday start and aggregates OHLCV', () => {
    const daily = threeWeeksPlusTrailingWeek()
    const { bars, groups } = resampleBars(daily, 'WEEK')
    // 手算 oracle：W1..W3 完整周聚合；末组（当周）聚合到已有日（Mon-Wed）
    expect(groups.map((g) => g.length)).toEqual([5, 5, 5, 3])
    expect(bars).toHaveLength(4)
    expect(bars[0]).toMatchObject({ open: 10, high: 15, low: 9, close: 14.5, volume: 1500 })
    expect(bars[1]).toMatchObject({ open: 14.5, high: 20, low: 14, close: 19.5, volume: 4000 })
    expect(bars[2]).toMatchObject({ open: 19.5, high: 25, low: 19, close: 24.5, volume: 6500 })
    expect(bars[3]).toMatchObject({ open: 24.5, high: 28, low: 24, close: 27.5, volume: 5100 })
    // 组索引映射：W2 的 5 根日线是第 5..9 根
    expect(groups[1]).toEqual([5, 6, 7, 8, 9])
  })

  it('broadcasts weekly reference value to every daily bar of its week', () => {
    // 引用线＝周收盘（恒等 close）：W1=14.5 广播到第 0..4 根，W2=19.5 → 5..9，W3=24.5 → 10..14
    const result = engine.evaluate('RV:"X.C#WEEK";', threeWeeksPlusTrailingWeek(), {
      auxiliaryFormulas: { X: 'C:CLOSE;' },
    })
    const v = result.outputs.find((o) => o.name === 'RV')?.data ?? []
    expect(v.slice(0, 5).every((x) => x === 14.5)).toBe(true)
    expect(v.slice(5, 10).every((x) => x === 19.5)).toBe(true)
    expect(v.slice(10, 15).every((x) => x === 24.5)).toBe(true)
  })

  it('aggregates trailing incomplete week as of each day within the week', () => {
    // 当周（末组）按截至当日部分聚合：Mon=25.5、Tue=26.5、Wed=27.5（partial bar 的 close=当日 close）
    const result = engine.evaluate('RV:"X.C#WEEK";', threeWeeksPlusTrailingWeek(), {
      auxiliaryFormulas: { X: 'C:CLOSE;' },
    })
    const v = result.outputs.find((o) => o.name === 'RV')?.data ?? []
    expect(v.slice(15, 18)).toEqual([25.5, 26.5, 27.5])
  })

  it('aggregates holiday short week by actual trading days', () => {
    // 2/10-2/11（周一二）后休市至 2/17：短周组＝2 根实际交易日；末组 2/24 单日
    const daily = [
      bar(2025, 2, 3, 1, 1, 1, 10, 100), bar(2025, 2, 4, 1, 1, 1, 10, 100), bar(2025, 2, 5, 1, 1, 1, 10, 100),
      bar(2025, 2, 6, 1, 1, 1, 10, 100), bar(2025, 2, 7, 1, 1, 1, 10, 100),
      bar(2025, 2, 10, 1, 1, 1, 20, 100), bar(2025, 2, 11, 1, 1, 1, 21, 100),
      bar(2025, 2, 17, 1, 1, 1, 30, 100), bar(2025, 2, 18, 1, 1, 1, 30, 100), bar(2025, 2, 19, 1, 1, 1, 30, 100),
      bar(2025, 2, 20, 1, 1, 1, 30, 100), bar(2025, 2, 21, 1, 1, 1, 30, 100),
      bar(2025, 2, 24, 1, 1, 1, 40, 100),
    ]
    const { bars, groups } = resampleBars(daily, 'WEEK')
    expect(groups.map((g) => g.length)).toEqual([5, 2, 5, 1])
    expect(bars[1]).toMatchObject({ open: 1, close: 21, volume: 200 })
    // 广播：完整短周（组2）单值 21；末组单日 partial=40
    const result = engine.evaluate('RV:"X.C#WEEK";', daily, { auxiliaryFormulas: { X: 'C:CLOSE;' } })
    const v = result.outputs.find((o) => o.name === 'RV')?.data ?? []
    expect(v.slice(5, 7).every((x) => x === 21)).toBe(true)
    expect(v.slice(7, 12).every((x) => x === 30)).toBe(true)
    expect(v[12]).toBe(40)
  })

  it('treats midweek series start as complete first week group', () => {
    // 序列从周三（2025-01-08）开始：首组=周三..周五 3 根（边界周按实际交易日聚合，单值广播）
    const daily = januaryThroughMarchBars().slice(2, 18) // 1/8..1/29
    const { groups, bars } = resampleBars(daily, 'WEEK')
    expect(groups.map((g) => g.length)).toEqual([3, 5, 5, 3])
    expect(bars[0]).toMatchObject({ open: 11.5, high: 15, low: 11, close: 14.5, volume: 1200 })
  })

  // ---------- XPER-MONTH-MAP：自然月重采样＋广播 ----------

  it('resamples daily bars into natural months with calendar boundaries', () => {
    const daily = januaryThroughMarchBars()
    const { bars, groups } = resampleBars(daily, 'MONTH')
    expect(groups.map((g) => g.length)).toEqual([20, 5, 2])
    // 手算 oracle：1 月整月聚合、2 月完整周、3 月两日 partial
    expect(bars[0]).toMatchObject({ open: 10, high: 30, low: 9, close: 29.5, volume: 21000 })
    expect(bars[1]).toMatchObject({ open: 29.5, high: 35, low: 29, close: 34.5, volume: 11500 })
    expect(bars[2]).toMatchObject({ open: 34.5, high: 37, low: 34, close: 36.5, volume: 5300 })
  })

  it('broadcasts monthly value with trailing month aggregated as of each day', () => {
    const daily = januaryThroughMarchBars()
    const result = engine.evaluate('RV:"X.C#MONTH";', daily, { auxiliaryFormulas: { X: 'C:CLOSE;' } })
    const v = result.outputs.find((o) => o.name === 'RV')?.data ?? []
    expect(v.slice(0, 20).every((x) => x === 29.5)).toBe(true)
    expect(v.slice(20, 25).every((x) => x === 34.5)).toBe(true)
    // 当月（3 月）未走完：Mon=35.5、Tue=36.5
    expect(v.slice(25, 27)).toEqual([35.5, 36.5])
  })

  // ---------- XPER-BUILTIN-MACD：通达信口径＋末周 partial 手算锚点 ----------

  it('computes weekly MACD dif dea and histogram to tdx convention on broadcast', () => {
    const daily = macdWeeklyFixture()
    const closes = (p: 'DIF' | 'DEA' | 'MACD') => {
      const src = p === 'DIF' ? 'RV:"MACD.DIF#WEEK";' : p === 'DEA' ? 'RV:"MACD.DEA#WEEK";' : 'RV:"MACD.MACD#WEEK";'
      return engine.evaluate(src, daily).outputs.find((o) => o.name === 'RV')?.data ?? []
    }
    const dif = closes('DIF')
    const dea = closes('DEA')
    const hist = closes('MACD')

    // 手算锚点（精确分数）：末周 Tue=idx196、Wed=idx197
    expect(dif[196]).toBeCloseTo(560 / 351, 10)
    expect(dea[196]).toBeCloseTo(112 / 351, 10)
    expect(hist[196]).toBeCloseTo(896 / 351, 10)
    expect(dif[197]).toBeCloseTo(1120 / 351, 10)
    expect(dea[197]).toBeCloseTo(224 / 351, 10)
    expect(hist[197]).toBeCloseTo(1792 / 351, 10)
    // 末周逐日前缀推进：Mon(idx195) 全 100 → DIF=0；与 Tue 不同值（partial 语义）
    expect(dif[195]).toBeCloseTo(0, 10)
    expect(dif[195]).not.toBe(dif[196])

    // 差分对照：引擎广播 == 测试内参考实现按冻结广播语义展开
    const weeklyComplete = Array(39).fill(100)
    const refComplete = refMacdLines(weeklyComplete)
    const expectedDif: number[] = new Array(198).fill(NaN)
    for (let w = 0; w < 39; w++) {
      for (let d = 0; d < 5; d++) expectedDif[w * 5 + d] = refComplete.dif[w]
    }
    for (const [i, c] of [195, 196, 197].entries()) {
      const partial = refMacdLines([...weeklyComplete, [100, 120, 140][i]])
      expectedDif[c] = partial.dif[39]
    }
    expect(dif).toEqual(expectedDif)
  })

  it('broadcasts NaN before warmup and zero after for constant weekly closes', () => {
    const daily = macdWeeklyFixture()
    const result = engine.evaluate('RV:"MACD.MACD#WEEK"; XG:RV>-1;', daily)
    const xg = result.outputs.find((o) => o.name === 'XG')?.data ?? []
    // 手算 oracle（0 基周序）：DIF 第 26 周（idx25）起有效、DEA 第 34 周（idx33）起有效 →
    // 柱自 idx33（bar 165..169）为 0>-1 真；此前 NaN 比较为假=0
    expect(xg[33 * 5 - 1]).toBe(0)
    expect(xg[33 * 5]).toBe(1)
    expect(xg.slice(33 * 5, 195).every((x) => x === 1)).toBe(true)
    expect(xg.slice(0, 33 * 5).every((x) => x === 0)).toBe(true)
  })

  it('resolves bare MACD DIF DEA identifiers as current period builtin lines', () => {
    // 分金定穴形态：裸 MACD 引用（当前周期＝日线）
    const daily = threeWeeksPlusTrailingWeek()
    const result = engine.evaluate('D:=DIF; E:=DEA; M:=MACD;', daily)
    const closes = daily.map((b) => b.close)
    const ref = refMacdLines(closes)
    const d = result.variables['D'] ?? []
    const e = result.variables['E'] ?? []
    const m = result.variables['M'] ?? []
    // 18 根日线 < 26：DIF 全 NaN（EMA26 未播种）
    expect(d.every((x) => Number.isNaN(x))).toBe(true)
    expect(e.every((x) => Number.isNaN(x))).toBe(true)
    expect(m.every((x) => Number.isNaN(x))).toBe(true)
    // 足量日线（macdWeeklyFixture 198 根 daily close=100 除末三日）上与参考实现一致
    const long = macdWeeklyFixture()
    const r2 = engine.evaluate('D:=DIF; M:=MACD;', long)
    const ref2 = refMacdLines(long.map((b) => b.close))
    expect(r2.variables['D']).toEqual(ref2.dif)
    expect(r2.variables['M']).toEqual(ref2.hist)
  })

  it('keeps user defined MACD variable taking precedence over builtin line', () => {
    const daily = threeWeeksPlusTrailingWeek()
    const result = engine.evaluate('MACD:=CLOSE; Y:=MACD;', daily)
    expect(result.variables['Y']).toEqual(daily.map((b) => b.close))
  })

  // ---------- XPER-SYNTAX-BOTH：带引号/裸写两形态＋人话错误＋字符串零回归 ----------

  it('evaluates quoted and bare cross period references to identical series', () => {
    const daily = macdWeeklyFixture()
    const result = engine.evaluate('Q:="MACD.DEA#WEEK"; B:=MACD.DEA#WEEK;', daily)
    // toEqual 深比较视 NaN 相等：两形态逐 bar 全等（含预热段 NaN）
    expect(result.variables['Q']).toEqual(result.variables['B'])
  })

  it('evaluates explicit day suffix as identity of current period builtin line', () => {
    const daily = macdWeeklyFixture()
    const result = engine.evaluate('D1:="MACD.DIF#DAY"; D2:=MACD.DIF#DAY;', daily)
    const ref = refMacdLines(daily.map((b) => b.close))
    expect(result.variables['D1']).toEqual(ref.dif)
    expect(result.variables['D1']).toEqual(result.variables['D2'])
  })

  it('rejects unknown period suffix with human readable parse error', () => {
    expect(() => engine.parse('RV:"MACD.DIF#MIN60";')).toThrow(ParserError)
    expect(() => engine.parse('RV:"MACD.DIF#MIN60";')).toThrow(/MIN60/)
    expect(() => engine.parse('RV:"MACD.DIF#MIN60";')).toThrow(/DAY\/WEEK\/MONTH/)
    expect(() => engine.parse('RV:=MACD.DIF#MIN60;')).toThrow(/DAY\/WEEK\/MONTH/)
    // 裸写缺 # 后缀＝人话错误
    expect(() => engine.parse('RV:=MACD.DIF;')).toThrow(/#/)
  })

  it('keeps ordinary strings as draw text payloads', () => {
    const daily = threeWeeksPlusTrailingWeek()
    // 不匹配 引用名.线名#周期 模式的字符串保持文本语义（侦察红线：DRAWTEXT 文本零回归）
    const result = engine.evaluate("X:=CLOSE>REF(CLOSE,1); DRAWTEXT(X,LOW,'A.B');", daily)
    expect(result.drawings?.every((e) => e.text === 'A.B')).toBe(true)
    const result2 = engine.evaluate("X:=CLOSE>REF(CLOSE,1); DRAWTEXT(X,LOW,'买点');", daily)
    expect(result2.drawings?.every((e) => e.text === '买点')).toBe(true)
  })

  // ---------- XPER-FORMULA-REF：辅助公式注册表 ----------

  it('evaluates auxiliary formula reference through injected registry', () => {
    // HELPER 输出 MA2：周收盘 [14.5,19.5,24.5,partial...] → MA2=[NaN,17,22,partial]
    const daily = threeWeeksPlusTrailingWeek()
    const result = engine.evaluate('RV:"HELPER.V#WEEK";', daily, {
      auxiliaryFormulas: { HELPER: 'V:MA(CLOSE,2);' },
    })
    const v = result.outputs.find((o) => o.name === 'RV')?.data ?? []
    // 手算 oracle：W1=NaN、W2=(14.5+19.5)/2=17、W3=22；末周 Mon=[..24.5,25.5]→25、Tue→25.5、Wed→26
    expect(Number.isNaN(v[0])).toBe(true)
    expect(v.slice(5, 10).every((x) => x === 17)).toBe(true)
    expect(v.slice(10, 15).every((x) => x === 22)).toBe(true)
    expect(v.slice(15, 18)).toEqual([25, 25.5, 26])
  })

  it('replays weekly144 helper and stock picker formulas end to end', () => {
    // 实盘公式（工作区惯例：纯英文辅助公式名 W144UP）
    const helperPath = join(TDX_FORMULA_DIR, '周线144MA上翘辅助公式.txt')
    const pickerPath = join(TDX_FORMULA_DIR, '周线144MA上翘日线25MA之上选股公式.txt')
    // 实盘公式语料在工作区（不随仓库分发）；CI 无该目录时醒目跳过。
    // 跨周期/跨公式语义仍由本文件其余合成夹具覆盖，公式引擎交付需在有语料的机器跑全量。
    if (!existsSync(helperPath) || !existsSync(pickerPath)) {
      console.warn(`[crossPeriod] 实盘公式语料缺失，跳过该用例：${TDX_FORMULA_DIR}`)
      return
    }
    const helper = readFileSync(helperPath, 'utf8')
    const picker = readFileSync(pickerPath, 'utf8')

    // 800 根日线 → 160 周 ≥ 145：UP 有有效值
    const bars: MarketData[] = []
    let price = 20
    let seed = 20261026
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    let day = new Date('2025-01-06').getTime()
    for (let i = 0; i < 800; i++) {
      const drift = (rnd() - 0.4) * 0.6
      const open = price
      const close = Math.max(1, open + drift)
      const high = Math.max(open, close) + rnd() * 0.3
      const low = Math.min(open, close) - rnd() * 0.3
      day += 86400000
      const dow = new Date(day).getDay()
      if (dow === 0) day += 86400000
      if (dow === 6) day += 2 * 86400000
      bars.push({ open, close, high, low, volume: 1e6 + rnd() * 5e6, amount: 0, timestamp: day })
      price = close
    }
    const result = engine.evaluate(picker, bars, { auxiliaryFormulas: { W144UP: helper } })
    const xg = result.outputs.find((o) => o.name === 'XG')?.data
    expect(xg).toBeDefined()
    expect(xg).toHaveLength(800)
    expect(xg?.every((x) => x === 0 || x === 1)).toBe(true)
    // 预热边界 oracle：UP 的 BARSCOUNT(CLOSE)>=145 在 0 基第 144 组（第 145 周）才可能为真，
    // 此前全部周组 XG=0。夹具首根 bar 落在周二（new Date('2025-01-06') 按 UTC 解析、
    // 本地时区后移一天的语料生成器既有形态），首周组=4 根，故边界用 resampleBars 组结构推导。
    const { groups } = resampleBars(bars, 'WEEK')
    const warmupBarCount = groups.slice(0, 144).reduce((n, g) => n + g.length, 0)
    expect(groups.length).toBeGreaterThanOrEqual(145)
    expect(xg?.slice(0, warmupBarCount).every((x) => x === 0)).toBe(true)
    expect(xg?.slice(warmupBarCount).some((x) => x === 1)).toBe(true)
  })

  it('raises human readable error for unregistered auxiliary formula', () => {
    const daily = threeWeeksPlusTrailingWeek()
    expect(() => engine.evaluate('RV:"W144UP.UP#WEEK";', daily))
      .toThrow(/W144UP.*未注册|未注册.*W144UP/)
    expect(() => engine.evaluate('RV:"W144UP.UP#WEEK";', daily)).toThrow(/auxiliaryFormulas/)
  })

  it('raises human readable error for missing output line in auxiliary formula', () => {
    const daily = threeWeeksPlusTrailingWeek()
    expect(() =>
      engine.evaluate('RV:"HELPER.V#WEEK";', daily, { auxiliaryFormulas: { HELPER: 'Z:MA(CLOSE,5);' } }),
    ).toThrow(/V/)
    expect(() =>
      engine.evaluate('RV:"HELPER.V#WEEK";', daily, { auxiliaryFormulas: { HELPER: 'Z:MA(CLOSE,5);' } }),
    ).toThrow(/Z/)
  })

  it('detects auxiliary formula reference cycle', () => {
    const daily = threeWeeksPlusTrailingWeek()
    expect(() =>
      engine.evaluate('RV:"A.Y#WEEK";', daily, {
        auxiliaryFormulas: { A: 'Y:"B.Z#WEEK";', B: 'Z:"A.Y#WEEK";' },
      }),
    ).toThrow(/环/)
  })

  it('enforces auxiliary reference depth limit of eight', () => {
    const daily = threeWeeksPlusTrailingWeek()
    // 链 F1→F2→…→F10（每层引用下一层），深度超过 8 报错
    const aux: Record<string, string> = {}
    for (let i = 1; i <= 9; i++) aux[`F${i}`] = i === 9 ? 'Y:MA(CLOSE,2);' : `Y:"F${i + 1}.Y#WEEK";`
    expect(() => engine.evaluate('RV:"F1.Y#WEEK";', daily, { auxiliaryFormulas: aux })).toThrow(/8/)
  })

  // ---------- XPER-EDGE-CASES：NaN 不崩溃 ----------

  it('returns false comparisons without crash when weekly warmup is NaN', () => {
    // 5 根日线＝单周不足 MACD 预热："X#WEEK" 全 NaN → 比较为假、不崩溃
    const daily = threeWeeksPlusTrailingWeek().slice(0, 5)
    const result = engine.evaluate('RV:"MACD.DIF#WEEK"; XG:RV>0;', daily)
    const xg = result.outputs.find((o) => o.name === 'XG')?.data ?? []
    expect(xg).toEqual([0, 0, 0, 0, 0])
  })
})
