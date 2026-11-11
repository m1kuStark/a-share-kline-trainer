import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { FormulaEngine, type MarketData, type StockContext } from '../../../web/src/formula-engine/index'

// M9-01 语料回放冒烟（FE-CORPUS-SMOKE）。
// 语料＝侦察冻结快照 ai-harness-lab/formula-recon/corpus-*.txt（23 块）＋两个实盘单行版（只读引用）。
// 断言依据（侦察 REPORT.md 基线＝2026-10-26 在 vendored 未打补丁引擎上于本仓库复现）：
//   解析通过 18/23、执行通过 8/23；补丁后解析应 ≥22/23（唯一豁免＝万能过左峰编码伪影块，
//   其源文件存在 GBK 乱码段 X_1:=???，属语料文件损坏而非引擎缺陷）；8 个基线执行通过块零损失。

const CORPUS_DIR = process.env.TRAINER_FORMULA_CORPUS_DIR ?? 'D:/Superlinear_Academy/Stock_WorkSpace/ai-harness-lab/formula-recon'
const TDX_FORMULA_DIR = process.env.TRAINER_TDX_FORMULA_DIR ?? 'D:/Superlinear_Academy/Stock_WorkSpace/tdx/选股公式'

const SINGLE_LINE_FILES = [
  join(TDX_FORMULA_DIR, '左峰诅咒线主图公式_单行粘贴版.txt'),
  join(TDX_FORMULA_DIR, 'my_xg', '浪型背离副图_单行粘贴版.txt'),
]

// 万能过左峰编码伪影豁免（语料文件损坏，非引擎缺陷）
const PARSE_EXEMPT = new Set(['corpus-万能过左峰公式-1.txt'])

// 基线执行通过块（2026-10-26 本仓库 vendored 未打补丁引擎逐名快照，与侦察 REPORT 的 8/23 一致）
const BASELINE_EXEC_OK = [
  'corpus-乖离度与5日擒牛副图指标公式-1.txt',
  'corpus-乖离度与5日擒牛副图指标公式-2.txt',
  'corpus-六龙连山-2.txt',
  'corpus-骑牛买1公式-1.txt',
  'corpus-骑牛买1公式-2.txt',
  'corpus-骑牛买3_过左峰选股公式-1.txt',
  'corpus-骑牛买3_过左峰选股公式-2.txt',
  'corpus-骑牛买3_过左峰选股公式-4.txt',
]

