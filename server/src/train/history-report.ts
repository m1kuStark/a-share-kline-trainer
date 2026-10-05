import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from './engine.js'
import { parseTrainingRules, type TrainingRulesV1 } from './rules.js'
import type { Drawing } from '../drawings.js'

// M4-HISTORY-01：结算历史列表与只读事实成绩单。
// 纯同步只读查询：只读 trainings/trades/equity_curve/drawings 持久事实，
// 不读行情 bars、不做 TDX 扫描、不做 adj_factors 重放、不按今日规则重算已结束训练。
// 调用方（api.ts）必须先 assertNoActiveTraining 且与其后读取保持在同一同步调用内
// （本模块全部函数为同步，无 await 间隙），保证"检查与查询"之间不插入异步窗口。

export type HistoryIntegrity = 'ok' | 'unavailable'
/** 结算方式（不认证历史数据完整性）：complete=到期结算，early-settled=提前结算。 */
export type HistoryClassification = 'complete' | 'early-settled'
/** RANGE 训练如实标注 preset/latest/bars；旧五档周期训练为 tier，绝不并入五档。 */
export type HistoryRangeMode = 'tier' | 'preset' | 'latest' | 'bars' | 'random'

export const HISTORY_LIST_DEFAULT_LIMIT = 20

export interface HistoryListQuery { limit: number; offset: number }

export interface HistoryItem {
  id: number
  code: string
  name: string
  tier: string
  rangeMode: HistoryRangeMode
  classification: HistoryClassification
  startDate: string
  settleDate: string | null
  initialCash: number
  finalEquity: number | null
  returnRate: number | null
  tradeCount: number
  integrity: HistoryIntegrity
  /** integrity=unavailable 时的中文原因 */
  integrityReason?: string
}

export interface HistoryListResult { total: number; limit: number; offset: number; items: HistoryItem[] }

export interface SettledFact {
  finalEquity: number | null
  returnRate: number | null
  integrity: HistoryIntegrity
  integrityReason?: string
}

/** 分页参数：limit 默认 20（正整数 1..100）、offset 默认 0（非负整数）；非法一律 400。 */
export function parseHistoryListQuery(raw: unknown): HistoryListQuery {
  const query = (raw ?? {}) as { limit?: unknown; offset?: unknown }
  const limit = query.limit === undefined ? HISTORY_LIST_DEFAULT_LIMIT : Number(query.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'limit 必须是 1~100 的整数')
  }
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new HttpError(400, 'offset 必须是非负整数')
  }
  return { limit, offset }
}

/** HISTORY-no-future 守卫：存在任何 running 训练时拒绝返回历史内容（直接 ID 访问同守卫）。 */
export function assertNoActiveTraining(database: DatabaseSync): void {
  const active = database.prepare(
    "SELECT id FROM trainings WHERE status = 'running' ORDER BY id DESC LIMIT 1",
  ).get()
  if (active) {
    throw new HttpError(409, '当前有进行中的训练，结束当前训练后可查看历史', 'HISTORY_ACTIVE_TRAINING')
  }
}

/**
 * 结算事实（冻结手算口径）：finalEquity 只认结算日持久权益点，绝不从末笔 cash_after、
 * 最新价格或今日规则重算；结算点缺失/非有限、settle_date 缺失、initialCash 非正有限
 * 一律 unavailable，不以 0/前一日代补。一行损坏只影响该行。
 */
export function settledFact(initialCash: unknown, settleDate: unknown, settlePoint: unknown): SettledFact {
  if (typeof settleDate !== 'string' || settleDate === '') {
    return { finalEquity: null, returnRate: null, integrity: 'unavailable', integrityReason: '结算日缺失，无法确定结算权益点' }
  }
  if (typeof initialCash !== 'number' || !Number.isFinite(initialCash) || initialCash <= 0) {
    return { finalEquity: null, returnRate: null, integrity: 'unavailable', integrityReason: '初始资金无效，无法计算收益率' }
  }
  if (typeof settlePoint !== 'number' || !Number.isFinite(settlePoint)) {
    return { finalEquity: null, returnRate: null, integrity: 'unavailable', integrityReason: '结算日权益点缺失或非有限，无法给出最终权益' }
  }
  return { finalEquity: settlePoint, returnRate: (settlePoint - initialCash) / initialCash, integrity: 'ok' }
}

interface HistoryRow {
  id: number
  tier: string
  code: string
  name: string
  start_date: string
  settle_date: string | null
  early_settle: number
  initial_cash: number
  range_version: number
  range_mode: string
  rules_json: string | null
}

const RANGE_MODES: readonly string[] = ['preset', 'latest', 'bars', 'random']

function rangeModeOf(row: Pick<HistoryRow, 'range_mode'>): HistoryRangeMode {
  return RANGE_MODES.includes(row.range_mode) ? row.range_mode as HistoryRangeMode : 'tier'
}

