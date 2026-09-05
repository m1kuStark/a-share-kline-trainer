import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import { isDayDate, readDayFileRange, type DayBar } from '../tdx/dayfile.js'
import { refreshStockCatalog } from '../tdx/catalog.js'
import { loadAdjustmentEvents, refreshAdjustmentCache } from '../tdx/adjustment-cache.js'
import { applyForwardAdjustment, buildForwardAdjustmentSegments } from '../tdx/gbbq.js'
import { aggregateBars, type KlineBar, type Timeframe } from '../tdx/kline.js'
import { parseTdxSymbol } from '../tdx/symbol.js'
import {
  applyTrade, dilutedCostPrice, equityOf, initialAccountState, planBuy, planSell, replayAccount,
  type AccountState, type FeeConfig, type TradePlan,
} from './account.js'

export type Tier = '1M' | '3M' | '6M' | '1Y' | '2Y'
export type TrainingStatus = 'running' | 'settled' | 'abandoned'

export const TIERS: Tier[] = ['1M', '3M', '6M', '1Y', '2Y']
export const TIER_MONTHS: Record<Tier, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 }
export const VISIBLE_BARS = 420
export const MA_WARMUP_BARS = 200
// 服务端发放的 K 线上限：可见 420 根 + 左侧 MA 暖机余量；任何情况下不含推进日之后的数据。
export const TRAINING_LOAD_BARS = VISIBLE_BARS + MA_WARMUP_BARS

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

interface TrainingRow {
  id: number
  tier: Tier
  code: string
  name: string
  market: string
  start_date: string
  planned_end: string
  status: TrainingStatus
  blind: number
  adjust_mode: 'forward' | 'raw'
  initial_cash: number
  created_at: string
  current_date: string | null
  current_close: number | null
  settle_date: string | null
  early_settle: number | null
}

export interface TrainingMeta {
  id: number
  tier: Tier
  code: string | null
  name: string | null
  market: string
  startDate: string
  plannedEnd: string
  /** 双盲进行中为 null，前端显示"今日" */
  currentDate: string | null
  status: TrainingStatus
  settleDate: string | null
  earlySettle: boolean
  blind: boolean
  adjustMode: 'forward' | 'raw'
  initialCash: number
  createdAt: string
}

export interface AccountView {
  cash: number
  shares: number
  availableShares: number
  costPrice: number | null
  marketValue: number
  equity: number
}

export interface TradeView {
  seq: number
  date: string
  side: 'buy' | 'sell'
  price: number
  shares: number
  amount: number
  fee: number
  /** 图表空间价格：按当前复权基准调整后的价格，B/S 标记用；原始成交价见 price */
  chartPrice?: number
  /** 双盲进行中：成交日在推进序列中的序号（0=起始日，最后=今日），前端映射相对时间戳 */
  blindIndex?: number
  /** 双盲进行中：相对日期标签（今日 / T-n），展示用；date 恒为真实值供换算 */
  blindLabel?: number | string
}

export interface TrainingSnapshot {
  training: TrainingMeta
  account: AccountView
  trades: TradeView[]
}

function toMeta(row: TrainingRow): TrainingMeta {
  const masked = row.blind === 1 && row.status === 'running'
  return {
    id: row.id,
    tier: row.tier,
    code: masked ? null : row.code,
    name: masked ? null : row.name,
    market: row.market,
    startDate: row.start_date,
    plannedEnd: row.planned_end,
    currentDate: masked ? null : (row.current_date ?? row.start_date),
    status: row.status,
    settleDate: row.settle_date,
    earlySettle: row.early_settle === 1,
    blind: row.blind === 1,
    adjustMode: row.adjust_mode,
    initialCash: row.initial_cash,
    createdAt: row.created_at,
  }
}

function dayFilePath(config: AppConfig, market: string, code: string): string {
  return join(config.tdxRoot ?? '', 'vipdoc', market, 'lday', `${market}${code}.day`)
}

function getSetting(database: DatabaseSync, key: string, fallback: string): string {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined
  return row?.value ?? fallback
}

export function feeConfigOf(database: DatabaseSync): FeeConfig {
  return { enabled: getSetting(database, 'fees_enabled', '0') === '1' }
}

export function t1Enabled(database: DatabaseSync): boolean {
  return getSetting(database, 't1_enabled', '1') === '1'
}

