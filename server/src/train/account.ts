import type { DayBar } from '../tdx/dayfile.js'

export const LOT_SIZE = 100
export const COMMISSION_RATE = 0.00025
export const COMMISSION_MIN = 5
export const STAMP_TAX_RATE = 0.0005
const CASH_EPSILON = 1e-6

export interface FeeConfig {
  enabled: boolean
  /** 费用数值自 TRAIN-01 返修 F1 起由规则快照提供；缺省等于既有固定口径（兼容无快照纯账户调用） */
  commissionRate: number
  minimumCommission: number
  stampDutyRate: number
  lotSize: number
}

export const DEFAULT_FEES: FeeConfig = {
  enabled: false,
  commissionRate: COMMISSION_RATE,
  minimumCommission: COMMISSION_MIN,
  stampDutyRate: STAMP_TAX_RATE,
  lotSize: LOT_SIZE,
}

export interface AccountState {
  cash: number
  shares: number
  costTotal: number
}

export function initialAccountState(initialCash: number): AccountState {
  return { cash: initialCash, shares: 0, costTotal: 0 }
}

export interface TradePlan {
  side: 'buy' | 'sell'
  price: number
  shares: number
  amount: number
  fee: number
  tax: number
}

export type TradePlanResult = { ok: true; plan: TradePlan } | { ok: false; error: string }

export function equityOf(state: AccountState, price: number): number {
  return state.cash + state.shares * price
}

export function dilutedCostPrice(state: AccountState): number | null {
  return state.shares > 0 ? state.costTotal / state.shares : null
}

export function buyCommission(amount: number, fees: FeeConfig): number {
  return fees.enabled ? Math.max(fees.minimumCommission, amount * fees.commissionRate) : 0
}

export function sellFee(amount: number, fees: FeeConfig): number {
  if (!fees.enabled) return 0
  return Math.max(fees.minimumCommission, amount * fees.commissionRate) + amount * fees.stampDutyRate
}

// 仓位比例按总权益（现金＋持仓市值）计，再受可用资金约束；金额向下取整到一手（手数=快照 lotSize）。
// 若连费用一起超出可用资金，逐手缩减；缩到不足一手则拒绝。
export function planBuy(
  state: AccountState,
  price: number,
  weightPct: number,
  fees: FeeConfig = DEFAULT_FEES,
): TradePlanResult {
  if (!(price > 0) || !Number.isFinite(price)) return { ok: false, error: '无效的成交价格' }
  if (!(weightPct > 0) || weightPct > 100) return { ok: false, error: '买入仓位比例必须在 (0, 100] 内' }
  const lotSize = fees.lotSize
  const equity = equityOf(state, price)
  let lots = Math.floor((equity * weightPct) / 100 / price / lotSize)
  if (lots < 1) return { ok: false, error: '按该比例计算的金额不足一手' }
  let shares = lots * lotSize
  let amount = shares * price
  let fee = buyCommission(amount, fees)
  while (lots >= 1 && amount + fee > state.cash + CASH_EPSILON) {
    lots -= 1
    shares = lots * lotSize
    amount = shares * price
    fee = buyCommission(amount, fees)
  }
  if (lots < 1) return { ok: false, error: '可用资金不足一手' }
  return {
    ok: true,
    plan: { side: 'buy', price, shares, amount, fee, tax: 0 },
  }
}

export interface SellRequest {
  shares?: number
  weightPct?: number
}

// 卖出数量必须是一手（快照 lotSize）的整数倍；整份清仓（等于可卖数量）允许零股。
// A 股 T+1 下可卖数量由引擎传入。
export function planSell(
  state: AccountState,
  price: number,
  request: SellRequest,
  availableShares: number,
  fees: FeeConfig = DEFAULT_FEES,
): TradePlanResult {
  if (!(price > 0) || !Number.isFinite(price)) return { ok: false, error: '无效的成交价格' }
  if (!Number.isInteger(availableShares) || availableShares <= 0) {
    return { ok: false, error: '当前没有可卖持仓' }
  }
  const lotSize = fees.lotSize
  let shares: number
  if (request.shares !== undefined) {
    if (!Number.isInteger(request.shares) || request.shares <= 0) {
      return { ok: false, error: '卖出股数必须是正整数' }
    }
    if (request.shares > availableShares) {
      return { ok: false, error: `可卖数量不足（T+1 限可卖 ${availableShares} 股）` }
    }
    if (request.shares !== availableShares && request.shares % lotSize !== 0) {
      return { ok: false, error: '卖出数量必须是一手的整数倍（清仓可整份卖出）' }
    }
    shares = request.shares
  } else if (request.weightPct !== undefined) {
    if (!(request.weightPct > 0) || request.weightPct > 100) {
      return { ok: false, error: '卖出仓位比例必须在 (0, 100] 内' }
    }
    const raw = (availableShares * request.weightPct) / 100
    const lots = Math.floor(raw / lotSize)
    if (lots < 1) {
      if (request.weightPct === 100) {
        shares = availableShares
      } else {
        return { ok: false, error: '按该比例计算的卖出数量不足一手' }
      }
    } else if (lots * lotSize >= availableShares) {
      shares = availableShares
    } else {
      shares = lots * lotSize
    }
  } else {
    return { ok: false, error: '卖出请求必须提供 shares 或 weightPct' }
  }
  const amount = shares * price
  return {
    ok: true,
    plan: { side: 'sell', price, shares, amount, fee: sellFee(amount, fees), tax: 0 },
  }
}

export function applyTrade(state: AccountState, plan: TradePlan): AccountState {
  if (plan.side === 'buy') {
    return {
      cash: state.cash - plan.amount - plan.fee,
      shares: state.shares + plan.shares,
      costTotal: state.costTotal + plan.amount + plan.fee,
    }
  }
  const soldRatio = plan.shares / state.shares
  return {
    cash: state.cash + plan.amount - plan.fee,
    shares: state.shares - plan.shares,
    costTotal: state.costTotal - state.costTotal * soldRatio,
  }
}

// 从成交记录重放账户状态（成交记录已含费用），用于服务端状态重建与对账。
export function replayAccount(initialCash: number, plans: Array<Pick<TradePlan, 'side' | 'shares' | 'amount' | 'fee'>>): AccountState {
  let state = initialAccountState(initialCash)
  for (const plan of plans) {
    state = applyTrade(state, { ...plan, price: 0, tax: 0 })
  }
  return state
}

export interface EquityPoint {
  date: string
  equity: number
}

export function equityCurve(bars: DayBar[], stateAt: (bar: DayBar) => AccountState): EquityPoint[] {
  return bars.map(bar => ({ date: bar.date, equity: equityOf(stateAt(bar), bar.close) }))
}
