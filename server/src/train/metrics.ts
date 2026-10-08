import type { DatabaseSync } from 'node:sqlite'
import { loadAdjustmentEvents } from '../tdx/adjustment-cache.js'
import { integerShareCredit } from './account.js'

// M4-01 指标计算：纯函数、只读派生，不读行情、不写库。
// 口径已按拍板 S4 冻结（2026-09-29，roadmap §2.7 固定样例逐项确认）：
// - 部分卖出计平仓笔：摊薄成本法，每笔卖出＝1笔平仓；单笔已实现盈亏＝卖出净入金(金额−卖出费)
//   −所卖份额摊薄成本（成本含买入费与配股缴款，按卖出比例摊销，与 account.applyTrade 同源）。
// - 费用与权息归属：费用含在权益与已实现盈亏中不重复扣；权息按 position_events 已入账口径进
//   权益，持有期分红不计入单笔已实现盈亏（避免与权益口径双计）。

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

export interface RealizedSell {
  /** 已实现盈亏（含买卖费用）：卖出净入金 − 所卖份额摊薄成本 */
  pnl: number
  /** pnl > 0 记为赢；pnl === 0 不计赢也不计亏（胜率分母含、盈亏比两侧都不含） */
  win: boolean
}

/**
 * 逐笔卖出的已实现盈亏（摊薄成本法）：按日期归并成交与权息入账重放账户
 * （与 engine.replayState 同一口径——同日先事件后成交；legacy cost_delta=null 行按
 * adj_factors 推断配股缴款成本，不回写旧行），每次卖出按卖出比例摊销当期 costTotal。
 * 只读：不写库、不读行情文件（legacy 推断只查 adj_factors 缓存表）。
 */
export function realizedSellResults(
  database: DatabaseSync,
  trainingId: number,
  initialCash: number,
  market: string,
  code: string,
): RealizedSell[] {
  const tradeRows = database.prepare(
    'SELECT seq, trade_date AS date, side, shares, amount, fee FROM trades WHERE training_id = ? ORDER BY seq',
  ).all(trainingId) as unknown as Array<{ seq: number; date: string; side: 'buy' | 'sell'; shares: number; amount: number; fee: number }>
  const eventRows = database.prepare(
    'SELECT seq, date, shares_delta, cash_delta, cost_delta FROM position_events WHERE training_id = ? ORDER BY seq',
  ).all(trainingId) as unknown as Array<{ seq: number; date: string; shares_delta: number; cash_delta: number; cost_delta: number | null }>
  const legacyAdjustments = new Map((eventRows.some(event => event.cost_delta === null)
    ? loadAdjustmentEvents(database, market as 'sh' | 'sz' | 'bj', code)
    : []).map(event => [event.date, event]))
  const merged: Array<{ date: string; seq: number; kind: 'trade' | 'event'; trade?: typeof tradeRows[number]; event?: typeof eventRows[number] }> = [
    ...tradeRows.map(trade => ({ date: trade.date, seq: trade.seq, kind: 'trade' as const, trade })),
    ...eventRows.map(event => ({ date: event.date, seq: event.seq, kind: 'event' as const, event })),
  ].sort((left, right) => left.date.localeCompare(right.date)
    || (left.kind === right.kind ? left.seq - right.seq : left.kind === 'event' ? -1 : 1))
  let state = { cash: initialCash, shares: 0, costTotal: 0 }
  const results: RealizedSell[] = []
  for (const item of merged) {
    if (item.kind === 'event' && item.event) {
      let costDelta = item.event.cost_delta ?? 0
      const adjustment = item.event.cost_delta === null ? legacyAdjustments.get(item.date) : undefined
      if (adjustment && state.shares > 0 && adjustment.rightsShares > 0) {
        // legacy 行只有净现金：股数与现金都对上配股因子时才恢复认购成本，不重写旧行。
        const bonusShares = adjustment.bonusShares / 10 * state.shares
        const rightsShares = adjustment.rightsShares / 10 * state.shares
        const rightsCost = adjustment.rightsPrice * rightsShares
        const paid = adjustment.dividend / 10 * state.shares - item.event.cash_delta
        if (paid > 0 && Math.abs(item.event.shares_delta - bonusShares - rightsShares) < 1e-6
          && Math.abs(paid - rightsCost) < 1e-6) {
          costDelta = paid
        }
      }
      state = {
        cash: state.cash + item.event.cash_delta,
        // RF-01：与 engine.replayState 同口径——旧流水行的 float32 比例尾巴在重放时取整。
        shares: state.shares + integerShareCredit(item.event.shares_delta),
        costTotal: state.costTotal + costDelta,
      }
    } else if (item.trade) {
      const trade = item.trade
      if (trade.side === 'buy') {
        state = {
          cash: state.cash - trade.amount - trade.fee,
          shares: state.shares + trade.shares,
          costTotal: state.costTotal + trade.amount + trade.fee,
        }
      } else {
        const soldRatio = trade.shares / state.shares
        const costBasis = state.costTotal * soldRatio
        const pnl = (trade.amount - trade.fee) - costBasis
        results.push({ pnl, win: pnl > 0 })
        state = {
          cash: state.cash + trade.amount - trade.fee,
          shares: state.shares - trade.shares,
          costTotal: state.costTotal - costBasis,
        }
      }
    }
  }
  return results
}

/** 胜率＝盈利卖出笔数 ÷ 总卖出笔数；零卖出 → null（"--"，不冒充 0）。 */
export function winRateOf(sells: readonly RealizedSell[]): number | null {
  if (!sells.length) return null
  return sells.filter(sell => sell.win).length / sells.length
}

/**
 * 盈亏比＝平均单笔盈利额 ÷ 平均单笔亏损额（亏损取绝对值）。
 * 零卖出、无盈利笔或无亏损笔 → null（"--"：零亏损的"无限大"不虚构为数值）。
 */
export function profitLossRatioOf(sells: readonly RealizedSell[]): number | null {
  if (!sells.length) return null
  const wins = sells.filter(sell => sell.win).map(sell => sell.pnl)
  const losses = sells.filter(sell => sell.pnl < 0).map(sell => -sell.pnl)
  if (!wins.length || !losses.length) return null
  const avgWin = wins.reduce((sum, value) => sum + value, 0) / wins.length
  const avgLoss = losses.reduce((sum, value) => sum + value, 0) / losses.length
  return avgLoss > 0 ? avgWin / avgLoss : null
}