function loadTrainingRow(database: DatabaseSync, id: number): TrainingRow {
  const row = database.prepare('SELECT * FROM trainings WHERE id = ?').get(id) as unknown as TrainingRow | undefined
  if (!row) throw new HttpError(404, `训练 ${id} 不存在`)
  return row
}

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  const targetMonthIndex = year * 12 + month - 1 + months
  const targetYear = Math.floor(targetMonthIndex / 12)
  const targetMonth = targetMonthIndex % 12 + 1
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  const targetDay = Math.min(day, daysInTarget)
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

export async function ensureAdjustmentCache(database: DatabaseSync, config: AppConfig): Promise<void> {
  if (!config.tdxRoot) return
  await refreshAdjustmentCache(database, config.tdxRoot)
}

export interface CreateTrainingInput {
  tier: string
  code: string
  start_date: string
  initial_cash?: number
  blind?: boolean
  adjust_mode?: string
}

export async function createTraining(database: DatabaseSync, config: AppConfig, input: CreateTrainingInput): Promise<TrainingMeta> {
  if (!TIERS.includes(input.tier as Tier)) {
    throw new HttpError(400, `训练周期必须是 ${TIERS.join(' / ')} 之一`)
  }
  const tier = input.tier as Tier
  const adjustMode = input.adjust_mode ?? 'forward'
  if (!['forward', 'raw'].includes(adjustMode)) {
    throw new HttpError(400, '复权方式必须是 forward 或 raw')
  }
  const initialCash = input.initial_cash ?? 1_000_000
  if (!Number.isFinite(initialCash) || initialCash <= 0) {
    throw new HttpError(400, '初始资金必须是正数')
  }
  if (!isDayDate(input.start_date)) {
    throw new HttpError(400, '起始日必须是有效的 YYYY-MM-DD 日期')
  }
  const active = database.prepare("SELECT id FROM trainings WHERE status = 'running'").get()
  if (active) throw new HttpError(409, '已有进行中的训练，请先结算或放弃')

  if (!config.tdxRoot) throw new HttpError(503, '未发现 TDX 数据目录')
  await ensureAdjustmentCache(database, config)
  const stocks = await refreshStockCatalog(database, config.tdxRoot).then(result => result.stocks)
  const parsed = parseTdxSymbol(input.code)
  const stock = stocks.find(item => item.market === parsed.market && item.code === parsed.code)
  if (!stock) throw new HttpError(400, `代码 ${parsed.code} 不在 A 股目录中`)

  const bars = await readDayFileRange(dayFilePath(config, parsed.market, parsed.code))
  const startBar = [...bars].reverse().find(bar => bar.date <= input.start_date)
  if (!startBar) throw new HttpError(400, `起始日 ${input.start_date} 早于该股票的上市日`)

  const createdAt = new Date().toISOString()
  // 末根 K 线在前复权序列中恒等于原始收盘价，因此 current_close 直接存原始收盘，
  // 快照/交易无需再读文件，也杜绝把未来权息混进当前价格。
  const result = database.prepare(`
    INSERT INTO trainings (
      tier, code, name, market, start_date, planned_end, status, blind,
      adjust_mode, initial_cash, created_at, current_date, current_close
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)
  `).run(
    tier, parsed.code, stock.name, parsed.market, startBar.date,
    addMonths(startBar.date, TIER_MONTHS[tier]), input.blind ? 1 : 0,
    adjustMode, initialCash, createdAt, startBar.date, startBar.close,
  )
  const id = Number(result.lastInsertRowid)
  database.prepare(
    'INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)',
  ).run(id, startBar.date, initialCash)
  return toMeta(loadTrainingRow(database, id))
}

// 训练 K 线：先按推进日截断、再前复权（基准=推进日）、后聚合；任何情况下不含推进日之后的数据。
async function buildTrainingSeries(database: DatabaseSync, config: AppConfig, id: number, timeframe: Timeframe): Promise<KlineBar[]> {
  const row = loadTrainingRow(database, id)
  if (!config.tdxRoot) throw new HttpError(503, '未发现 TDX 数据目录')
  const daily = await readDayFileRange(dayFilePath(config, row.market, row.code))
  const current = row.current_date ?? row.start_date
  const upto = daily.filter(bar => bar.date <= current)
  let adjusted = upto
  if (row.adjust_mode === 'forward') {
    await ensureAdjustmentCache(database, config)
    const events = loadAdjustmentEvents(database, row.market as 'sh' | 'sz' | 'bj', row.code)
    adjusted = applyForwardAdjustment(upto, events, current)
  }
  return aggregateBars(adjusted, timeframe)
}

