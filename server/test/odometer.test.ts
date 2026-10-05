import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// M6-05 账户权益/收益率 Odometer 数字滚动（account-odometer 矩阵，用户 2026-10-05 验收拍板）。
// 独立 oracle 原则：全部期望为内嵌常量（任务卡冻结口径＋手算），本文件禁止调用被测实现生成期望。
// 取数方式沿用 percent-hover.test.ts 的"读 web 真实源码＋ts.transpile 提取执行"模式：
// 测的是 web/src/odometer.ts 的真实导出（纯模块，无 DOM/timer 依赖），不在测试里复制实现。

// ---- 架构师 oracle（冻结）----
// 终值格式（与训练账户面板现状逐字一致）：
//   账户权益 1002345.67 → "¥1,002,345.67"（¥ 前缀＋zh-CN 千分位＋至多两位小数；
//   整数无小数位 "¥1,000,000"＝现状 toLocaleString('zh-CN',{maximumFractionDigits:2}) 行为）
//   收益率 +0.00% → +0.23% 后 "+0.23%"；负收益率 -1.50 格式 "-1.50%"；零取 "+0.00%"（现状 ≥0 补 '+'）
// 时长：与幅度成比例且封顶 [300,600]ms；幅度为零 → 0（不播动画）
// 中断重定向：连续 setTarget 1000000→1000100→1000500→1001200→1002000→1002345（五连发）后，
//   动画目标＝1002345 且无排队帧（帧序列单调趋向最终值、总时长≤单次封顶的合理倍数）

interface RollPlan {
  readonly from: number
  readonly target: number
  readonly startMs: number
  readonly durationMs: number
}
type SampleRoll = (plan: RollPlan | null, nowMs: number) => number | null
type RollDurationMs = (from: number, to: number, reference: number) => number
type FormatNumber = (value: number) => string
interface RollCounter {
  readonly plan: RollPlan | null
  setTarget(value: number, nowMs: number, reference: number): void
  displayed(nowMs: number): number
  rolling(nowMs: number): boolean
}
interface OdometerModule {
  MIN_ROLL_MS: number
  MAX_ROLL_MS: number
  formatEquity: FormatNumber
  /** M6-06：权益滚动层帧格式化（中间采样先取整）。缺失（RED/被移除）时用例回退 formatEquity 复现缺陷 */
  rollDisplayEquity?: FormatNumber
  formatReturnPct: FormatNumber
  rollDurationMs: RollDurationMs
  sampleRoll: SampleRoll
  createRollCounter(initial: number): RollCounter
}