/** 侦察 harness 同款合成行情（400 根确定性日线），保证与基线快照同输入 */
function syntheticBars(n = 400): MarketData[] {
  const bars: MarketData[] = []
  let price = 20
  let seed = 20261026
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let day = new Date('2025-01-06').getTime()
  for (let i = 0; i < n; i++) {
    const drift = (rnd() - 0.48) * 0.6
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
  return bars
}

const hasCorpus = existsSync(CORPUS_DIR) && readdirSync(CORPUS_DIR).some(f => f.startsWith('corpus-'))
if (!hasCorpus) {
  // 环境守卫：语料在 CI/他机不存在时醒目跳过（不静默）；缺失数在收尾报告披露
  console.warn(`[corpus-smoke] 侦察语料目录不存在或为空，跳过回放：${CORPUS_DIR}（缺失块数 23＋单行版 ${SINGLE_LINE_FILES.length}）`)
}

describe('M9-01 corpus smoke replay', () => {
  // root 合规修复（2026-10-26）：maybeIt 别名链不被 check-binding 索引（skipIf 双括号同族盲区），
  // 按既有解法改普通 it＋内联守卫；守卫语义不变（缺语料＝醒目 console.warn 后跳过断言体，不静默）
  function guardCorpus(): boolean {
    if (!hasCorpus) console.warn(`[corpus-smoke] 语料缺失，本用例跳过断言体：${CORPUS_DIR}`)
    return hasCorpus
  }

  it('replays all corpus blocks with parse pass count at least 22 of 23', () => {
    if (!guardCorpus()) return
    const engine = new FormulaEngine()
    const files = readdirSync(CORPUS_DIR).filter(f => f.startsWith('corpus-') && f.endsWith('.txt')).sort()
    expect(files).toHaveLength(23)
    const parseFailed: string[] = []
    for (const f of files) {
      const source = readFileSync(join(CORPUS_DIR, f), 'utf8')
      try {
        engine.parse(source)
      } catch {
        parseFailed.push(f)
      }
    }
    const unexpected = parseFailed.filter(f => !PARSE_EXEMPT.has(f))
    // 解析通过 ≥22/23：唯一允许失败＝万能过左峰编码伪影块
    expect(unexpected, `非豁免解析失败块：${unexpected.join(', ')}`).toEqual([])
    expect(parseFailed.length, `豁免块集合应恰为万能过左峰伪影，实际：${parseFailed.join(', ')}`).toBe(PARSE_EXEMPT.size)
  })

  it('keeps all eight baseline exec-passing blocks passing with zero loss', () => {
    if (!guardCorpus()) return
    const engine = new FormulaEngine()
    const bars = syntheticBars()
    for (const f of BASELINE_EXEC_OK) {
      const source = readFileSync(join(CORPUS_DIR, f), 'utf8')
      expect(() => engine.evaluate(source, bars), `基线执行块应保持通过：${f}`).not.toThrow()
    }
  })

  it('parses both production single-line formulas zuofeng curse line and wave divergence', () => {
    if (!guardCorpus()) return
    const engine = new FormulaEngine()
    for (const file of SINGLE_LINE_FILES) {
      if (!existsSync(file)) {
        console.warn(`[corpus-smoke] 单行版语料缺失，跳过该文件：${file}`)
        continue
      }
      const source = readFileSync(file, 'utf8')
      expect(() => engine.parse(source), `实盘单行版应解析通过：${file}`).not.toThrow()
    }
  })

  // ---------- M9-02（XPER-CORPUS-LIFT）：跨周期支持后的执行提升 ----------
  // 口径披露：分金定穴-1/2/3 为语料抽取剥离块——除裸 MACD 引用外还依赖 N/M（通达信
  // 参数区，抽取时被剥）与紧邻块 1 的 RED_MAX_144/GRE_MIN_144。此处按「主体块＋前奏」
  // 重组重放：参数前奏 N:=144;M:=144;BIG_RATIO:=0.75;MID_RATIO:=0.3（取自分金定穴.md
  // 第{1}节参数值与 144 周期主题，N/M 为参数区默认的等价值——proposed_default 待拍板）；
  // 块 2/3 另前置块 1 原文（同公式紧邻块，非跨公式）。裸重放口径（无前奏）＝
  // 11/23（新增 骑牛买2-1、骑牛买3-5 两块），见 docs/verification/2026-10/M9-02。
  // 不计入执行提升的块：M9-03 板块函数域＝六龙连山-3/4/7（HYBLOCK/INBLOCK/HY_INDEXC 族）
  // 与六龙-6（INDEC）；语料伪影＝六龙-5/8、分金定穴-4、骑牛买3-3、万能过左峰-1（parse 编码伪影）。

  const FJD_PARAM_PRELUDE = 'N:=144;M:=144;BIG_RATIO:=0.75;MID_RATIO:=0.3;'

  function composedFenjindingxueSources(): Array<{ label: string; source: string }> {
    const block1 = readFileSync(join(CORPUS_DIR, 'corpus-分金定穴-1.txt'), 'utf8')
    const block2 = readFileSync(join(CORPUS_DIR, 'corpus-分金定穴-2.txt'), 'utf8')
    const block3 = readFileSync(join(CORPUS_DIR, 'corpus-分金定穴-3.txt'), 'utf8')
    return [
      { label: 'corpus-分金定穴-1.txt', source: FJD_PARAM_PRELUDE + block1 },
      { label: 'corpus-分金定穴-2.txt', source: FJD_PARAM_PRELUDE + block1 + block2 },
      { label: 'corpus-分金定穴-3.txt', source: FJD_PARAM_PRELUDE + block1 + block3 },
    ]
  }

  it('lifts corpus exec passing to at least 13 of 23 with cross period support', () => {
    if (!guardCorpus()) return
    const engine = new FormulaEngine()
    const bars = syntheticBars()
    const files = readdirSync(CORPUS_DIR).filter(f => f.startsWith('corpus-') && f.endsWith('.txt')).sort()
    expect(files).toHaveLength(23)
    const composed = new Map(composedFenjindingxueSources().map(x => [x.label, x.source]))
    const failed: string[] = []
    let execOk = 0
    for (const f of files) {
      const source = composed.get(f) ?? readFileSync(join(CORPUS_DIR, f), 'utf8')
      try {
        engine.evaluate(source, bars)
        execOk++
      } catch (e) {
        failed.push(`${f} :: ${String((e as Error).message).slice(0, 70)}`)
      }
    }
    // 矩阵口径 XPER-CORPUS-LIFT：≥13/23（基线 9 零损失＋骑牛买2-1、骑牛买3-5 裸重放新通过＋分金定穴-1/2/3 重组通过）
    expect(execOk, `执行失败明细：\n${failed.join('\n')}`).toBeGreaterThanOrEqual(13)
    // 基线零损失：M9-01 断言的 8 块＋M9-01 实际提升的第 9 块（六龙连山-1）
    for (const f of [...BASELINE_EXEC_OK, 'corpus-六龙连山-1.txt']) {
      expect(() => engine.evaluate(readFileSync(join(CORPUS_DIR, f), 'utf8'), bars), `基线零损失：${f}`).not.toThrow()
    }
    // 跨周期新通过块（裸重放，无前奏）
    expect(() => engine.evaluate(readFileSync(join(CORPUS_DIR, 'corpus-骑牛买2_生命线诅咒线选股公式-1.txt'), 'utf8'), bars)).not.toThrow()
    expect(() => engine.evaluate(readFileSync(join(CORPUS_DIR, 'corpus-骑牛买3_过左峰选股公式-5.txt'), 'utf8'), bars)).not.toThrow()
  })

  // ---------- M9-03（MC-CORPUS-LIFT）：市场上下文函数后的执行提升 ----------
  // 口径披露：合成 StockContext 注入（600519/贵州茅台/酿酒行业＋按同款生成器另造的
  // 行业指数日线），六龙连山-3（HYBLOCK/DYBLOCK/GNBLOCK/FGBLOCK＋字符串链）与
  // 六龙连山-7（HY_INDEXC/O/L/H）两块由缺功能失败转为通过 → 执行 14→16/23。
  // INDEC（六龙连山-6）重分类（M9-03 核实）：INDEC/板块 系六龙连山-5 定义的跨块
  // 用户变量（INDEC:=IF(中小企业=1,"399005$C",…)），非函数——语料抽取伪影，豁免，
  // 不计入 M9-03 失败；其定义块（-5 的 "399005$O" 直接指数引用形态）不在 M9-03 范围。
  // 六龙连山-4（INBLOCK＋"399005$H"）不在 M9-03 冻结函数清单，维持失败。
  // 额外实盘重放（不计入 /23 分母）：my_xg 放量解放单行版（FINANCE(3)＋NOT NAMELIKE）。

  function syntheticIndexBars(n = 400): MarketData[] {
    const bars: MarketData[] = []
    let price = 3000
    let seed = 20261027
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    let day = new Date('2025-01-06').getTime()
    for (let i = 0; i < n; i++) {
      const drift = (rnd() - 0.5) * 20
      const open = price
      const close = Math.max(1000, open + drift)
      const high = Math.max(open, close) + rnd() * 10
      const low = Math.min(open, close) - rnd() * 10
      day += 86400000
      const dow = new Date(day).getDay()
      if (dow === 0) day += 86400000
      if (dow === 6) day += 2 * 86400000
      bars.push({ open, close, high, low, volume: 1e8 + rnd() * 5e8, amount: 1e10, timestamp: day })
      price = close
    }
    return bars
  }

  function syntheticStockContext(): StockContext {
    return {
      code: '600519',
      name: '贵州茅台',
      industry: { name: '酿酒', blockCode: 'T0305', indexCode: 'sh880380' },
      industryIndexBars: syntheticIndexBars(),
      regionName: '浙江',
      conceptName: '白酒',
      styleName: '百元股',
    }
  }

  it('lifts corpus exec passing to at least 16 of 23 with market context injected', () => {
    if (!guardCorpus()) return
    const engine = new FormulaEngine()
    const bars = syntheticBars()
    const stockContext = syntheticStockContext()
    const files = readdirSync(CORPUS_DIR).filter(f => f.startsWith('corpus-') && f.endsWith('.txt')).sort()
    expect(files).toHaveLength(23)
    const composed = new Map(composedFenjindingxueSources().map(x => [x.label, x.source]))
    const failed: string[] = []
    let execOk = 0
    for (const f of files) {
      const source = composed.get(f) ?? readFileSync(join(CORPUS_DIR, f), 'utf8')
      try {
        engine.evaluate(source, bars, { stockContext })
        execOk++
      } catch (e) {
        failed.push(`${f} :: ${String((e as Error).message).slice(0, 70)}`)
      }
    }
    // 矩阵口径 MC-CORPUS-LIFT：≥16/23（M9-02 组装 14 零损失＋六龙连山-3/-7 上下文函数新通过）
    expect(execOk, `执行失败明细：\n${failed.join('\n')}`).toBeGreaterThanOrEqual(16)
    // 基线零损失：M9-02 组装口径的 14 块（9 基线＋骑牛买2-1/骑牛买3-5＋分金定穴-1/2/3 重组）
    for (const f of [...BASELINE_EXEC_OK, 'corpus-六龙连山-1.txt', 'corpus-骑牛买2_生命线诅咒线选股公式-1.txt', 'corpus-骑牛买3_过左峰选股公式-5.txt']) {
      expect(() => engine.evaluate(composed.get(f) ?? readFileSync(join(CORPUS_DIR, f), 'utf8'), bars, { stockContext }), `基线零损失：${f}`).not.toThrow()
    }
    // M9-03 新通过块：六龙连山-3（板块名字符串族）与 -7（行业指数序列族）
    expect(() => engine.evaluate(readFileSync(join(CORPUS_DIR, 'corpus-六龙连山-3.txt'), 'utf8'), bars, { stockContext }), '六龙连山-3 应通过（HYBLOCK/DYBLOCK/GNBLOCK/FGBLOCK）').not.toThrow()
    expect(() => engine.evaluate(readFileSync(join(CORPUS_DIR, 'corpus-六龙连山-7.txt'), 'utf8'), bars, { stockContext }), '六龙连山-7 应通过（HY_INDEXC/O/L/H）').not.toThrow()
  })

  it('replays fangliang single line formula with market context passing board gate', () => {
    if (!guardCorpus()) return
    const file = join(TDX_FORMULA_DIR, 'my_xg', '放量解放选股_单行粘贴版.txt')
    if (!existsSync(file)) {
      console.warn(`[corpus-smoke] 放量解放单行版缺失，跳过该文件：${file}`)
      return
    }
    const engine = new FormulaEngine()
    const bars = syntheticBars()
    const source = readFileSync(file, 'utf8')
    const result = engine.evaluate(source, bars, { stockContext: syntheticStockContext() })
    // 600519 主板非 ST：板块闸门 BD 恒 1（FINANCE(3)=1 AND NOT NAMELIKE ST AND NOT NAMELIKE *ST）
    expect(result.variables['BD']).toEqual(Array(bars.length).fill(1))
  })

  it('replays qiniu1 strict and loose full formulas with cross period references', () => {
    if (!guardCorpus()) return
    const md = readFileSync(join(TDX_FORMULA_DIR, '骑牛买1公式.md'), 'utf8')
    const strictStart = md.indexOf('严格版本：')
    const looseStart = md.indexOf('宽松版本：')
    expect(strictStart).toBeGreaterThan(-1)
    expect(looseStart).toBeGreaterThan(strictStart)
    // 剥节标题行（语料抽取同款：注释由 lexer 自行跳过，CODELIKE 行本就是 // 注释）
    const stripSectionHeader = (s: string) =>
      s.split('\n').filter(l => !/^\s*(严格版本|宽松版本)：/.test(l)).join('\n')
    const strict = stripSectionHeader(md.slice(strictStart, looseStart))
    const loose = stripSectionHeader(md.slice(looseStart))
    const engine = new FormulaEngine()
    const bars = syntheticBars()
    expect(() => engine.evaluate(strict, bars), '骑牛买1 严格版应执行通过（WEEKDAY/SUMBARS 严格口径）').not.toThrow()
    expect(() => engine.evaluate(loose, bars), '骑牛买1 宽松版应执行通过（REF 近似口径）').not.toThrow()
  })
})