export async function trainingBars(database: DatabaseSync, config: AppConfig, id: number, timeframe: Timeframe): Promise<KlineBar[]> {
  const series = await buildTrainingSeries(database, config, id, timeframe)
  return series.slice(-TRAINING_LOAD_BARS)
}

// 动态历史加载：420 限定的是同屏最大可见根数（缩放下限），不是加载总量。
// 用户把视窗移动到已加载窗口之前时，前端按 before 分批取更早的历史（严格早于 before 的最近 count 根，升序）。
export async function trainingBarsBefore(database: DatabaseSync, config: AppConfig, id: number, timeframe: Timeframe, before: string, count: number): Promise<{ bars: KlineBar[]; hasMore: boolean }> {
  const series = await buildTrainingSeries(database, config, id, timeframe)
  const earlier = series.filter(bar => bar.date < before)
  const bars = earlier.slice(-count)
  return { bars, hasMore: earlier.length > bars.length }
}

function replayState(database: DatabaseSync, row: TrainingRow): AccountState {
  const tradeRows = database.prepare(
    'SELECT trade_date AS date, side, shares, amount, fee FROM trades WHERE training_id = ? ORDER BY seq',
  ).all(row.id) as unknown as Array<{ date: string; side: 'buy' | 'sell'; shares: number; amount: number; fee: number }>
  const eventRows = database.prepare(
    'SELECT date, shares_delta, cash_delta FROM position_events WHERE training_id = ? ORDER BY seq',
  ).all(row.id) as unknown as Array<{ date: string; shares_delta: number; cash_delta: number }>
  // 按日期归并成交与权息入账（同日先事件后成交；跨日事件只可能落在推进日，成交在事件之后）
  const merged: Array<{ date: string; kind: 'trade' | 'event'; trade?: typeof tradeRows[number]; event?: typeof eventRows[number] }> = [
    ...tradeRows.map(trade => ({ date: trade.date, kind: 'trade' as const, trade })),
    ...eventRows.map(event => ({ date: event.date, kind: 'event' as const, event })),
  ].sort((left, right) => left.date.localeCompare(right.date) || (left.kind === 'event' ? -1 : 1))
  let state = initialAccountState(row.initial_cash)
  for (const item of merged) {
    if (item.kind === 'event' && item.event) {
      state = {
        cash: state.cash + item.event.cash_delta,
        shares: state.shares + item.event.shares_delta,
        costTotal: state.costTotal,
      }
    } else if (item.trade) {
      state = applyTrade(state, { side: item.trade.side, price: 0, shares: item.trade.shares, amount: item.trade.amount, fee: item.trade.fee, tax: 0 })
    }
  }
  return state
}

function sharesBoughtOn(database: DatabaseSync, id: number, date: string): number {
  const row = database.prepare(
    "SELECT COALESCE(SUM(shares), 0) AS shares FROM trades WHERE training_id = ? AND side = 'buy' AND trade_date = ?",
  ).get(id, date) as unknown as { shares: number }
  return row.shares
}

export function trainingSnapshot(database: DatabaseSync, id: number): TrainingSnapshot {
  const row = loadTrainingRow(database, id)
  const close = row.current_close ?? row.initial_cash
  const state = replayState(database, row)
  const boughtToday = sharesBoughtOn(database, row.id, row.current_date ?? row.start_date)
  const tradeRows = database.prepare(
    'SELECT seq, trade_date, side, price, shares, amount, fee FROM trades WHERE training_id = ? ORDER BY seq',
  ).all(row.id) as unknown as Array<{ seq: number; trade_date: string; side: 'buy' | 'sell'; price: number; shares: number; amount: number; fee: number }>
  // 双盲进行中：成交日期相对化（今日 / T-n），并下发推进序列序号供前端映射相对时间戳
  const masked = row.blind === 1 && row.status === 'running'
  const advancedDates = masked
    ? (database.prepare('SELECT date FROM equity_curve WHERE training_id = ? ORDER BY date').all(row.id) as unknown as Array<{ date: string }>)
      .map(entry => entry.date)
    : []
  const trades: TradeView[] = tradeRows.map(trade => {
    const base: TradeView = {
      seq: trade.seq,
      date: trade.trade_date,
      side: trade.side,
      price: trade.price,
      shares: trade.shares,
      amount: trade.amount,
      fee: trade.fee,
    }
    if (!masked) return base
    const index = advancedDates.indexOf(trade.trade_date)
    const blindIndex = index >= 0 ? index : advancedDates.length - 1
    return {
      ...base,
      blindIndex,
      blindLabel: blindIndex === advancedDates.length - 1 ? '今日' : `T-${advancedDates.length - 1 - blindIndex}`,
    }
  })
  return {
    training: toMeta(row),
    account: {
      cash: state.cash,
      shares: state.shares,
      availableShares: t1Enabled(database) ? state.shares - boughtToday : state.shares,
      costPrice: dilutedCostPrice(state),
      marketValue: state.shares * close,
      equity: equityOf(state, close),
    },
    trades,
  }
}

