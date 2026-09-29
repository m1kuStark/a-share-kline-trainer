// M4-01 指标计算：纯函数、只读派生，不读行情、不写库。
// 口径冻结（拍板 S4）前只落地与固定样例无关的最大回撤；胜率/盈亏比/基准超额
// 依赖 roadmap 固定样例的口径确认（部分卖出计平仓笔、基准对齐等），冻结后补齐。

/**
 * 最大回撤（基于持久权益点，不插值、不虚构）：按 date 升序维护历史峰值，
 * max((peak − equity) / peak)。0 或 1 个点 → 0（没有下跌观察，如实为 0，
 * 与"数据不足不得冒充完整成绩"不冲突：0 是持久点序列的真实推导值）。
 * 输入必须已过滤为有限值（调用方负责；非有限值属于行级不可认证）。
 */
export function maxDrawdownOf(equities: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY
  let maxDrawdown = 0
  for (const value of equities) {
    if (value > peak) peak = value
    if (peak > 0) {
      const drawdown = (peak - value) / peak
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }
  }
  return maxDrawdown
}
