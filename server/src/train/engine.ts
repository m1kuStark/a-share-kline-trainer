import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import { isDayDate, type DayBar } from '../tdx/dayfile.js'
// loadAdjustmentEvents 仅剩两处同步调用（replayState 旧流水兼容、buildChartSpace 画线基准），
// 读的是 adj_factors 持久缓存（同步 API 无法经 async 读取器）；缓存由读取器 ensureCaches 保障新鲜。
import { loadAdjustmentEvents } from '../tdx/adjustment-cache.js'
import { applyForwardAdjustment, buildForwardAdjustmentSegments, type AdjustmentEvent } from '../tdx/gbbq.js'
import { aggregateBars, type KlineBar, type Timeframe } from '../tdx/kline.js'
import { parseTdxSymbol } from '../tdx/symbol.js'
import type { TdxMarket } from '../tdx/stocks.js'
import { MarketReaderUnavailableError, resolveMarketReader, type MarketDataReader } from '../data/reader.js'
import { planTrainingRange, type TrainingRangeRequest, type TrainingRangeResult } from './range.js'
import {
  applyTrade, dilutedCostPrice, equityOf, initialAccountState, planBuy, planSell,
  type AccountState, type FeeConfig, type TradePlan,
} from './account.js'
import { observedDefaultRules, parseTrainingRules, serializeTrainingRules, type TrainingRulesV1 } from './rules.js'
import { readCreationDefaultsFields, type CreationDefaults } from '../settings/creation-defaults.js'

export type Tier = '1M' | '3M' | '6M' | '1Y' | '2Y'
/** 范围模式训练在 tier 列中的哨兵值：绝不伪装成五档周期（TRAIN-02）。 */
export const RANGE_TIER_SENTINEL = 'RANGE'
export type TrainingStatus = 'running' | 'settled' | 'abandoned'

export const TIERS: Tier[] = ['1M', '3M', '6M', '1Y', '2Y']
export const TIER_MONTHS: Record<Tier, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 }
export const VISIBLE_BARS = 840
export const MA_WARMUP_BARS = 200
// 服务端发放的 K 线上限：可见 840 根 + 左侧 MA 暖机余量；任何情况下不含推进日之后的数据。
export const TRAINING_LOAD_BARS = VISIBLE_BARS + MA_WARMUP_BARS

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
  }
}

interface TrainingRow {
  id: number
  tier: string
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
  range_version: number | null
  range_mode: string | null
  requested_start: string | null
  requested_end: string | null
  range_start: string | null
  range_end: string | null
  range_bar_count: number | null
  range_source_fingerprint: string | null
  range_notes: string | null
  rules_json: string | null
}

/** 训练查询响应的可选 range 对象：version/mode/requested/actual/指纹与notes（TRAIN-02 冻结合同）。 */
export interface TrainingRangeMeta {
  version: number
  mode: 'preset' | 'latest' | 'bars'
  requestedStart: string
  requestedEnd: string | null
  startDate: string
  endDate: string
  barCount: number
  sourceFingerprint: string
  notes: string[]
}

export interface TrainingMeta {
  id: number
  /** 旧五档周期；范围模式训练为 RANGE 哨兵，旧客户端不得把它解析成任何 tier。 */
  tier: Tier | typeof RANGE_TIER_SENTINEL
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
  /** 本局冻结的交易规则（TRAIN-01）；快照损坏时省略，交易/推进路径会显式报错 */
  rules?: TrainingRulesV1
  /** 仅范围模式训练存在；旧 tier 训练不返回该字段 */
  range?: TrainingRangeMeta
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

function parseRangeNotes(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((note): note is string => typeof note === 'string') : []
  } catch {
    return []
  }
}

function toMeta(row: TrainingRow): TrainingMeta {
  const masked = row.blind === 1 && row.status === 'running'
  const range = row.range_version === 1 && row.range_start && row.range_end
    ? {
        version: 1,
        mode: row.range_mode as TrainingRangeMeta['mode'],
        requestedStart: row.requested_start ?? row.range_start,
        requestedEnd: row.requested_end,
        startDate: row.range_start,
        endDate: row.range_end,
        barCount: row.range_bar_count ?? 0,
        sourceFingerprint: row.range_source_fingerprint ?? '',
        notes: parseRangeNotes(row.range_notes),
      } satisfies TrainingRangeMeta
    : undefined
  const rules = parseTrainingRules(row.rules_json) ?? undefined
  return {
    id: row.id,
    tier: row.tier as Tier | typeof RANGE_TIER_SENTINEL,
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
    ...(rules ? { rules } : {}),
    ...(range ? { range } : {}),
  }
}

function loadTrainingRow(database: DatabaseSync, id: number): TrainingRow {
  const row = database.prepare('SELECT * FROM trainings WHERE id = ?').get(id) as unknown as TrainingRow | undefined
  if (!row) throw new HttpError(404, `训练 ${id} 不存在`)
  return row
}