export function getActiveTraining(database: DatabaseSync): TrainingMeta | null {
  const row = database.prepare(
    "SELECT * FROM trainings WHERE status = 'running' ORDER BY id DESC LIMIT 1",
  ).get() as unknown as TrainingRow | undefined
  return row ? toMeta(row) : null
}

// 图表空间换算：训练 K 线按"前复权、基准=推进日"绘制，跨除权日后历史价整体平移，
// B/S 标记与成本线若用原始成交价就会错位。这里把每笔成交价换算到当前基准的复权价，
// 并用调整后价格重放出"图表空间的摊薄成本"。raw 模式下原样返回（chartPrice 为空、成本线用原值）。
export function buildChartSpace(database: DatabaseSync, id: number, trades: TradeView[]): { trades: TradeView[]; costPrice: number | null } {
  const row = loadTrainingRow(database, id)
  if (row.adjust_mode !== 'forward') return { trades, costPrice: null }
  const events = loadAdjustmentEvents(database, row.market as 'sh' | 'sz' | 'bj', row.code)
    .filter(event => event.date <= (row.current_date ?? row.start_date))
  if (!events.length) return { trades, costPrice: null }
  const segments = buildForwardAdjustmentSegments(events)
  const segmentFor = (date: string) => segments.find(segment =>
    (segment.from === null || date >= segment.from) &&
    (segment.to === null || date <= segment.to),
  ) ?? { a: 1, b: 0 }
  const chartTrades = trades.map(trade => {
    const { a, b } = segmentFor(trade.date)
    return { ...trade, chartPrice: trade.price * a + b }
  })
  const state = replayAccount(row.initial_cash, chartTrades.map(trade => ({
    side: trade.side, shares: trade.shares, amount: trade.chartPrice! * trade.shares, fee: trade.fee,
  })))
  return { trades: chartTrades, costPrice: dilutedCostPrice(state) }
}

// 训练跨除权日推进时，把权息事件入账到持仓：分红入现金、送转加股；
// 配股在现金足够时自动缴款认购，不足则放弃（V1 简化，停机报告中说明）。
// 否则送转会物理性稀释持仓，权益在除权日凭空缩水。
export function applyPositionEvents(
  database: DatabaseSync,
  row: TrainingRow,
  state: AccountState,
  date: string,
  events: Array<{ date: string; dividend: number; rightsPrice: number; bonusShares: number; rightsShares: number }>,
): AccountState {
  let result = state
  const sameDay = events.filter(event => event.date === date)
  for (const event of sameDay) {
    if (result.shares <= 0) break
    const sharesBefore = result.shares
    let cashDelta = (event.dividend / 10) * sharesBefore
    let sharesDelta = (event.bonusShares / 10) * sharesBefore
    const rightsShares = (event.rightsShares / 10) * sharesBefore
    const rightsCost = event.rightsPrice * rightsShares
    if (rightsShares > 0 && result.cash + cashDelta >= rightsCost) {
      cashDelta -= rightsCost
      sharesDelta += rightsShares
    }
    if (sharesDelta === 0 && cashDelta === 0) continue
    const seqRow = database.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM position_events WHERE training_id = ?',
    ).get(row.id) as unknown as { seq: number }
    database.prepare(`
      INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta)
      VALUES (?, ?, ?, 'corporate_action', ?, ?)
    `).run(row.id, seqRow.seq, date, sharesDelta, cashDelta)
    result = {
      cash: result.cash + cashDelta,
      shares: result.shares + sharesDelta,
      costTotal: result.costTotal,
    }
  }
  return result
}

