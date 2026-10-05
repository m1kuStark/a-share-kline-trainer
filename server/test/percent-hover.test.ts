import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// M6-03 悬浮信息卡（candle-percent-hover 矩阵 v2；v1 涨幅徽标由信息卡取代）。
// 独立 oracle 原则：期望表全部为内嵌常量——收盘价序列与期望徽标由架构师预计算
// （任务卡 2026-10-05 冻结，v2 沿用 v1 涨幅口径），卡内容夹具由架构师另行预计算，
// 本文件禁止调用被测实现生成期望。
// 取数方式沿用 kdj-indicator.test.ts 的"读 web 真实源码＋ts.transpile 提取执行"模式：
// 测的是 web/src/phasePrice.ts 的真实导出 formatPercentBadge / formatHoverCard，
// 不在测试里复制实现。

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
type HoverCardRow = { label: string; value: string }
type HoverCardModel = { date: string; rows: HoverCardRow[]; pct: Badge }
type HoverCardFn = (bar: { date?: string; open: number; high: number; low: number; close: number } | null | undefined, previousClose: number | null | undefined) => HoverCardModel | null

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

async function loadFormatHoverCard(): Promise<{ format: HoverCardFn; dwellMs: number }> {
  const { exports } = await loadPhasePriceModule()
  const fn = exports.formatHoverCard as HoverCardFn | undefined
  if (typeof fn !== 'function') throw new Error('formatHoverCard 未在 phasePrice.ts 导出')
  const dwellMs = exports.HOVER_CARD_DWELL_MS
  if (dwellMs !== 1000) throw new Error(`HOVER_CARD_DWELL_MS 应为冻结值 1000，实际 ${String(dwellMs)}`)
  return { format: fn, dwellMs }
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

describe('M6-03 hover card contents (candle dwell card)', () => {
  // 架构师卡内容夹具（任务卡 2026-10-05 冻结）：
  // bar{date:2026-08-19, open:10.00, high:10.50, low:9.80, close:10.29}, prevClose=10.00
  // → 卡含 日期"2026-08-19"、开"10.00"、高"10.50"、低"9.80"、收"10.29"、涨幅"+2.90%"（红）。
  // 手算复核：(10.29−10.00)/10.00×100 = 2.90（精确值，两位小数无舍入争议）。
  const FIXTURE_BAR = { date: '2026-08-19', open: 10.0, high: 10.5, low: 9.8, close: 10.29 }

  it('formats the card rows and pct against the architect fixture (date + 开/高/低/收/涨幅)', async () => {
    const { format } = await loadFormatHoverCard()
    const card = format(FIXTURE_BAR, 10.0)
    expect(card).toEqual({
      date: '2026-08-19',
      rows: [
        { label: '开', value: '10.00' },
        { label: '高', value: '10.50' },
        { label: '低', value: '9.80' },
        { label: '收', value: '10.29' },
      ],
      pct: { text: '+2.90%', cls: 'pct-up' },
    })
    // 键名与顺序冻结：开/高/低/收 四行在前，涨幅由 pct 字段单独携带（模板渲染为第五个键值行）
    expect(card?.rows.map(row => row.label)).toEqual(['开', '高', '低', '收'])
  })

  it('keeps the frozen dwell constant at 1000ms (mouse dwell threshold)', async () => {
    // 用户拍板：停留 ≥1000ms 触发；该常量导出供组件定时器引用，测试锁死不得漂移
    await loadFormatHoverCard()
  })

  it('carries the v1 close-series pct oracle through the card pct field', async () => {
    const { format } = await loadFormatHoverCard()
    // 夹具 K 线只填收盘（开高低收同值不影响涨幅口径——涨幅只看 close 与前收）；
    // 期望仍取内嵌 EXPECTED_BADGES（架构师预计算），不从实现生成
    ORACLE_CLOSES.forEach((close, index) => {
      const bar = { date: `2026-09-${String(index + 1).padStart(2, '0')}`, open: close, high: close, low: close, close }
      const previousClose = index > 0 ? ORACLE_CLOSES[index - 1] : null
      const card = format(bar, previousClose)
      expect(card?.pct.text, `pct.text[${index}]`).toBe(EXPECTED_BADGES[index][0])
      expect(card?.pct.cls, `pct.cls[${index}]`).toBe(EXPECTED_BADGES[index][1])
    })
  })

  it('shows the gray placeholder pct for the first bar and keeps OHLC two-decimal rows', async () => {
    const { format } = await loadFormatHoverCard()
    // 首根（无前收）：涨幅位 "--"（灰），其余行照常两位小数
    const card = format(FIXTURE_BAR, null)
    expect(card?.pct).toEqual({ text: '--', cls: 'pct-flat' })
    expect(card?.rows.map(row => `${row.label}${row.value}`)).toEqual(['开10.00', '高10.50', '低9.80', '收10.29'])
  })

  it('formats a down day with the green pct class (hand-derived) and passes the date through as-is', async () => {
    const { format } = await loadFormatHoverCard()
    // 手算：前收 10.00 → 收 9.95 = −0.50%（精确值）
    const card = format({ date: '2026-08-20', open: 10.5, high: 10.6, low: 9.95, close: 9.95 }, 10.0)
    expect(card?.date).toBe('2026-08-20')
    expect(card?.rows).toEqual([
      { label: '开', value: '10.50' },
      { label: '高', value: '10.60' },
      { label: '低', value: '9.95' },
      { label: '收', value: '9.95' },
    ])
    expect(card?.pct).toEqual({ text: '-0.50%', cls: 'pct-down' })
  })

  it('returns no card when the bar is missing or its OHLC is not finite', async () => {
    const { format } = await loadFormatHoverCard()
    expect(format(null, 10.0)).toBeNull()
    expect(format(undefined, 10.0)).toBeNull()
    expect(format({ date: '2026-08-19', open: Number.NaN, high: 10.5, low: 9.8, close: 10.29 }, 10.0)).toBeNull()
  })
})