function classificationOf(row: Pick<HistoryRow, 'early_settle'>): HistoryClassification {
  return row.early_settle === 1 ? 'early-settled' : 'complete'
}

/** 规则层面的不可认证原因；可认证返回 null。 */
function rulesIntegrityReason(rulesJson: string | null): string | null {
  const rules = parseTrainingRules(rulesJson)
  if (!rules) return '训练规则快照缺失、损坏或版本不支持，无法认证本局成绩'
  if (rules.corporateActionPolicy === 'legacy-raw-unverified') {
    return '旧版不复权训练缺少完整权息记录，成绩未经验证'
  }
  return null
}

function settlePointOf(database: DatabaseSync, id: number, settleDate: string | null): { equity: number } | undefined {
  if (!settleDate) return undefined
  return database.prepare(
    'SELECT equity FROM equity_curve WHERE training_id = ? AND date = ?',
  ).get(id, settleDate) as { equity: number } | undefined
}

function historyItemOf(database: DatabaseSync, row: HistoryRow): HistoryItem {
  const base: HistoryItem = {
    id: row.id,
    code: row.code,
    name: row.name,
    tier: row.tier,
    rangeMode: rangeModeOf(row),
    classification: classificationOf(row),
    startDate: row.start_date,
    settleDate: row.settle_date,
    initialCash: row.initial_cash,
    // 无关行完整性：先占位，下面按规则→结算事实顺序覆盖
    finalEquity: null,
    returnRate: null,
    tradeCount: (database.prepare('SELECT COUNT(*) AS count FROM trades WHERE training_id = ?').get(row.id) as unknown as { count: number }).count,
    integrity: 'ok',
  }
  const rulesReason = rulesIntegrityReason(row.rules_json)
  if (rulesReason) {
    return { ...base, integrity: 'unavailable', integrityReason: rulesReason }
  }
  const fact = settledFact(row.initial_cash, row.settle_date, settlePointOf(database, row.id, row.settle_date)?.equity)
  return fact.integrity === 'ok'
    ? { ...base, finalEquity: fact.finalEquity, returnRate: fact.returnRate }
    : { ...base, integrity: 'unavailable', integrityReason: fact.integrityReason }
}

