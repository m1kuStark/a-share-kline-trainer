// M6-05 账户权益/收益率 Odometer 数字滚动——纯逻辑模块（account-odometer 矩阵）。
// 零依赖、无 DOM/timer：时间一律由调用方注入（performance.now()），
// 由 web/src/views/Training.vue 负责接线（rAF 采样 + CSS 数字位竖直滚动）。
// 冻结口径（docs/work-items/tasks/M6-05.md，用户 2026-10-05 验收拍板）：
//   - 时长与变化幅度成比例且封顶 [300,600]ms；幅度为零不播动画；
//   - 连续变化＝中断重定向：从当前显示值滚向最新目标，不排队不重放，任何时刻可打断；
//   - 动画结束或被打断后立即读取＝精确等于账面值（格式与现状一致）；
//   - 终值格式：账户权益 "¥" + zh-CN 千分位（至多两位小数）；收益率 显式正负号 + 两位小数 + "%"。

/** 单次滚动时长下限（冻结：建议区间 300~600ms 的下界） */
export const MIN_ROLL_MS = 300
/** 单次滚动时长上限（冻结：建议区间 300~600ms 的上界，也是 ODO-RAPID-CATCHUP 的封顶） */
export const MAX_ROLL_MS = 600

/** 账户权益终值文本：与面板现状逐字一致（¥ 前缀＋toLocaleString('zh-CN', { maximumFractionDigits: 2 })） */
export function formatEquity(value: number): string {
  if (!Number.isFinite(value)) return '¥--'
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

/** 收益率终值文本：与面板现状逐字一致（≥0 补 '+'；toFixed(2) 两位小数；负号由 toFixed 自带） */
export function formatReturnPct(value: number): string {
  if (!Number.isFinite(value)) return '--%'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

/**
 * 滚动时长：|Δ|/reference 线性映射到 [MIN_ROLL_MS, MAX_ROLL_MS]（幅度成比例且封顶）。
 * reference 由调用方按字段给出量纲：账户权益取 max(|from|,|to|)×1%（相对幅度），
 * 收益率取固定 5 个百分点；幅度为零（或输入非有限）返回 0＝不播动画。
 */
export function rollDurationMs(from: number, to: number, reference: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(reference) || reference <= 0) return 0
  const delta = Math.abs(to - from)
  if (delta === 0) return 0
  const progress = Math.min(1, delta / reference)
  return Math.round(MIN_ROLL_MS + (MAX_ROLL_MS - MIN_ROLL_MS) * progress)
}

export interface RollPlan {
  /** 起点：计划创建时刻的显示值（中断重定向时＝被打断动画的当前值） */
  readonly from: number
  /** 目标：最新账面值 */
  readonly target: number
  /** 计划开始时刻（注入时钟，ms） */
  readonly startMs: number
  /** 时长（ms），由 rollDurationMs 得出 */
  readonly durationMs: number
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

/**
 * 采样滚动计划在 nowMs 时刻的显示值：缓动插值；t≥1 精确返回 target（终值精确保证，
 * 无浮点残留）；t≤0 钳制在 from；plan 为 null 返回 null（静止由计数器的 rest 承担）。
 */
export function sampleRoll(plan: RollPlan | null, nowMs: number): number | null {
  if (!plan) return null
  if (plan.durationMs <= 0) return plan.target
  const t = (nowMs - plan.startMs) / plan.durationMs
  if (t <= 0) return plan.from
  if (t >= 1) return plan.target
  return plan.from + (plan.target - plan.from) * easeOutCubic(t)
}

export interface RollCounter {
  /** 当前滚动计划（静止时 null）；只读探针，供测试断言"无排队"（单一计划、被替换而非追加） */
  readonly plan: RollPlan | null
  /**
   * 设置最新账面值（中断重定向策略）：
   * - 已有动画在播 → 从"此刻显示值"续滚向新目标（不排队、不回卷重放）；
   * - 静止且数值未变 → 不播动画；
   * - 非有限值忽略（防御脏数据，显示保持原值）。
   */
  setTarget(value: number, nowMs: number, reference: number): void
  /** nowMs 时刻的显示值（静止＝最近账面值；动画中＝缓动采样） */
  displayed(nowMs: number): number
  /** nowMs 时刻是否仍在滚动 */
  rolling(nowMs: number): boolean
}

/**
 * 创建滚动计数器。initial＝初始账面值（挂载即静止显示，首屏不播动画）。
 * 计数器任意时刻至多持有一条计划——连续 setTarget 是"替换"而非"入队"。
 */
export function createRollCounter(initial: number): RollCounter {
  let plan: RollPlan | null = null
  let rest = Number.isFinite(initial) ? initial : 0
  const displayed = (nowMs: number): number => sampleRoll(plan, nowMs) ?? rest
  return {
    get plan() { return plan },
    setTarget(value: number, nowMs: number, reference: number): void {
      if (!Number.isFinite(value)) return
      const from = displayed(nowMs)
      const durationMs = rollDurationMs(from, value, reference)
      if (durationMs <= 0) { rest = value; plan = null; return }
      plan = { from, target: value, startMs: nowMs, durationMs }
      rest = value
    },
    displayed,
    rolling(nowMs: number): boolean {
      return plan !== null && plan.durationMs > 0 && nowMs < plan.startMs + plan.durationMs
    },
  }
}
