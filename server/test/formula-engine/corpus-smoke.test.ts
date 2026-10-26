import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { FormulaEngine, type MarketData } from '../../../web/src/formula-engine/index'

// M9-01 语料回放冒烟（FE-CORPUS-SMOKE）。
// 语料＝侦察冻结快照 ai-harness-lab/formula-recon/corpus-*.txt（23 块）＋两个实盘单行版（只读引用）。
// 断言依据（侦察 REPORT.md 基线＝2026-10-26 在 vendored 未打补丁引擎上于本仓库复现）：
//   解析通过 18/23、执行通过 8/23；补丁后解析应 ≥22/23（唯一豁免＝万能过左峰编码伪影块，
//   其源文件存在 GBK 乱码段 X_1:=???，属语料文件损坏而非引擎缺陷）；8 个基线执行通过块零损失。

const CORPUS_DIR = 'D:/Superlinear_Academy/Stock_WorkSpace/ai-harness-lab/formula-recon'
const TDX_FORMULA_DIR = 'D:/Superlinear_Academy/Stock_WorkSpace/tdx/选股公式'

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
})