/** 严格读取本局规则快照：缺失/损坏/版本不支持时明确报错，绝不静默回退当前全局设置。 */
export function trainingRulesOf(row: Pick<TrainingRow, 'rules_json'>): TrainingRulesV1 {
  const rules = parseTrainingRules(row.rules_json)
  if (!rules) {
    throw new HttpError(409, '训练规则快照缺失、损坏或版本不支持，无法安全执行；请恢复程序或数据后再试', 'TRAIN_RULES_UNREADABLE')
  }
  return rules
}

/** legacy raw 训练历史权息缺失：禁止新增交易/推进/结算（查看、导出、放弃不受限）。 */
function assertTradablePolicy(rules: TrainingRulesV1): void {
  if (rules.corporateActionPolicy === 'legacy-raw-unverified') {
    throw new HttpError(409, '旧版不复权训练缺少完整权息记录，请保留记录后新建训练', 'LEGACY_RAW_ACCOUNTING_UNVERIFIED')
  }
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

// ===== DATA-04 统一行情读取入口 =====
// 训练/结算的 bars/actions/coverage/version 读取一律经 MarketDataReader（server/src/data/reader.ts），
// 不再直读 TDX 文件路径。来源解析与刷新扫描同口径：config.tdxRoot 非空→TDX；否则注册的
// 替代读取器（测试夹具/未来在线来源）；均不可用→保持既有 503 状态码合约。
async function marketReader(database: DatabaseSync, config: AppConfig): Promise<MarketDataReader> {
  try {
    return await resolveMarketReader(database, config)
  } catch (error) {
    if (error instanceof MarketReaderUnavailableError) throw new HttpError(503, error.message)
    throw error
  }
}

/** 兼容导出（旧调用点与测试使用）：等价于「解析读取器＋读取前缓存保障」。 */
export async function ensureAdjustmentCache(database: DatabaseSync, config: AppConfig): Promise<void> {
  await (await marketReader(database, config)).ensureCaches()
}

export interface CreateTrainingInput {
  tier?: string
  code?: string
  start_date?: string
  initial_cash?: number
  blind?: boolean
  adjust_mode?: string
  /** 新范围模式请求（TRAIN-02）；与 tier 互斥，必须携带已复核的 previewId */
  range?: unknown
  previewId?: string
  /** 测试注入时钟；缺省取当前时间 */
  now?: Date
  /** 测试注入：提交事务前的等待点（生产不传）。默认设置在提交边界读取，等待期间更新的
   * 默认必须进入最终快照，此接缝用于真实验证该顺序。 */
  beforeCommit?: () => Promise<void>
}

export async function createTraining(database: DatabaseSync, config: AppConfig, input: CreateTrainingInput): Promise<TrainingMeta> {
  if (input.range !== undefined || input.previewId !== undefined) {
    return createRangeTraining(database, config, input)
  }
  if (!TIERS.includes(input.tier as Tier)) {
    throw new HttpError(400, `训练周期必须是 ${TIERS.join(' / ')} 之一`)
  }
  if (!input.code || !input.start_date) {
    throw new HttpError(400, 'code 与 start_date 必填')
  }
  const startDate = input.start_date
  const tier = input.tier as Tier
  // M5-DEFAULTS：缺省仅指 undefined/未给；显式 null/错误类型是非法输入 400，不视为省略。
  // 省略字段在创建提交事务边界解析持久默认（损坏默认 409 TRAINING_DEFAULTS_UNREADABLE）。
  let adjustMode: 'forward' | 'raw' | null = null
  if (input.adjust_mode !== undefined) {
    if (input.adjust_mode !== 'forward' && input.adjust_mode !== 'raw') {
      throw new HttpError(400, '复权方式必须是 forward 或 raw')
    }
    adjustMode = input.adjust_mode
  }
  let initialCash: number | null = null
  if (input.initial_cash !== undefined) {
    if (typeof input.initial_cash !== 'number' || !Number.isFinite(input.initial_cash) || input.initial_cash <= 0) {
      throw new HttpError(400, '初始资金必须是正数')
    }
    initialCash = input.initial_cash
  }
  if (!isDayDate(input.start_date)) {
    throw new HttpError(400, '起始日必须是有效的 YYYY-MM-DD 日期')
  }

  // DATA-04：经统一读取入口解析来源并读取目录/日线，不直读 TDX 路径
  const reader = await marketReader(database, config)
  await reader.ensureCaches()
  const stocks = await reader.readCatalog()
  const parsed = parseTdxSymbol(input.code)
  const stock = stocks.find(item => item.market === parsed.market && item.code === parsed.code)
  if (!stock) throw new HttpError(400, `代码 ${parsed.code} 不在 A 股目录中`)

  const bars = await reader.readBars(parsed.market, parsed.code)
  const startBar = [...bars].reverse().find(bar => bar.date <= startDate)
  if (!startBar) throw new HttpError(400, `起始日 ${startDate} 早于该股票的上市日`)

  const createdAt = new Date().toISOString()
  // 末根 K 线在前复权序列中恒等于原始收盘价，因此 current_close 直接存原始收盘，
  // 快照/交易无需再读文件，也杜绝把未来权息混进当前价格。
  await input.beforeCommit?.()
  const id = commitTrainingCreation(database, {
    tier, code: parsed.code, name: stock.name, market: parsed.market,
    startDate: startBar.date, plannedEnd: addMonths(startBar.date, TIER_MONTHS[tier]),
    blind: input.blind ? 1 : 0, adjustMode, initialCash, createdAt,
    currentDate: startBar.date, currentClose: startBar.close, range: null,
  })
  return toMeta(loadTrainingRow(database, id))
}

interface TrainingCreationRow {
  tier: string
  code: string
  name: string
  market: string
  startDate: string
  plannedEnd: string
  blind: number
  /** null＝创建时省略，在提交事务边界解析持久默认（损坏默认 409） */
  adjustMode: 'forward' | 'raw' | null
  /** null＝创建时省略，在提交事务边界解析持久默认（损坏默认 409） */
  initialCash: number | null
  /** 仅 RANGE：预览时固化的有效复权；提交省略复权时若提交边界默认与其不一致须 409 零写 */
  previewAdjustMode?: 'forward' | 'raw'
  createdAt: string
  currentDate: string
  currentClose: number
  /** null＝旧tier路径；非null＝TRAIN-02范围模式，冻结复核后的元数据 */
  range: {
    mode: string
    requestedStart: string
    requestedEnd: string | null
    barCount: number
    fingerprint: string
    notes: string[]
  } | null
}

// 并发与原子性边界（GPT-WAKE-02）：所有异步读取都已完成，从这里到 COMMIT 是同步段。
// BEGIN IMMEDIATE 先取写锁，同步重查"单活动训练"后再落库；训练行与初始权益同事务，
// 任一失败整体回滚，不留孤儿训练行。旧tier与范围模式路径共用。
// TRAIN-01：规则默认在提交事务边界内读取（不用 await 前缓存的旧值），与训练行、
// 初始权益同事务共提交，失败全回滚。
function commitTrainingCreation(database: DatabaseSync, row: TrainingCreationRow): number {
  database.exec('BEGIN IMMEDIATE')
  try {
    const active = database.prepare("SELECT id FROM trainings WHERE status = 'running'").get()
    if (active) throw new HttpError(409, '已有进行中的训练，请先结算或放弃')
    // M5-DEFAULTS＋返修 F1：省略的资金/复权在 BEGIN IMMEDIATE 提交事务边界按实际依赖字段
    // 解析持久默认（只实际依赖的损坏字段才 409 TRAINING_DEFAULTS_UNREADABLE 零写，无关字段
    // 的损坏不扩散）；显式值不依赖任何默认。
    let adjustMode = row.adjustMode
    let initialCash = row.initialCash
    if (adjustMode === null || initialCash === null) {
      const fields = readCreationDefaultsFields(database)
      const corruptKeys: string[] = []
      if (adjustMode === null) {
        if (fields.mode.state === 'corrupt') corruptKeys.push('training_adjust_mode')
        else adjustMode = fields.mode.state === 'ok' ? fields.mode.value : 'forward'
      }
      if (initialCash === null) {
        if (fields.cash.state === 'corrupt') corruptKeys.push('training_initial_cash')
        else initialCash = fields.cash.state === 'ok' ? fields.cash.value : 1_000_000
      }
      if (corruptKeys.length > 0) {
        throw new HttpError(
          409,
          `训练默认设置损坏（${corruptKeys.join('、')} 无法读取）：请在设置中核对表单并重新保存即可修复，或创建时显式填写资金与复权`,
          'TRAINING_DEFAULTS_UNREADABLE',
        )
      }
    }
    // RANGE 提交省略复权时：提交边界最新默认若与预览固化复权不一致，409 零写要求重新预览
    if (row.previewAdjustMode !== undefined && row.previewAdjustMode !== adjustMode) {
      throw new HttpError(409, '预览后默认复权已变化，提交未带复权须与预览一致；请重新预览', 'RANGE_PREVIEW_STALE')
    }
    const rules = observedDefaultRules(database, row.createdAt)
    const rulesJson = serializeTrainingRules(rules)
    const result = row.range === null
      ? database.prepare(`
          INSERT INTO trainings (
            tier, code, name, market, start_date, planned_end, status, blind,
            adjust_mode, initial_cash, created_at, current_date, current_close, rules_json
          ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.tier, row.code, row.name, row.market, row.startDate, row.plannedEnd,
          row.blind, adjustMode, initialCash, row.createdAt, row.currentDate, row.currentClose, rulesJson,
        )
      : database.prepare(`
          INSERT INTO trainings (
            tier, code, name, market, start_date, planned_end, status, blind,
            adjust_mode, initial_cash, created_at, current_date, current_close,
            range_version, range_mode, requested_start, requested_end, range_start, range_end,
            range_bar_count, range_source_fingerprint, range_notes, rules_json
          ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.tier, row.code, row.name, row.market, row.startDate, row.plannedEnd,
          row.blind, adjustMode, initialCash, row.createdAt, row.currentDate, row.currentClose,
          row.range.mode, row.range.requestedStart, row.range.requestedEnd,
          row.startDate, row.plannedEnd, row.range.barCount, row.range.fingerprint, JSON.stringify(row.range.notes),
          rulesJson,
        )
    const id = Number(result.lastInsertRowid)
    database.prepare(
      'INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)',
    ).run(id, row.startDate, initialCash)
    database.exec('COMMIT')
    return id
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

// ===== TRAIN-02：训练范围预览与创建复核 =====
// 预览只返回日期元信息（请求/实际起止、根数、模式、notes），不返回任何OHLC、收益或账户结果。
// 元信息与 sourceFingerprint 必须派生自同一次文件字节快照：readFile 一次后解析、剔除未完整日线、
// 再计算指纹与计划；禁止分别读文件后声称一致。today 取 Asia/Shanghai 当前完整数据日期
// （当日 15:00 前视为未完整，回退到前一日），knownClosedDates 本片无日历来源，尾段缺口保守失败。

export const RANGE_PREVIEW_TTL_MS = 10 * 60_000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const MARKET_CLOSE_MINUTES = 15 * 60

export interface RangePreview {
  version: 1
  previewId: string
  code: string
  market: string
  request: TrainingRangeRequest
  requestedStart: string
  requestedEnd: string | null
  startDate: string
  endDate: string
  barCount: number
  notes: string[]
  sourceFingerprint: string
  expiresAt: string
  /** 预览固化的有效复权：未显式给 adjustMode 时取当时的持久默认，提交须与此一致 */
  adjustMode: 'forward' | 'raw'
}

export interface PreviewTrainingRangeInput {
  code?: string
  market?: string
  range?: unknown
  adjustMode?: string
  /** 测试注入时钟；缺省取当前时间 */
  now?: Date
}

interface PlannedRange {
  requestedStart: string
  requestedEnd: string | null
  startDate: string
  endDate: string
  barCount: number
  notes: string[]
}

interface RangeSnapshot {
  market: TdxMarket
  code: string
  bars: DayBar[]
  fingerprint: string
}

interface StoredRangePreview {
  code: string
  market: TdxMarket
  request: TrainingRangeRequest
  adjustMode: 'forward' | 'raw'
  fingerprint: string
  planned: PlannedRange
  expiresAtMs: number
}

const rangePreviews = new Map<string, StoredRangePreview>()

function shanghaiCompleteDataDate(now: Date): string {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  if (shifted.getUTCHours() * 60 + shifted.getUTCMinutes() < MARKET_CLOSE_MINUTES) {
    shifted.setTime(shifted.getTime() - 86_400_000)
  }
  return shifted.toISOString().slice(0, 10)
}

// 只取已知字段做规范化：多余字段不参与匹配与回显，取值合法性由规划器校验。
function normalizeRangeRequest(raw: unknown): TrainingRangeRequest | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  switch (candidate.mode) {
    case 'preset': {
      const request: TrainingRangeRequest = {
        mode: 'preset',
        startDate: candidate.startDate as string,
        months: candidate.months as 1 | 3 | 6 | 12 | 24,
      }
      if (candidate.endDate !== undefined) return { ...request, endDate: candidate.endDate as string }
      return request
    }
    case 'latest':
      return { mode: 'latest', startDate: candidate.startDate as string }
    case 'bars':
      return { mode: 'bars', startDate: candidate.startDate as string, count: candidate.count as number }
    default:
      return null
  }
}

function plannedRangeOf(plan: Extract<TrainingRangeResult, { ok: true }>): PlannedRange {
  return {
    requestedStart: plan.requestedStart,
    requestedEnd: plan.requestedEnd,
    startDate: plan.startDate,
    endDate: plan.endDate,
    barCount: plan.barCount,
    notes: [...plan.notes],
  }
}

function plannedRangeKey(plan: PlannedRange): string {
  return JSON.stringify([plan.requestedStart, plan.requestedEnd, plan.startDate, plan.endDate, plan.barCount, plan.notes])
}

function rangeFailure(result: Extract<TrainingRangeResult, { ok: false }>): HttpError {
  const statusCode = result.code === 'INVALID_INPUT' ? 400 : result.code === 'NO_DATA' ? 404 : 409
  return new HttpError(statusCode, result.message, result.code)
}

function stalePreview(message: string): HttpError {
  return new HttpError(409, `${message}；请重新预览`, 'RANGE_PREVIEW_STALE')
}

// 权息基准与完整日线一起进入指纹：未来权息变化会改变历史前复权价格，预览必须随之失效。
function rangeFingerprint(
  market: string,
  code: string,
  bars: DayBar[],
  events: Array<{ date: string; dividend: number; rightsPrice: number; bonusShares: number; rightsShares: number }>,
): string {
  const hash = createHash('sha256')
  hash.update(`v1|${market}${code}|${bars.length}|`)
  for (const bar of bars) {
    hash.update(`${bar.date}|${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.amount}|${bar.volume};`)
  }
  hash.update('|adj|')
  for (const event of events) {
    hash.update(`${event.date}|${event.dividend}|${event.rightsPrice}|${event.bonusShares}|${event.rightsShares};`)
  }
  return hash.digest('hex')
}

async function readRangeSnapshot(database: DatabaseSync, config: AppConfig, market: TdxMarket, code: string, now: Date): Promise<RangeSnapshot> {
  // DATA-04：经统一读取入口读取；fresh 权息绕过持久缓存直接解码来源现势字节（GPT-WAKE-02）
  const reader = await marketReader(database, config)
  await reader.ensureCaches()
  let bars: DayBar[]
  try {
    bars = await reader.readBars(market, code)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, `TDX data not found for ${market}${code}`)
    throw error
  }
  let events: AdjustmentEvent[]
  try {
    events = await reader.readActions(market, code, { fresh: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'TDX data not found for gbbq')
    throw error
  }
  const cutoff = shanghaiCompleteDataDate(now)
  const visible = bars.filter(bar => bar.date <= cutoff)
  return { market, code, bars: visible, fingerprint: rangeFingerprint(market, code, visible, events) }
}

function parseRangeSymbol(value: string): { market: TdxMarket; code: string } {
  try {
    return parseTdxSymbol(value)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid symbol')
  }
}

export async function previewTrainingRange(database: DatabaseSync, config: AppConfig, input: PreviewTrainingRangeInput): Promise<{ preview: RangePreview }> {
  const now = input.now ?? new Date()
  // M5-DEFAULTS＋返修 F1：预览只依赖复权字段——未给复权时取当时持久默认的复权（该键损坏
  // 409 UNREADABLE；坏资金键不阻断预览），并作为有效复权固化进预览。
  let adjustMode: 'forward' | 'raw'
  if (input.adjustMode === undefined) {
    const fields = readCreationDefaultsFields(database)
    if (fields.mode.state === 'corrupt') {
      throw new HttpError(
        409,
        '训练默认设置损坏（training_adjust_mode 无法读取）：请在设置中核对表单并重新保存即可修复，或预览/创建时显式选择复权方式',
        'TRAINING_DEFAULTS_UNREADABLE',
      )
    }
    adjustMode = fields.mode.state === 'ok' ? fields.mode.value : 'forward'
  } else if (input.adjustMode !== 'forward' && input.adjustMode !== 'raw') {
    throw new HttpError(400, '复权方式必须是 forward 或 raw', 'INVALID_INPUT')
  } else {
    adjustMode = input.adjustMode
  }
  const request = normalizeRangeRequest(input.range)
  if (!request) throw new HttpError(400, 'range 必须是包含 mode（preset/latest/bars）与 startDate 的对象', 'INVALID_INPUT')
  if (!input.code) throw new HttpError(400, 'code 必填', 'INVALID_INPUT')
  if (input.market !== undefined && !['sh', 'sz', 'bj'].includes(input.market)) {
    throw new HttpError(400, 'market 必须是 sh / sz / bj 之一', 'INVALID_INPUT')
  }
  const parsed = parseRangeSymbol(input.market ? `${input.market}${input.code}` : input.code)
  const today = shanghaiCompleteDataDate(now)
  const snapshot = await readRangeSnapshot(database, config, parsed.market, parsed.code, now)
  const plan = planTrainingRange({ request, dates: snapshot.bars.map(bar => bar.date), today })
  if (!plan.ok) throw rangeFailure(plan)

  const previewId = randomUUID()
  const expiresAtMs = now.getTime() + RANGE_PREVIEW_TTL_MS
  const planned = plannedRangeOf(plan)
  rangePreviews.set(previewId, {
    code: parsed.code, market: parsed.market, request, adjustMode,
    fingerprint: snapshot.fingerprint, planned, expiresAtMs,
  })
  return {
    preview: {
      version: 1,
      previewId,
      code: parsed.code,
      market: parsed.market,
      request,
      ...planned,
      sourceFingerprint: snapshot.fingerprint,
      expiresAt: new Date(expiresAtMs).toISOString(),
      adjustMode,
    },
  }
}

async function createRangeTraining(database: DatabaseSync, config: AppConfig, input: CreateTrainingInput): Promise<TrainingMeta> {
  if (input.tier !== undefined) throw new HttpError(400, 'range 创建不能同时传 tier', 'INVALID_INPUT')
  const request = normalizeRangeRequest(input.range)
  if (!request) throw new HttpError(400, 'range 必须是包含 mode（preset/latest/bars）与 startDate 的对象', 'INVALID_INPUT')
  if (typeof input.previewId !== 'string' || input.previewId === '') {
    throw new HttpError(400, 'range 创建必须提供预览返回的 previewId')
  }
  if (!input.code) throw new HttpError(400, 'code 必填')
  // M5-DEFAULTS：缺省仅指 undefined/未给；显式 null/错误类型 400。
  // 省略复权时以预览固化的有效复权为基准，提交边界默认若与预览不一致由提交事务 409 RANGE_PREVIEW_STALE。
  let adjustMode: 'forward' | 'raw' | null = null
  if (input.adjust_mode !== undefined) {
    if (input.adjust_mode !== 'forward' && input.adjust_mode !== 'raw') {
      throw new HttpError(400, '复权方式必须是 forward 或 raw')
    }
    adjustMode = input.adjust_mode
  }
  let initialCash: number | null = null
  if (input.initial_cash !== undefined) {
    if (typeof input.initial_cash !== 'number' || !Number.isFinite(input.initial_cash) || input.initial_cash <= 0) {
      throw new HttpError(400, '初始资金必须是正数')
    }
    initialCash = input.initial_cash
  }

  const now = input.now ?? new Date()
  const stored = rangePreviews.get(input.previewId)
  if (!stored) throw stalePreview('预览不存在或已过期')
  if (now.getTime() > stored.expiresAtMs) {
    rangePreviews.delete(input.previewId)
    throw stalePreview('预览已过期')
  }
  if (JSON.stringify(request) !== JSON.stringify(stored.request)) throw stalePreview('创建请求与预览请求不一致')
  if (adjustMode !== null && adjustMode !== stored.adjustMode) throw stalePreview('复权方式与预览不一致')
  const parsed = parseRangeSymbol(input.code)
  if (parsed.code !== stored.code || parsed.market !== stored.market) throw stalePreview('预览与请求的股票不一致')

  // 创建时重新读取同一日线快照并复核预览版本：字节/请求/复权任一变化都要求重新预览。
  const snapshot = await readRangeSnapshot(database, config, stored.market, stored.code, now)
  if (snapshot.fingerprint !== stored.fingerprint) throw stalePreview('数据已变化（sourceFingerprint 不匹配）')
  const plan = planTrainingRange({
    request,
    dates: snapshot.bars.map(bar => bar.date),
    today: shanghaiCompleteDataDate(now),
  })
  if (!plan.ok) throw stalePreview(`创建复核未通过：${plan.message}`)
  if (plannedRangeKey(plannedRangeOf(plan)) !== plannedRangeKey(stored.planned)) throw stalePreview('复核结果与预览不一致')

  // DATA-04：目录确认同样经统一读取入口（替代来源自带目录，TDX 沿用目录刷新）
  const stocks = await (await marketReader(database, config)).readCatalog()
  const stock = stocks.find(item => item.market === parsed.market && item.code === parsed.code)
  if (!stock) throw new HttpError(400, `代码 ${parsed.code} 不在 A 股目录中`)
  const startBar = snapshot.bars.find(bar => bar.date === plan.startDate)
  if (!startBar) throw stalePreview(`复核起点 ${plan.startDate} 缺少对应日线`)

  await input.beforeCommit?.()
  const id = commitTrainingCreation(database, {
    tier: RANGE_TIER_SENTINEL, code: parsed.code, name: stock.name, market: parsed.market,
    startDate: plan.startDate, plannedEnd: plan.endDate,
    blind: input.blind ? 1 : 0, adjustMode, initialCash, createdAt: now.toISOString(),
    previewAdjustMode: stored.adjustMode,
    currentDate: plan.startDate, currentClose: startBar.close,
    range: {
      mode: plan.mode,
      requestedStart: plan.requestedStart,
      requestedEnd: plan.requestedEnd,
      barCount: plan.barCount,
      fingerprint: snapshot.fingerprint,
      notes: plan.notes,
    },
  })
  return toMeta(loadTrainingRow(database, id))
}

// 训练 K 线：先按推进日截断、再前复权（基准=推进日）、后聚合；任何情况下不含推进日之后的数据。
// 训练 K 线：先按推进日截断、再前复权（基准=推进日）、后聚合；任何情况下不含推进日之后的数据。
async function buildTrainingSeries(database: DatabaseSync, config: AppConfig, id: number, timeframe: Timeframe): Promise<KlineBar[]> {
  const row = loadTrainingRow(database, id)
  const reader = await marketReader(database, config)
  const daily = await reader.readBars(row.market as TdxMarket, row.code)
  const current = row.current_date ?? row.start_date
  const upto = daily.filter(bar => bar.date <= current)
  let adjusted = upto
  if (row.adjust_mode === 'forward') {
    await reader.ensureCaches()
    const events = await reader.readActions(row.market as TdxMarket, row.code)
    adjusted = applyForwardAdjustment(upto, events, current)
  }
  return aggregateBars(adjusted, timeframe)
}

export async function trainingBars(database: DatabaseSync, config: AppConfig, id: number, timeframe: Timeframe): Promise<KlineBar[]> {
  const series = await buildTrainingSeries(database, config, id, timeframe)
  return series.slice(-TRAINING_LOAD_BARS)
}

// 动态历史加载：840 限定的是同屏最大可见根数（缩放下限），不是加载总量。
// 用户把视窗移动到已加载窗口之前时，前端按 before 分批取更早的历史（严格早于 before 的最近 count 根，升序）。
export async function trainingBarsBefore(database: DatabaseSync, config: AppConfig, id: number, timeframe: Timeframe, before: string, count: number): Promise<{ bars: KlineBar[]; hasMore: boolean }> {
  const series = await buildTrainingSeries(database, config, id, timeframe)
  const earlier = series.filter(bar => bar.date < before)
  const bars = earlier.slice(-count)
  return { bars, hasMore: earlier.length > bars.length }
}

function replayState(database: DatabaseSync, row: TrainingRow): AccountState {
  const tradeRows = database.prepare(
    'SELECT seq, trade_date AS date, side, shares, amount, fee FROM trades WHERE training_id = ? ORDER BY seq',
  ).all(row.id) as unknown as Array<{ seq: number; date: string; side: 'buy' | 'sell'; shares: number; amount: number; fee: number }>
  const eventRows = database.prepare(
    'SELECT seq, date, shares_delta, cash_delta, cost_delta FROM position_events WHERE training_id = ? ORDER BY seq',
  ).all(row.id) as unknown as Array<{ seq: number; date: string; shares_delta: number; cash_delta: number; cost_delta: number | null }>
  const legacyAdjustments = new Map((eventRows.some(event => event.cost_delta === null)
    ? loadAdjustmentEvents(database, row.market as 'sh' | 'sz' | 'bj', row.code)
    : []).map(event => [event.date, event]))
  // 按日期归并成交与权息入账（同日先事件后成交；跨日事件只可能落在推进日，成交在事件之后）
  const merged: Array<{ date: string; seq: number; kind: 'trade' | 'event'; trade?: typeof tradeRows[number]; event?: typeof eventRows[number] }> = [
    ...tradeRows.map(trade => ({ date: trade.date, seq: trade.seq, kind: 'trade' as const, trade })),
    ...eventRows.map(event => ({ date: event.date, seq: event.seq, kind: 'event' as const, event })),
  ].sort((left, right) => left.date.localeCompare(right.date)
    || (left.kind === right.kind ? left.seq - right.seq : left.kind === 'event' ? -1 : 1))
  let state = initialAccountState(row.initial_cash)
  for (const item of merged) {
    if (item.kind === 'event' && item.event) {
      let costDelta = item.event.cost_delta ?? 0
      const adjustment = item.event.cost_delta === null ? legacyAdjustments.get(item.date) : undefined
      if (adjustment && state.shares > 0 && adjustment.rightsShares > 0) {
        // Legacy rows record only net cash. Restore a subscription only when both
        // share and cash movements match the factor, without rewriting old rows.
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
        shares: state.shares + item.event.shares_delta,
        costTotal: state.costTotal + costDelta,
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
  const rules = trainingRulesOf(row)
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
      availableShares: rules.tPlusOne ? state.shares - boughtToday : state.shares,
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

// 历史 B/S 标记换算到推进日的前复权基准；当前持仓成本由含权息入账的账户重放取得。
// 前复权末日价格等于原始价，当前成本无需复权；用历史复权买价重放会丢失送转股数。
// raw 或无有效权息时保持原有回退合同（chartPrice 为空、成本线用账户原值）。
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
  const state = replayState(database, row)
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
    let costDelta = 0
    const rightsShares = (event.rightsShares / 10) * sharesBefore
    const rightsCost = event.rightsPrice * rightsShares
    if (rightsShares > 0 && result.cash + cashDelta >= rightsCost) {
      cashDelta -= rightsCost
      sharesDelta += rightsShares
      costDelta = rightsCost
    }
    if (sharesDelta === 0 && cashDelta === 0) continue
    const seqRow = database.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM position_events WHERE training_id = ?',
    ).get(row.id) as unknown as { seq: number }
    database.prepare(`
      INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta, cost_delta)
      VALUES (?, ?, ?, 'corporate_action', ?, ?, ?)
    `).run(row.id, seqRow.seq, date, sharesDelta, cashDelta, costDelta)
    result = {
      cash: result.cash + cashDelta,
      shares: result.shares + sharesDelta,
      costTotal: result.costTotal + costDelta,
    }
  }
  return result
}

// 判断 (from, to] 是否全部落在周六/周日：A 股周末从不交易，缺口若只含周末，
// 说明本地数据实际已完整覆盖到 to，缺线确属非交易日（不做节假日猜测，保守）。
function isWeekendBridge(from: string, to: string): boolean {
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (cursor.getTime() > end.getTime()) break
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) return false
  }
  return true
}

export interface AdvanceOptions {
  /** 测试注入：捕获开始观测（status/current_date）后的等待点（生产不传），用于真实验证
   * "async 行情读取之后进入短事务重查状态/日期"的顺序。 */
  afterObserve?: () => Promise<void>
}

export async function advanceTraining(
  database: DatabaseSync,
  config: AppConfig,
  id: number,
  options: AdvanceOptions = {},
): Promise<{ snapshot: TrainingSnapshot; settled: boolean; bar: KlineBar | null }> {
  const row = loadTrainingRow(database, id)
  if (row.status !== 'running') throw new HttpError(409, '训练已结束，无法推进')
  // DATA-04：日线与权息经统一读取入口（替代来源注册后，训练不再要求 TDX 目录存在）
  const reader = await marketReader(database, config)
  // 规则只读本局快照；legacy raw 历史权息缺失禁止推进（零副作用先决）。
  const rules = trainingRulesOf(row)
  assertTradablePolicy(rules)
  const observation = { status: row.status, currentDate: row.current_date ?? row.start_date }
  await options.afterObserve?.()
  const daily = await reader.readBars(row.market as TdxMarket, row.code)
  const current = observation.currentDate
  const next = daily.find(bar => bar.date > current && bar.date <= row.planned_end)
  // 权息缓存刷新是 async 只读扫描：留在短事务之外，事务内只做同步入账与提交。
  if (rules.corporateActionPolicy === 'cash-shares-v1') {
    await reader.ensureCaches()
  }
  // 短 BEGIN IMMEDIATE 同步段：重读训练 status/current_date，与请求开始观测值比对；
  // 期间已推进/结束则 409 零写回滚，不能重复对同一天入账。事务内重新重放最新账户，
  // 不使用 await 前的过时余额；权息流水、推进日/close、权益点一起提交或回滚。
  database.exec('BEGIN IMMEDIATE')
  let outcome: { settled: boolean; bar: KlineBar | null }
  try {
    const fresh = loadTrainingRow(database, id)
    if (fresh.status !== 'running' || (fresh.current_date ?? fresh.start_date) !== observation.currentDate) {
      throw new HttpError(409, '训练状态已变化（可能已在其他操作中推进或结束），请刷新后重试', 'TRAIN_STATE_CHANGED')
    }
    if (!next) {
      // 个股覆盖证明：找不到下一根时，只有两种可证明的完整覆盖允许自然到期——
      // 1) 推进日已到计划结束（待覆盖区间为空）；2) 剩余日期全部是周六/周日（A 股周末从无日线，
      //    isWeekendBridge 逐日核对）。他股或全市场数据尾、结束日之后的零星记录都排除不了
      //    区间内停牌与数据缺口并存的可能，一律保守等待：保持 running，更新数据后可继续或提前结算。
      // 防未来说明：判定只使用日期元信息与日历，不读取推进日之后的任何价格数据。
      if (current < row.planned_end && !isWeekendBridge(current, row.planned_end)) {
        const tail = daily.at(-1)?.date ?? null
        const detail = tail !== null && tail > row.planned_end
          ? `个股日线在 ${current} 之后、计划结束 ${row.planned_end} 之前无记录，但 ${tail} 起又有数据，无法区分长期停牌与区间数据缺口`
          : `个股日线止于 ${tail ?? '未知'}，尚未确认覆盖至计划结束 ${row.planned_end}，其间可能为节假日、停牌或数据缺口`
        throw new HttpError(409, `等待日线数据：${detail}；更新数据后可继续推进，也可提前结算`)
      }
      // 到期结算：个股在到期日前没有更多可证明的交易日时，取最后推进日结算
      database.prepare(
        "UPDATE trainings SET status = 'settled', settle_date = ?, early_settle = 0 WHERE id = ?",
      ).run(current, id)
      outcome = { settled: true, bar: null }
    } else {
      let state = replayState(database, fresh)
      if (rules.corporateActionPolicy === 'cash-shares-v1') {
        // 权息入账按规则口径（cash-shares-v1）执行，raw/forward 新训练同权同责：
        // 显示复权方式不改变真实现金/持股/成本。
        const events = await reader.readActions(row.market as TdxMarket, row.code)
        state = applyPositionEvents(database, fresh, state, next.date, events)
      }
      database.prepare('UPDATE trainings SET current_date = ?, current_close = ? WHERE id = ?').run(next.date, next.close, id)
      database.prepare(`
        INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)
        ON CONFLICT(training_id, date) DO UPDATE SET equity = excluded.equity
      `).run(id, next.date, equityOf(state, next.close))
      outcome = { settled: false, bar: { ...next } }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  // 快照在提交之后读取（读事务与写事务分离，规则已校验有效）
  return { snapshot: trainingSnapshot(database, id), ...outcome }
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
  // 费用/T+1/费率/手数只读本局冻结快照（返修 F1：被认可的数值供实际计算），不读全局 settings 或常量
  const rules = trainingRulesOf(row)
  assertTradablePolicy(rules)
  const fees: FeeConfig = {
    enabled: rules.feesEnabled,
    commissionRate: rules.commissionRate,
    minimumCommission: rules.minimumCommission,
    stampDutyRate: rules.stampDutyRate,
    lotSize: rules.lotSize,
  }
  const state = replayState(database, row)
  const boughtToday = sharesBoughtOn(database, id, row.current_date ?? row.start_date)
  const available = rules.tPlusOne ? state.shares - boughtToday : state.shares

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
  // legacy raw 训练成绩未经验证：不允许用结算给出一份数据不完整的"成绩单"
  assertTradablePolicy(trainingRulesOf(row))
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