/** 执行 web/src/odometer.ts 真实模块（纯模块，CommonJS 转译即可执行） */
async function loadOdometerModule(): Promise<OdometerModule> {
  const source = await readFile(new URL('../../web/src/odometer.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  new Function('require', 'exports', 'module', js)((): never => { throw new Error('odometer.ts 必须是零依赖纯模块') }, exports_, { exports: exports_ })
  return exports_ as unknown as OdometerModule
}

describe('M6-05 odometer pure logic (account-odometer matrix)', () => {
  it('formats the final equity text exactly like the live panel (¥ prefix, zh-CN grouping, ≤2 decimals)', async () => {
    const { formatEquity } = await loadOdometerModule()
    // 架构师 oracle：1000000→1002345.67 后终文本 "¥1,002,345.67"
    expect(formatEquity(1002345.67)).toBe('¥1,002,345.67')
    // 现状口径：maximumFractionDigits（非 minimum）——整数不带 ".00"、一位小数保留一位、第三位四舍五入
    expect(formatEquity(1000000)).toBe('¥1,000,000')
    expect(formatEquity(1234.5)).toBe('¥1,234.5')
    expect(formatEquity(1234.567)).toBe('¥1,234.57')
    // 非有限数绝不渲染成 "NaN" 文本
    expect(formatEquity(Number.NaN)).toBe('¥--')
    expect(formatEquity(Number.POSITIVE_INFINITY)).toBe('¥--')
  })

  it('formats the final return pct with explicit + sign and two decimals (zero keeps the plus)', async () => {
    const { formatReturnPct } = await loadOdometerModule()
    // 架构师 oracle：+0.00%→+0.23% 后 "+0.23%"；负收益率 -1.50 格式 "-1.50%"
    expect(formatReturnPct(0.23)).toBe('+0.23%')
    expect(formatReturnPct(-1.5)).toBe('-1.50%')
    // 现状口径：≥0 补 '+'，toFixed(2) 两位小数
    expect(formatReturnPct(0)).toBe('+0.00%')
    expect(formatReturnPct(2)).toBe('+2.00%')
    expect(formatReturnPct(0.234)).toBe('+0.23%')
    expect(formatReturnPct(Number.NaN)).toBe('--%')
  })

  it('freezes the duration bounds [300,600]ms and scales duration with magnitude (0 for no change)', async () => {
    const { MIN_ROLL_MS, MAX_ROLL_MS, rollDurationMs } = await loadOdometerModule()
    expect(MIN_ROLL_MS).toBe(300)
    expect(MAX_ROLL_MS).toBe(600)
    // 手算：progress=|Δ|/reference，线性映射 300+300×progress 后取整
    expect(rollDurationMs(1000000, 1000000, 10000)).toBe(0)
    expect(rollDurationMs(0, 100, 100)).toBe(600)   // 满幅 → 封顶
    expect(rollDurationMs(0, 50, 100)).toBe(450)    // 半幅
    expect(rollDurationMs(0, 10, 100)).toBe(330)    // 10%
    // 与幅度成比例（单调）＋方向无关（看幅度）＋任意非零幅度都落在 [300,600]
    expect(rollDurationMs(0, 20, 100)).toBeGreaterThan(rollDurationMs(0, 10, 100))
    expect(rollDurationMs(100, 0, 100)).toBe(600)
    for (const [from, to, reference] of [[0, 1, 1000000], [1000000, 1002345, 100], [5, 1e9, 100]] as const) {
      const ms = rollDurationMs(from, to, reference)
      expect(ms).toBeGreaterThanOrEqual(300)
      expect(ms).toBeLessThanOrEqual(600)
    }
  })

  it('samples an eased roll that never overshoots and lands on the exact target at/after the end', async () => {
    const { sampleRoll } = await loadOdometerModule()
    expect(sampleRoll(null, 0)).toBeNull()
    const plan: RollPlan = { from: 1000000, target: 1002345, startMs: 0, durationMs: 370 }
    expect(sampleRoll(plan, 0)).toBe(1000000)
    expect(sampleRoll(plan, -5)).toBe(1000000)          // 起点前钳制在 from
    // 终值精确：到达（含超出）后采样严格等于账面目标，绝无 1002344.999… 这类浮点残留
    expect(sampleRoll(plan, 370)).toBe(1002345)
    expect(sampleRoll(plan, 1000)).toBe(1002345)
    // 缓动单调趋向：16ms 步进帧非递减且永不越过目标
    let previous = -Infinity
    for (let now = 0; now <= 370; now += 16) {
      const value = sampleRoll(plan, now)!
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeLessThanOrEqual(1002345)
      previous = value
    }
  })

  it('creates a counter that starts settled on the initial value (no roll on mount)', async () => {
    const { createRollCounter } = await loadOdometerModule()
    const counter = createRollCounter(1000000)
    expect(counter.plan).toBeNull()
    expect(counter.rolling(0)).toBe(false)
    expect(counter.displayed(0)).toBe(1000000)
    // 账面值未变（如推进后 load() 重取同值）→ 不播动画、读数即终值
    counter.setTarget(1000000, 10, 10000)
    expect(counter.plan).toBeNull()
    expect(counter.rolling(20)).toBe(false)
    expect(counter.displayed(20)).toBe(1000000)
  })

  it('rolls once for a single change and reports the exact book value after it ends', async () => {
    const { createRollCounter } = await loadOdometerModule()
    const counter = createRollCounter(1000000)
    counter.setTarget(1002345, 0, 10023.45)
    // 手算：progress=2345/10023.45≈0.234 → duration≈370ms（只断言语义与界，不锁内部取整值）
    expect(counter.plan).not.toBeNull()
    expect(counter.plan!.from).toBe(1000000)
    expect(counter.plan!.target).toBe(1002345)
    expect(counter.plan!.startMs).toBe(0)
    expect(counter.plan!.durationMs).toBeGreaterThanOrEqual(300)
    expect(counter.plan!.durationMs).toBeLessThanOrEqual(600)
    expect(counter.rolling(0)).toBe(true)
    expect(counter.rolling(counter.plan!.startMs + counter.plan!.durationMs)).toBe(false)
    // 结束后立即读取＝精确等于账面值
    expect(counter.displayed(counter.plan!.startMs + counter.plan!.durationMs)).toBe(1002345)
  })

  it('redirects five rapid setTargets to the last target without queueing or replaying (ODO-RAPID-CATCHUP)', async () => {
    const { createRollCounter, MAX_ROLL_MS } = await loadOdometerModule()
    const counter = createRollCounter(1000000)
    // 五连发（时间紧凑推进：每 60ms 一个新账面值）
    counter.setTarget(1000100, 0, 10000)
    counter.setTarget(1000500, 60, 10000)
    counter.setTarget(1001200, 120, 10000)
    counter.setTarget(1002000, 180, 10000)
    counter.setTarget(1002345, 240, 10000)
    // 无排队：计数器只持有一条计划，且它已被最后一次 setTarget 替换（startMs=最后一次时刻）
    expect(counter.plan).not.toBeNull()
    expect(counter.plan!.target).toBe(1002345)
    expect(counter.plan!.startMs).toBe(240)
    // 中断重定向＝从当前显示值续滚：既不回卷到 1000000 重放，也不直接跳到终值
    const atInterrupt = counter.displayed(240)
    expect(atInterrupt).toBeGreaterThan(1000000)
    expect(atInterrupt).toBeLessThan(1002000)
    // 帧序列单调趋向最终值、无越过（16ms 步进覆盖最后一次 setTarget 后两倍封顶窗口）
    let previous = atInterrupt
    let last = atInterrupt
    for (let now = 256; now <= 240 + MAX_ROLL_MS * 2; now += 16) {
      const value = counter.displayed(now)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeLessThanOrEqual(1002345)
      previous = value
      last = value
    }
    expect(last).toBe(1002345)
    // 总时长断言口径（自定并说明理由）：最后一次 setTarget 后 MAX_ROLL_MS 内必须收口——
    // 若五连发被排队/重放，最后一次之后还需 ≥5×300ms 才能轮到并播完，600ms 必然不够；
    // 中断重定向实现则只播"当前显示值→最新目标"这一段（≤封顶时长）。
    expect(counter.rolling(240 + MAX_ROLL_MS)).toBe(false)
    expect(counter.displayed(240 + MAX_ROLL_MS)).toBe(1002345)
  })

  it('renders integer-only equity roll frames while return pct frames keep two decimals (ODO-NO-PHANTOM-DECIMALS)', async () => {
    const { createRollCounter, formatEquity, formatReturnPct, rollDisplayEquity } = await loadOdometerModule()
    // M6-06 冻结 oracle（用户 2026-10-05 验收反馈：中间值 ¥1,000,872.45 而终值 ¥1,000,872）：
    //   权益滚动层每一帧＝整数元（无小数点与小数位），与终值格式一致；
    //   收益率中间帧保持两位小数（与终值一致，不变项）；
    //   终值路径 formatEquity 不动（账面终值即整数；未来真实小数出现须随规格变更同步，非默默显示）。
    // RED 口径：rollDisplayEquity 未实现/被移除时回退终值格式——缓动中间帧是浮点、
    // maximumFractionDigits:2 必渲染出小数位，恰复现用户截图的幻影小数缺陷。
    const rollEquityText = typeof rollDisplayEquity === 'function' ? rollDisplayEquity : formatEquity
    const counter = createRollCounter(1000000)
    counter.setTarget(1002345, 0, 10023.45)
    const plan = counter.plan!
    let phantomOnFinalFormat = false
    for (let now = plan.startMs; now < plan.startMs + plan.durationMs; now += 16) {
      const value = counter.displayed(now)
      // 前提成立性（缺陷确非空转断言）：本轨道的缓动中间帧确有浮点，终值格式会渲染出小数
      if (formatEquity(value).includes('.')) phantomOnFinalFormat = true
      // 滚动层帧文本：¥＋千分位整数元，逐帧无小数点
      expect(rollEquityText(value), `equity roll frame at t=${now}ms`).toMatch(/^¥\d{1,3}(,\d{3})*$/)
    }
    expect(phantomOnFinalFormat).toBe(true)
    // 终值路径不动：账面整数目标经 formatEquity 与现状逐字一致（滚动末帧与真实文本衔接无跳变）
    expect(formatEquity(1002345)).toBe('¥1,002,345')
    // 收益率中间帧：恒两位小数（"+0.1x%" 形态，符号随值）
    const returns = createRollCounter(0.1)
    returns.setTarget(1.5, 0, 5)
    const returnPlan = returns.plan!
    for (let now = returnPlan.startMs; now < returnPlan.startMs + returnPlan.durationMs; now += 16) {
      expect(formatReturnPct(returns.displayed(now)), `return roll frame at t=${now}ms`).toMatch(/^[+-]\d+\.\d{2}%$/)
    }
  })
})
