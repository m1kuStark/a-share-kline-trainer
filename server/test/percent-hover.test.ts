import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// M6-02 每根 K 线涨幅百分比随指针显示（candle-percent-hover 矩阵）。
// 独立 oracle 原则：期望表全部为内嵌常量——收盘价序列与期望徽标由架构师预计算
// （任务卡 2026-10-05 冻结），本文件禁止调用被测实现生成期望。
// 取数方式沿用 kdj-indicator.test.ts 的"读 web 真实源码＋ts.transpile 提取执行"模式：
// 测的是 web/src/phasePrice.ts 的真实导出 formatPercentBadge，不在测试里复制实现。

// 架构师 oracle：收盘价序列（i0..i5）
const ORACLE_CLOSES: ReadonlyArray<number> = [10.0, 10.5, 10.29, 10.29, 9.8, 10.0]

// 期望徽标（text＋cls）：i0 首根无前收 → "--"（灰）；红涨 pct-up / 绿跌 pct-down / 零灰 pct-flat。
// i4 = 9.80/10.29−1 = −4.7614…% → "-4.76%"；i5 = 10.00/9.80−1 = +2.0408…% → "+2.04%"
const EXPECTED_BADGES: ReadonlyArray<readonly [text: string, cls: string]> = [
  ['--', 'pct-flat'],
  ['+5.00%', 'pct-up'],
  ['-2.00%', 'pct-down'],
  ['0.00%', 'pct-flat'],
  ['-4.76%', 'pct-down'],
  ['+2.04%', 'pct-up'],
]

type Badge = { text: string; cls: string }
type FormatFn = (close: number | null | undefined, previousClose: number | null | undefined) => Badge

/** 执行 web/src/phasePrice.ts 真实模块（CommonJS 转译＋桩 klinecharts，type-only import 被擦除） */
async function loadPhasePriceModule(): Promise<{ exports: Record<string, unknown> }> {
  const source = await readFile(new URL('../../web/src/phasePrice.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  const require_ = (name: string): unknown => {
    if (name !== 'klinecharts') throw new Error(`意外的依赖引用：${name}`)
    return {}
  }
  new Function('require', 'exports', 'module', js)(require_, exports_, { exports: exports_ })
  return { exports: exports_ }
}

async function loadFormatPercentBadge(): Promise<FormatFn> {
  const { exports } = await loadPhasePriceModule()
  const fn = exports.formatPercentBadge as FormatFn | undefined
  if (typeof fn !== 'function') throw new Error('formatPercentBadge 未在 phasePrice.ts 导出')
  return fn
}

describe('M6-02 percent badge (candle hover)', () => {
  it('formats the badge text and class against the architect oracle close series', async () => {
    const formatPercentBadge = await loadFormatPercentBadge()
    ORACLE_CLOSES.forEach((close, index) => {
      const previousClose = index > 0 ? ORACLE_CLOSES[index - 1] : null
      const badge = formatPercentBadge(close, previousClose)
      expect(badge.text, `text[${index}]`).toBe(EXPECTED_BADGES[index][0])
      expect(badge.cls, `cls[${index}]`).toBe(EXPECTED_BADGES[index][1])
    })
  })

  it('treats a missing or unusable previous close (null/undefined/0/NaN) as the first-bar placeholder', async () => {
    const formatPercentBadge = await loadFormatPercentBadge()
    // 首根（无前收）与不可用前收一律占位 "--"，绝不能把 0/NaN 当除数算出 ±Infinity/NaN 文本
    for (const previousClose of [null, undefined, 0, Number.NaN]) {
      expect(formatPercentBadge(10.5, previousClose)).toEqual({ text: '--', cls: 'pct-flat' })
    }
    // 当前价缺失同样不显示数值
    expect(formatPercentBadge(null, 10.0)).toEqual({ text: '--', cls: 'pct-flat' })
    expect(formatPercentBadge(undefined, 10.0)).toEqual({ text: '--', cls: 'pct-flat' })
  })

  it('rounds tiny moves to a sign-less 0.00% flat badge (never "-0.00%")', async () => {
    const formatPercentBadge = await loadFormatPercentBadge()
    // 手算：10000 → 10000.4 涨 0.004%；10000 → 9999.6 跌 0.004%。两位小数下都归零，
    // 零档不带符号（任务卡示例 "0.00%"），不得出现 "-0.00%" 这类带负号的零
    expect(formatPercentBadge(10000.4, 10000)).toEqual({ text: '0.00%', cls: 'pct-flat' })
    expect(formatPercentBadge(9999.6, 10000)).toEqual({ text: '0.00%', cls: 'pct-flat' })
  })

  it('keeps two decimals with explicit signs for ordinary moves (hand-derived checks)', async () => {
    const formatPercentBadge = await loadFormatPercentBadge()
    // 手算：10.00 → 11.00 = +10%；11.00 → 10.00 = −9.0909…% → "-9.09%"；
    // 3.30 → 3.33 = +0.9090…% → "+0.91%"（四舍五入进位）
    expect(formatPercentBadge(11.0, 10.0)).toEqual({ text: '+10.00%', cls: 'pct-up' })
    expect(formatPercentBadge(10.0, 11.0)).toEqual({ text: '-9.09%', cls: 'pct-down' })
    expect(formatPercentBadge(3.33, 3.3)).toEqual({ text: '+0.91%', cls: 'pct-up' })
  })
})