/** 历史列表：只返回 settled；settle_date DESC、id DESC 稳定排序（NULL 结算日排在最后）。 */
export function historyList(database: DatabaseSync, query: HistoryListQuery): HistoryListResult {
  const total = (database.prepare(
    "SELECT COUNT(*) AS total FROM trainings WHERE status = 'settled'",
  ).get() as unknown as { total: number }).total
  const rows = database.prepare(`
    SELECT id, tier, code, name, start_date, settle_date, early_settle, initial_cash,
           range_version, range_mode, rules_json
    FROM trainings WHERE status = 'settled'
    ORDER BY settle_date DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(query.limit, query.offset) as unknown as HistoryRow[]
  return { total, limit: query.limit, offset: query.offset, items: rows.map(row => historyItemOf(database, row)) }
}

export interface HistoryTrade {
  seq: number
  date: string
  side: 'buy' | 'sell'
  price: number
  shares: number
  amount: number
  fee: number
}

export interface HistoryReportTraining {
  id: number
  tier: string
  rangeMode: HistoryRangeMode
  code: string
  name: string
  market: string
  startDate: string
  plannedEnd: string
  settleDate: string
  classification: HistoryClassification
  adjustMode: 'forward' | 'raw'
  blind: boolean
  initialCash: number
  createdAt: string
  range?: {
    mode: 'preset' | 'latest' | 'bars' | 'random'
    requestedStart: string
    requestedEnd: string | null
    startDate: string
    endDate: string
    barCount: number
  }
}

export interface HistoryReportPayload {
  training: HistoryReportTraining
  /** 本局冻结规则（含 origin/capturedAt；legacy-migration 如实标注迁移观察来源） */
  rules: TrainingRulesV1
  finalEquity: number
  /** 比率（UI 层转百分比）；已含费用与权息，成交行费用仅为展示，不重复扣减 */
  returnRate: number
  tradeCount: number
  trades: HistoryTrade[]
  equityCurve: Array<{ date: string; equity: number }>
  /** drawingsStatus=unavailable 时为 null（画线损坏不得伪装成"未保存画线"） */
  drawings: Drawing[] | null
  drawingsStatus: 'ok' | 'unavailable'
  drawingsReason?: string
}

interface FullTrainingRow extends HistoryRow {
  name: string
  market: string
  planned_end: string
  status: 'running' | 'settled' | 'abandoned'
  blind: number
  adjust_mode: 'forward' | 'raw'
  created_at: string
  requested_start: string | null
  requested_end: string | null
  range_start: string | null
  range_end: string | null
  range_bar_count: number | null
}

interface TradeRow {
  seq: number
  trade_date: string
  side: 'buy' | 'sell'
  price: number
  shares: number
  amount: number
  fee: number
}

function loadSettledRow(database: DatabaseSync, id: number): FullTrainingRow {
  const row = database.prepare('SELECT * FROM trainings WHERE id = ?').get(id) as unknown as FullTrainingRow | undefined
  if (!row) throw new HttpError(404, `训练 ${id} 不存在`)
  return row
}

/**
 * 只读事实成绩单。错误契约：非法 ID 400（调用方）、无此 ID 404、未 settled 409
 * HISTORY_NOT_SETTLED、坏/缺规则 409 TRAIN_RULES_UNREADABLE、legacy-raw 409
 * LEGACY_RAW_ACCOUNTING_UNVERIFIED、结算权益缺失 409 HISTORY_EQUITY_UNAVAILABLE。
 * 曲线按 date 升序、成交按 seq 升序，均限定 start_date..settle_date，范围外不输出。
 */
export function historyReport(database: DatabaseSync, id: number): HistoryReportPayload {
  const row = loadSettledRow(database, id)
  if (row.status !== 'settled') {
    const reason = row.status === 'running' ? '训练仍在进行中，无历史成绩单' : '训练已放弃，无历史成绩单'
    throw new HttpError(409, reason, 'HISTORY_NOT_SETTLED')
  }
  const rules = parseTrainingRules(row.rules_json)
  if (!rules) {
    throw new HttpError(409, '训练规则快照缺失、损坏或版本不支持，无法生成历史成绩单', 'TRAIN_RULES_UNREADABLE')
  }
  if (rules.corporateActionPolicy === 'legacy-raw-unverified') {
    throw new HttpError(409, '旧版不复权训练缺少完整权息记录，历史成绩未经验证，不提供成绩单', 'LEGACY_RAW_ACCOUNTING_UNVERIFIED')
  }
  const fact = settledFact(row.initial_cash, row.settle_date, settlePointOf(database, row.id, row.settle_date)?.equity)
  if (fact.finalEquity === null || fact.returnRate === null) {
    throw new HttpError(409, `历史权益不可用：${fact.integrityReason ?? '结算权益缺失'}`, 'HISTORY_EQUITY_UNAVAILABLE')
  }
  const startDate = row.start_date
  const settleDate = row.settle_date as string
  const trades = (database.prepare(
    'SELECT seq, trade_date, side, price, shares, amount, fee FROM trades WHERE training_id = ? ORDER BY seq',
  ).all(row.id) as unknown as TradeRow[])
    .filter(trade => trade.trade_date >= startDate && trade.trade_date <= settleDate)
    .map(trade => ({
      seq: trade.seq,
      date: trade.trade_date,
      side: trade.side,
      price: trade.price,
      shares: trade.shares,
      amount: trade.amount,
      fee: trade.fee,
    }))
  const equityCurve = (database.prepare(
    'SELECT date, equity FROM equity_curve WHERE training_id = ? ORDER BY date',
  ).all(row.id) as unknown as Array<{ date: string; equity: number }>)
    .filter(point => point.date >= startDate && point.date <= settleDate)
  const range = row.range_version === 1 && row.range_start && row.range_end
    ? {
        mode: rangeModeOf(row) as 'preset' | 'latest' | 'bars' | 'random',
        requestedStart: row.requested_start ?? row.range_start,
        requestedEnd: row.requested_end,
        startDate: row.range_start,
        endDate: row.range_end,
        barCount: row.range_bar_count ?? 0,
      }
    : undefined
  return {
    training: {
      id: row.id,
      tier: row.tier,
      rangeMode: rangeModeOf(row),
      code: row.code,
      name: row.name,
      market: row.market,
      startDate,
      plannedEnd: row.planned_end,
      settleDate,
      classification: classificationOf(row),
      adjustMode: row.adjust_mode,
      blind: row.blind === 1,
      initialCash: row.initial_cash,
      createdAt: row.created_at,
      ...(range ? { range } : {}),
    },
    rules,
    finalEquity: fact.finalEquity,
    returnRate: fact.returnRate,
    tradeCount: trades.length,
    trades,
    equityCurve,
    ...readReportDrawings(database, row.id),
  }
}

function readReportDrawings(database: DatabaseSync, id: number): Pick<HistoryReportPayload, 'drawings' | 'drawingsStatus' | 'drawingsReason'> {
  const row = database.prepare('SELECT payload FROM drawings WHERE training_id = ?').get(id) as unknown as { payload: string } | undefined
  if (!row) return { drawings: [], drawingsStatus: 'ok' }
  try {
    const parsed: unknown = JSON.parse(row.payload)
    if (!Array.isArray(parsed)) throw new Error('drawings payload is not an array')
    return { drawings: parsed as Drawing[], drawingsStatus: 'ok' }
  } catch {
    return { drawings: null, drawingsStatus: 'unavailable', drawingsReason: '画线数据损坏，无法读取；其余账户事实不受影响' }
  }
}