export async function advanceTraining(database: DatabaseSync, config: AppConfig, id: number): Promise<{ snapshot: TrainingSnapshot; settled: boolean; bar: KlineBar | null }> {
  const row = loadTrainingRow(database, id)
  if (row.status !== 'running') throw new HttpError(409, '训练已结束，无法推进')
  if (!config.tdxRoot) throw new HttpError(503, '未发现 TDX 数据目录')
  const daily = await readDayFileRange(dayFilePath(config, row.market, row.code))
  const current = row.current_date ?? row.start_date
  const next = daily.find(bar => bar.date > current && bar.date <= row.planned_end)
  if (!next) {
    // 到期结算：个股在到期日前没有更多交易日时，取最后交易日结算
    database.prepare(
      "UPDATE trainings SET status = 'settled', settle_date = ?, early_settle = 0 WHERE id = ?",
    ).run(current, id)
    return { snapshot: trainingSnapshot(database, id), settled: true, bar: null }
  }
  let state = replayState(database, row)
  if (row.adjust_mode === 'forward') {
    const events = loadAdjustmentEvents(database, row.market as 'sh' | 'sz' | 'bj', row.code)
    state = applyPositionEvents(database, row, state, next.date, events)
  }
  database.prepare('UPDATE trainings SET current_date = ?, current_close = ? WHERE id = ?').run(next.date, next.close, id)
  database.prepare(`
    INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)
    ON CONFLICT(training_id, date) DO UPDATE SET equity = excluded.equity
  `).run(id, next.date, equityOf(state, next.close))
  return { snapshot: trainingSnapshot(database, id), settled: false, bar: { ...next } }
}

export interface TradeInput {
  side?: string
  shares?: number
  weightPct?: number
}

export async function tradeTraining(database: DatabaseSync, id: number, input: TradeInput): Promise<{ snapshot: TrainingSnapshot; plan: TradePlan }> {
  const row = loadTrainingRow(database, id)
  if (row.status !== 'running') throw new HttpError(409, '训练已结束，无法交易')
  if (input.side !== 'buy' && input.side !== 'sell') throw new HttpError(400, "side 必须是 'buy' 或 'sell'")
  const close = row.current_close
  if (close === null || close === undefined) throw new HttpError(500, '训练缺少当前收盘价')
  const fees = feeConfigOf(database)
  const state = replayState(database, row)
  const boughtToday = sharesBoughtOn(database, id, row.current_date ?? row.start_date)
  const available = t1Enabled(database) ? state.shares - boughtToday : state.shares

  const result = input.side === 'buy'
    ? planBuy(state, close, input.weightPct ?? 0, fees)
    : planSell(state, close, { shares: input.shares, weightPct: input.weightPct }, available, fees)
  if (!result.ok) throw new HttpError(400, result.error)
  const plan = result.plan

  const after = applyTrade(state, plan)
  const seqRow = database.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM trades WHERE training_id = ?',
  ).get(id) as unknown as { seq: number }
  database.prepare(`
    INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seqRow.seq, row.current_date ?? row.start_date, plan.side, plan.price, plan.shares, plan.amount, plan.fee, after.cash, after.shares, after.costTotal)
  database.prepare(`
    INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)
    ON CONFLICT(training_id, date) DO UPDATE SET equity = excluded.equity
  `).run(id, row.current_date ?? row.start_date, equityOf(after, close))
  return { snapshot: trainingSnapshot(database, id), plan }
}

export function settleTraining(database: DatabaseSync, id: number): TrainingMeta {
  const row = loadTrainingRow(database, id)
  if (row.status !== 'running') throw new HttpError(409, '训练已结束')
  database.prepare(
    "UPDATE trainings SET status = 'settled', settle_date = ?, early_settle = 1 WHERE id = ?",
  ).run(row.current_date ?? row.start_date, id)
  return toMeta(loadTrainingRow(database, id))
}

export function abandonTraining(database: DatabaseSync, id: number): TrainingMeta {
  const row = loadTrainingRow(database, id)
  if (row.status !== 'running') throw new HttpError(409, '训练已结束')
  database.prepare("UPDATE trainings SET status = 'abandoned', settle_date = ? WHERE id = ?").run(
    row.current_date ?? row.start_date, id,
  )
  return toMeta(loadTrainingRow(database, id))
}

export function equityCurveOf(database: DatabaseSync, id: number): Array<{ date: string; equity: number }> {
  return database.prepare(
    'SELECT date, equity FROM equity_curve WHERE training_id = ? ORDER BY date',
  ).all(id) as unknown as Array<{ date: string; equity: number }>
}


