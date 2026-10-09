// M7-01 随机训练模式·服务端核心（docs/verification/2026-10/M7-01/design.md §2 为契约）。
// 三种维度：random_stock（用户起止日期＋服务器随机选股）/ random_time（用户股票＋服务器
// 随机时间窗）/ random_both（全随机）。随机决定全部经可注入 rng；股票池按
// 窗口需求（含 200 根指标预热）过滤，池空 422 RANDOM_STOCK_UNIVERSE_EMPTY、无可行起点
// 422 RANDOM_WINDOW_NOT_FIT。
//
// RF-04（2026-10-08）：random_time / random_both 时间维度复用经典训练周期口径——新增
// window_months 档位参数（值域＝经典 TIER_MONTHS 的 1/3/6/12/24），窗口＝「N 个自然月
// 日期跨度、起点随机、跨度完整落在数据内」，与经典 3M 档＝anchor−3M 同源（不换算固定
// 根数）；window_bars 旧口径（按 K 线根数随机）保留为「自定义根数」档，二参数互斥。
// 训练时长口径与经典一致（月跨度）；tier 列仍恒为 RANGE 哨兵（录制契约冻结：
// web/src/recording/validation.ts 旧五档不得携带 range 元数据）。
//
// 信息隐藏是 API 级真隐藏（网络面板可见即算泄漏）：隐藏股票→运行中会话一切响应无名称/代码；
// 隐藏时间→响应内全部市场日期经会话级随机常量偏移变换（纯日期/月键/长字符串内日期子串/
// drawings 时间戳），间距与缺口逐日保留，ISO 挂钟时间戳保持真实；请求侧（bars?before、
// 画线 timestamp）反向去偏移，库内恒真实空间。结算/放弃后隐藏停用，揭晓真实信息。
// 训练引擎撮合/推进/结算语义零改动：创建复用 commitTrainingCreation 提交边界，
// 遮蔽在 HTTP 出口层（onSend）实施，威胁模型不含拿偏移序列对全市场日历做缺口指纹暴力比对。
//
// RF-05（2026-10-08 用户验收反馈）：①运行中随机会话 random 对象携带 remainingBars
// （剩余未推进 K 线根数）——前端隐藏日期时以剩余根数替代日期呈现；②新增显式揭示端点
// POST /api/trainings/:id/reveal——确认弹窗后的用户主动动作，仅该端点返回真实
// code/name/日期区间，其余端点遮蔽不因揭示失效；结束态端点本就揭晓故 409 拒绝。
// 偏移机制保留（K 线轴标签可用性基础），隐藏边界＝呈现层（训练页头部不显示日期）。
//
// RF2-01（2026-10-09 用户报告补全）：random_stock 维度同样复用经典训练周期——
// 新增 window_months 档位载荷（值域同 TIER_MONTHS），窗口＝「最近 N 个自然月」，
// 锚点＝数据可用末日（目录 lastDate 最大值，与经典面板 anchorDate=sourceMaxDate 同源），
// 窗末＝起始交易日＋N 自然月（经典 plannedEnd 同式，恒 ≤ 锚点）；start_date/end_date
// 旧口径保留为「自定义范围」档，与 window_months 互斥 400；window_bars 对 random_stock
// 仍 400（随机股票无根数口径）。排行口径与 random_time 档位一致（range 键按精确起止）。

import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import { isDayDate, type DayBar } from '../tdx/dayfile.js'
import { parseTdxSymbol } from '../tdx/symbol.js'
import type { TdxMarket } from '../tdx/stocks.js'
import type { ReaderCatalogEntry } from '../data/reader.js'
import {
  HttpError, MA_WARMUP_BARS, RANGE_TIER_SENTINEL, TIER_MONTHS, addMonths, commitTrainingCreation, industrySnapshot, marketReader,
  rangeFingerprint, shanghaiCompleteDataDate, toMeta,
  type RandomDimension, type TrainingCreationRow, type TrainingMeta, type TrainingRow,
} from './engine.js'

export const RANDOM_DEFAULT_WINDOW_BARS = 250
export const RANDOM_OFFSET_MAX_DAYS = 3650

/** RF-04 档位口径：window_months 合法值域＝经典 TIER_MONTHS 的月数集合（1/3/6/12/24） */
const TIER_MONTH_VALUES: readonly number[] = Object.values(TIER_MONTHS)

const MS_PER_DAY = 86_400_000
const EXACT_DATE = /^\d{4}-\d{2}-\d{2}$/
const EXACT_MONTH = /^\d{4}-\d{2}$/
/** 长字符串内的日期子串；后随 T（ISO 时间戳）或数字的匹配跳过（挂钟字段保持真实） */
const DATE_SUBSTRING = /(\d{4})-(\d{2})-(\d{2})(?![\dT\d])/g

// ===== 纯日期平移（导出供测试独立验证；无效日期原样返回） =====

export function shiftDate(date: string, offsetDays: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) return date
  const shifted = new Date(ms + offsetDays * MS_PER_DAY)
  return shifted.toISOString().slice(0, 10)
}

export function shiftMonthKey(month: string, offsetDays: number): string {
  return shiftDate(`${month}-01`, offsetDays).slice(0, 7)
}

export function shiftTimestampMs(ms: number, offsetDays: number): number {
  return ms + offsetDays * MS_PER_DAY
}

export function shiftDateSubstrings(text: string, offsetDays: number): string {
  return text.replace(DATE_SUBSTRING, match => shiftDate(match, offsetDays))
}

/** 响应值层平移：纯日期/纯月键走精确分支，其余字符串做子串平移 */
function shiftStringValue(value: string, offsetDays: number): string {
  if (EXACT_DATE.test(value)) return shiftDate(value, offsetDays)
  if (EXACT_MONTH.test(value)) return shiftMonthKey(value, offsetDays)
  return shiftDateSubstrings(value, offsetDays)
}

// ===== 会话上下文（运行中的随机训练才有隐藏） =====

export interface RandomSession {
  trainingId: number
  dimension: RandomDimension
  hideStock: boolean
  hideTime: boolean
  offsetDays: number | null
  /** RF-05：剩余未推进 K 线根数（运行中随每次推进递减）；缺省＝未计算（randomSessionOf 填充） */
  remainingBars?: number | null
}

/** RF-05：剩余未推进根数＝range_bar_count−已推进交易日数（equity_curve 按 (training,date) 唯一入账） */
export function remainingBarsOf(database: DatabaseSync, id: number): number | null {
  const row = database.prepare(`
    SELECT t.range_bar_count AS total, COUNT(DISTINCT e.date) AS advanced
    FROM trainings t LEFT JOIN equity_curve e ON e.training_id = t.id
    WHERE t.id = ?
  `).get(id) as unknown as { total: number | null; advanced: number } | undefined
  if (!row || typeof row.total !== 'number' || !Number.isFinite(row.total)) return null
  return Math.max(0, row.total - row.advanced)
}

function sessionOfRow(row: { id: number | bigint; random_mode: string | null; random_time_offset_days: number | null }): RandomSession | null {
  const dimension = row.random_mode
  if (dimension !== 'random_stock' && dimension !== 'random_time' && dimension !== 'random_both') return null
  return {
    trainingId: Number(row.id),
    dimension,
    hideStock: dimension !== 'random_time',
    hideTime: dimension !== 'random_stock',
    offsetDays: typeof row.random_time_offset_days === 'number' ? row.random_time_offset_days : null,
  }
}

/** 指定训练是否为运行中的随机会话（隐藏适用）；其余一律 null（含已结束=揭晓态） */
export function randomSessionOf(database: DatabaseSync, id: number): RandomSession | null {
  if (!Number.isSafeInteger(id) || id < 1) return null
  const row = database.prepare(
    'SELECT id, random_mode, random_time_offset_days, status FROM trainings WHERE id = ?',
  ).get(id) as unknown as { id: number; random_mode: string | null; random_time_offset_days: number | null; status: string } | undefined
  if (!row || row.status !== 'running') return null
  const session = sessionOfRow(row)
  return session ? { ...session, remainingBars: remainingBarsOf(database, id) } : null
}

/** 当前活动训练若为运行中的随机会话则返回其上下文（/api/trainings/active 出口用） */
export function activeRandomSessionOf(database: DatabaseSync): RandomSession | null {
  const row = database.prepare(
    "SELECT id FROM trainings WHERE status = 'running' ORDER BY id DESC LIMIT 1",
  ).get() as unknown as { id: number } | undefined
  return row ? randomSessionOf(database, Number(row.id)) : null
}

// ===== 响应遮蔽（深度遍历） =====

/** TrainingMeta 形状签名：tier+code+name+status 同现（bars/成交等载荷里没有这种组合） */
function isTrainingMetaLike(record: Record<string, unknown>): boolean {
  return 'tier' in record && 'code' in record && 'name' in record && 'status' in record
}

export function transformRandomPayload(value: unknown, session: RandomSession): unknown {
  if (Array.isArray(value)) return value.map(item => transformRandomPayload(item, session))
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const masked: Record<string, unknown> = {}
  const shifting = session.hideTime && session.offsetDays !== null
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string' && shifting) {
      masked[key] = shiftStringValue(item, session.offsetDays as number)
    } else if (key === 'timestamp' && typeof item === 'number' && shifting) {
      masked[key] = shiftTimestampMs(item, session.offsetDays as number)
    } else {
      masked[key] = transformRandomPayload(item, session)
    }
  }
  if (isTrainingMetaLike(masked)) {
    if (session.hideStock) {
      masked.code = null
      masked.name = null
    }
    masked.random = {
      dimension: session.dimension, hideStock: session.hideStock, hideTime: session.hideTime,
      ...(session.remainingBars === null ? {} : { remainingBars: session.remainingBars }),
    }
  }
  return masked
}

/** 创建响应等模块内直用：把真实 meta 按会话隐藏规则变换后返回 */
function maskedMetaOf(database: DatabaseSync, row: TrainingRow): TrainingMeta {
  const session = sessionOfRow(row)
  if (!session) return toMeta(row)
  let meta = toMeta(row)
  if (session.hideTime && session.offsetDays !== null) {
    const offset = session.offsetDays
    meta = {
      ...meta,
      startDate: shiftStringValue(meta.startDate, offset),
      plannedEnd: shiftStringValue(meta.plannedEnd, offset),
      currentDate: meta.currentDate === null ? null : shiftStringValue(meta.currentDate, offset),
      settleDate: meta.settleDate === null ? null : shiftStringValue(meta.settleDate, offset),
      range: meta.range === undefined ? undefined : {
        ...meta.range,
        requestedStart: shiftStringValue(meta.range.requestedStart, offset),
        requestedEnd: meta.range.requestedEnd === null ? null : shiftStringValue(meta.range.requestedEnd, offset),
        startDate: shiftStringValue(meta.range.startDate, offset),
        endDate: shiftStringValue(meta.range.endDate, offset),
        notes: meta.range.notes.map(note => shiftDateSubstrings(note, offset)),
      },
    }
  }
  if (session.hideStock) meta = { ...meta, code: null, name: null }
  const remainingBars = remainingBarsOf(database, Number(row.id))
  return {
    ...meta,
    random: {
      dimension: session.dimension, hideStock: session.hideStock, hideTime: session.hideTime,
      ...(remainingBars === null ? {} : { remainingBars }),
    },
  }
}

// ===== 请求侧去偏移（客户端只能拿到偏移空间） =====

export function deshiftDateString(value: string, offsetDays: number): string {
  if (EXACT_DATE.test(value)) return shiftDate(value, -offsetDays)
  if (EXACT_MONTH.test(value)) return shiftMonthKey(value, -offsetDays)
  return value
}

/** 画线载荷 points[].timestamp 原地去偏移（库内恒真实空间；GET 侧对称正向偏移） */
export function deshiftDrawingsPayload(payload: unknown, offsetDays: number): void {
  if (!Array.isArray(payload)) return
  for (const drawing of payload) {
    if (!drawing || typeof drawing !== 'object') continue
    const points = (drawing as { points?: unknown }).points
    if (!Array.isArray(points)) continue
    for (const point of points) {
      if (!point || typeof point !== 'object') continue
      const record = point as { timestamp?: unknown }
      if (typeof record.timestamp === 'number') record.timestamp = record.timestamp - offsetDays * MS_PER_DAY
    }
  }
}

// ===== 创建 =====

export interface CreateRandomTrainingInput {
  dimension?: unknown
  start_date?: unknown
  end_date?: unknown
  code?: unknown
  window_bars?: unknown
  /** RF-04 档位口径月数（1/3/6/12/24）：窗口＝N 个自然月跨度、起点随机；与 window_bars 互斥 */
  window_months?: unknown
  initial_cash?: unknown
  adjust_mode?: unknown
  clock_mode?: unknown
  orders_enabled?: unknown
  blind?: unknown
  tier?: unknown
  range?: unknown
  previewId?: unknown
  /** 可注入随机源（缺省 Math.random）；全部随机决定只经此函数 */
  random?: () => number
  /** 测试注入时钟 */
  now?: Date
}

interface PickedWindow {
  market: TdxMarket
  code: string
  name: string
  window: DayBar[]
  fingerprint: string
  notes: string[]
}

function universeEmpty(message: string): HttpError {
  return new HttpError(422, message, 'RANDOM_STOCK_UNIVERSE_EMPTY')
}

function windowNotFit(available: number, windowBars: number): HttpError {
  return new HttpError(
    422,
    `该股票可用日线 ${available} 根，无法在保留 ${MA_WARMUP_BARS} 根指标预热的前提下随机选取 ${windowBars} 根窗口；请减小窗口或换一只历史更长的股票`,
    'RANDOM_WINDOW_NOT_FIT',
  )
}

/** RF-04 档位口径无可行起点（预热不足或完整 N 个自然月跨度放不进数据） */
function windowMonthsNotFit(available: number, months: number): HttpError {
  return new HttpError(
    422,
    `该股票可用日线 ${available} 根，无法在保留 ${MA_WARMUP_BARS} 根指标预热的前提下随机选取完整 ${months} 个自然月跨度的窗口；请换更短档位或一只历史更长的股票`,
    'RANDOM_WINDOW_NOT_FIT',
  )
}

/**
 * RF-04 档位口径可行起始下标：预热 200 根之后、起点＋N 个自然月跨度完整落在数据内
 * （窗末日期不超出数据末日，杜绝截断残窗）、且窗口至少 2 个交易日。addMonths 对起点
 * 单调不减，故窗末一旦越过数据末日即可提前终止。
 */
function monthWindowStarts(bars: DayBar[], months: number): number[] {
  if (bars.length === 0) return []
  const lastDate = bars[bars.length - 1].date
  const starts: number[] = []
  for (let i = MA_WARMUP_BARS; i < bars.length - 1; i++) {
    const windowEnd = addMonths(bars[i].date, months)
    if (windowEnd > lastDate) break
    if (bars[i + 1].date <= windowEnd) starts.push(i)
  }
  return starts
}

/** RF-04 档位口径窗口：起始下标 → [start, addMonths(start, N)] 内的全部日线 */
function monthWindowSlice(bars: DayBar[], startIndex: number, months: number): DayBar[] {
  const windowEnd = addMonths(bars[startIndex].date, months)
  return bars.filter(bar => bar.date >= bars[startIndex].date && bar.date <= windowEnd)
}

function drawOffsetDays(rng: () => number): number {
  const magnitude = 1 + Math.floor(rng() * RANDOM_OFFSET_MAX_DAYS)
  return rng() < 0.5 ? -magnitude : magnitude
}

async function fingerprintOf(database: DatabaseSync, config: AppConfig, market: TdxMarket, code: string, visibleBars: DayBar[]): Promise<string> {
  const reader = await marketReader(database, config)
  let events: Parameters<typeof rangeFingerprint>[3] = []
  try {
    events = await reader.readActions(market, code, { fresh: true })
  } catch {
    events = []
  }
  return rangeFingerprint(market, code, visibleBars, events)
}

export async function createRandomTraining(
  database: DatabaseSync,
  config: AppConfig,
  input: CreateRandomTrainingInput,
): Promise<TrainingMeta> {
  const now = input?.now ?? new Date()
  const rng = typeof input?.random === 'function' ? input.random : Math.random
  const dimension = input?.dimension
  if (dimension !== 'random_stock' && dimension !== 'random_time' && dimension !== 'random_both') {
    throw new HttpError(400, 'dimension 必须是 random_stock / random_time / random_both 之一')
  }
  if (input?.tier !== undefined || input?.range !== undefined || input?.previewId !== undefined || input?.blind !== undefined) {
    throw new HttpError(400, '随机创建不接受 tier / range / previewId / blind（随机模式自带选股与信息隐藏规则）')
  }
  // 共享可选项与经典创建同语义
  let adjustMode: 'forward' | 'raw' | null = null
  if (input?.adjust_mode !== undefined) {
    if (input.adjust_mode !== 'forward' && input.adjust_mode !== 'raw') {
      throw new HttpError(400, '复权方式必须是 forward 或 raw')
    }
    adjustMode = input.adjust_mode
  }
  let initialCash: number | null = null
  if (input?.initial_cash !== undefined) {
    if (typeof input.initial_cash !== 'number' || !Number.isFinite(input.initial_cash) || input.initial_cash <= 0) {
      throw new HttpError(400, '初始资金必须是正数')
    }
    initialCash = input.initial_cash
  }
  const clockMode = input?.clock_mode === undefined ? 'close_only' : input.clock_mode
  if (clockMode !== 'close_only' && clockMode !== 'open_close') {
    throw new HttpError(400, 'clock_mode 必须是 close_only 或 open_close')
  }
  const ordersEnabled = input?.orders_enabled === true

  const reader = await marketReader(database, config)
  await reader.ensureCaches()

  let windowBars: number | null = null
  if (input?.window_bars !== undefined) {
    if (typeof input.window_bars !== 'number' || !Number.isSafeInteger(input.window_bars) || input.window_bars < 1) {
      throw new HttpError(400, 'window_bars 必须是正整数')
    }
    windowBars = input.window_bars
  }

  // RF-04 档位口径：window_months 只接受经典档位月数，与 window_bars（根数口径）互斥
  let windowMonths: number | null = null
  if (input?.window_months !== undefined) {
    if (typeof input.window_months !== 'number' || !Number.isSafeInteger(input.window_months) || !TIER_MONTH_VALUES.includes(input.window_months)) {
      throw new HttpError(400, `window_months 必须是经典档位月数（${TIER_MONTH_VALUES.join(' / ')}）之一`)
    }
    if (windowBars !== null) throw new HttpError(400, 'window_months 与 window_bars 只能提供其一（档位月跨度或自定义根数二选一）')
    windowMonths = input.window_months
  }

  let picked: PickedWindow | null = null

  if (dimension === 'random_stock') {
    if (input?.code !== undefined) throw new HttpError(400, 'random_stock 不接受 code（股票由服务器随机选取）')
    if (windowBars !== null) throw new HttpError(400, 'random_stock 不接受 window_bars（随机股票无根数口径，训练周期按档位月跨度或自定义起止日期）')
    const stocks = await reader.readCatalog()
    // RF2-01 档位口径：window_months＝最近 N 个自然月，锚点＝数据可用末日（目录 lastDate
    // 最大值，与经典面板 anchorDate＝dataStatus.sourceMaxDate 同源——tdxSource 对全部
    // day 文件取 max）；起始日＝锚点回退 N 自然月、对齐前方最近交易日，窗末＝起始交易日
    // ＋N 自然月（经典 tier 服务端 plannedEnd 同式，恒 ≤ 锚点，杜绝截断残窗）。
    let tierMonths: number | null = null
    let startDateInput: string
    let endDate: string
    if (windowMonths !== null) {
      if (input?.start_date !== undefined || input?.end_date !== undefined) {
        throw new HttpError(400, 'random_stock 的 window_months 与 start_date / end_date 只能提供其一（档位月跨度或自定义范围二选一）')
      }
      tierMonths = windowMonths
      const anchorEnd = stocks.reduce<string | null>((max, stock) =>
        typeof stock.lastDate === 'string' && (!max || stock.lastDate > max) ? stock.lastDate : max, null)
      if (anchorEnd === null) {
        throw universeEmpty(`本地目录没有可用日线（无法确定数据末日锚点），请先补充本地数据`)
      }
      startDateInput = addMonths(anchorEnd, -tierMonths)
      endDate = anchorEnd
    } else {
      if (typeof input?.start_date !== 'string' || !isDayDate(input.start_date) || typeof input?.end_date !== 'string' || !isDayDate(input.end_date)) {
        throw new HttpError(400, 'start_date 与 end_date 必须是有效的 YYYY-MM-DD 日期')
      }
      startDateInput = input.start_date
      endDate = input.end_date
      if (startDateInput > endDate) throw new HttpError(400, 'start_date 不得晚于 end_date')
    }
    // 目录预筛：数据覆盖到窗末（档位口径窗末＝数据可用末日）；再逐股核验预热与窗口可推进（拒绝采样）
    const candidates = stocks.filter(stock => typeof stock.lastDate === 'string' && stock.lastDate >= endDate)
    const remaining = [...candidates]
    while (remaining.length > 0) {
      const index = Math.floor(rng() * remaining.length)
      const candidate = remaining.splice(index, 1)[0] as ReaderCatalogEntry & { market: TdxMarket }
      const all = await reader.readBars(candidate.market, candidate.code)
      const prefix = all.filter(bar => bar.date <= startDateInput)
      if (prefix.length < MA_WARMUP_BARS + 1) continue
      const startBar = prefix[prefix.length - 1]
      const windowEnd = tierMonths !== null ? addMonths(startBar.date, tierMonths) : endDate
      if (startBar.date >= windowEnd) continue
      const window = all.filter(bar => bar.date >= startBar.date && bar.date <= windowEnd)
      if (window.length < 2) continue
      const cutoff = shanghaiCompleteDataDate(now)
      picked = {
        market: candidate.market,
        code: candidate.code,
        name: candidate.name,
        window,
        fingerprint: await fingerprintOf(database, config, candidate.market, candidate.code, all.filter(bar => bar.date <= cutoff)),
        notes: tierMonths !== null
          ? [
              `随机股票模式（档位口径）：股票由服务器从满足窗口约束的池中随机选取，窗口为最近 ${tierMonths} 个自然月（锚点＝数据末日，与经典训练周期同口径）`,
              `请求窗口 ${startDateInput} 至 ${endDate}`,
            ]
          : [
              '随机股票模式：股票由服务器从满足窗口约束的池中随机选取',
              `请求窗口 ${startDateInput} 至 ${endDate}`,
            ],
      }
      break
    }
    if (!picked) {
      throw universeEmpty(tierMonths !== null
        ? `本地数据中没有满足最近 ${tierMonths} 个自然月窗口需求（含 ${MA_WARMUP_BARS} 根指标预热且数据覆盖窗末）的股票，请换更短档位或补充本地数据`
        : `请求时间段 ${startDateInput} 至 ${endDate} 内没有满足窗口需求（含 ${MA_WARMUP_BARS} 根指标预热且数据覆盖窗末）的股票，请调整起止日期或补充本地数据`)
    }
  } else {
    // random_time / random_both：服务器选 window_bars 根窗口（闭包内使用需 const 收窄）
    const effectiveWindowBars = windowBars ?? RANDOM_DEFAULT_WINDOW_BARS
    if (input?.start_date !== undefined || input?.end_date !== undefined) {
      throw new HttpError(400, `${dimension} 不接受 start_date / end_date（时间窗由服务器随机选取）`)
    }
    const cutoff = shanghaiCompleteDataDate(now)
    if (dimension === 'random_time') {
      if (typeof input?.code !== 'string' || input.code.trim() === '') {
        throw new HttpError(400, 'random_time 必须提供 code')
      }
      let parsed: ReturnType<typeof parseTdxSymbol>
      try {
        parsed = parseTdxSymbol(input.code)
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'Invalid symbol')
      }
      const stocks = await reader.readCatalog()
      const stock = stocks.find(item => item.market === parsed.market && item.code === parsed.code)
      if (!stock) throw new HttpError(400, `代码 ${parsed.code} 不在 A 股目录中`)
      const bars = (await reader.readBars(parsed.market, parsed.code)).filter(bar => bar.date <= cutoff)
      if (windowMonths !== null) {
        // RF-04 档位口径：N 个自然月跨度、起点在可行集合内均匀随机（不换算固定根数）
        const feasibleStarts = monthWindowStarts(bars, windowMonths)
        if (feasibleStarts.length === 0) throw windowMonthsNotFit(bars.length, windowMonths)
        const startIndex = feasibleStarts[Math.floor(rng() * feasibleStarts.length)]
        picked = {
          market: parsed.market,
          code: parsed.code,
          name: stock.name,
          window: monthWindowSlice(bars, startIndex, windowMonths),
          fingerprint: await fingerprintOf(database, config, parsed.market, parsed.code, bars),
          notes: [`随机窗口模式（档位口径）：起点由服务器在可行起点集合中随机选取（预热 ${MA_WARMUP_BARS} 根，窗口为 ${windowMonths} 个自然月跨度，与经典训练周期同口径）`],
        }
      } else {
        const feasible = bars.length - effectiveWindowBars - MA_WARMUP_BARS + 1
        if (feasible < 1) throw windowNotFit(bars.length, effectiveWindowBars)
        const startIndex = MA_WARMUP_BARS + Math.floor(rng() * feasible)
        picked = {
          market: parsed.market,
          code: parsed.code,
          name: stock.name,
          window: bars.slice(startIndex, startIndex + effectiveWindowBars),
          fingerprint: await fingerprintOf(database, config, parsed.market, parsed.code, bars),
          notes: [`随机窗口模式：起点由服务器在可行起点集合中随机选取（预热 ${MA_WARMUP_BARS} 根，窗口 ${effectiveWindowBars} 根）`],
        }
      }
    } else {
      if (input?.code !== undefined) throw new HttpError(400, 'random_both 不接受 code（股票由服务器随机选取）')
      const stocks = await reader.readCatalog()
      // 目录预筛仅为省 IO：档位口径最低要求＝预热 200 根＋窗口 ≥2 根（能否容纳完整跨度逐股核验）
      const minimumBars = windowMonths !== null ? MA_WARMUP_BARS + 2 : effectiveWindowBars + MA_WARMUP_BARS
      const remaining = stocks.filter(stock =>
        typeof stock.bars === 'number' && stock.bars >= minimumBars) as Array<ReaderCatalogEntry & { market: TdxMarket }>
      while (remaining.length > 0) {
        const index = Math.floor(rng() * remaining.length)
        const candidate = remaining.splice(index, 1)[0]
        const bars = (await reader.readBars(candidate.market, candidate.code)).filter(bar => bar.date <= cutoff)
        if (windowMonths !== null) {
          const feasibleStarts = monthWindowStarts(bars, windowMonths)
          if (feasibleStarts.length === 0) continue
          const startIndex = feasibleStarts[Math.floor(rng() * feasibleStarts.length)]
          picked = {
            market: candidate.market,
            code: candidate.code,
            name: candidate.name,
            window: monthWindowSlice(bars, startIndex, windowMonths),
            fingerprint: await fingerprintOf(database, config, candidate.market, candidate.code, bars),
            notes: [`随机窗口模式（档位口径）：股票与起点均由服务器随机选取（预热 ${MA_WARMUP_BARS} 根，窗口为 ${windowMonths} 个自然月跨度，与经典训练周期同口径）`],
          }
        } else {
          const feasible = bars.length - effectiveWindowBars - MA_WARMUP_BARS + 1
          if (feasible < 1) continue
          const startIndex = MA_WARMUP_BARS + Math.floor(rng() * feasible)
          picked = {
            market: candidate.market,
            code: candidate.code,
            name: candidate.name,
            window: bars.slice(startIndex, startIndex + effectiveWindowBars),
            fingerprint: await fingerprintOf(database, config, candidate.market, candidate.code, bars),
            notes: [`随机窗口模式：股票与起点均由服务器随机选取（预热 ${MA_WARMUP_BARS} 根，窗口 ${effectiveWindowBars} 根）`],
          }
        }
        break
      }
      if (!picked) {
        throw universeEmpty(windowMonths !== null
          ? `本地数据中没有能容纳完整 ${windowMonths} 个自然月跨度窗口（含 ${MA_WARMUP_BARS} 根指标预热）的股票，请换更短档位或补充本地数据`
          : `本地数据中没有可用 K 线根数满足 ${effectiveWindowBars} 根窗口（含 ${MA_WARMUP_BARS} 根指标预热）的股票，请减小窗口或补充本地数据`)
      }
    }
  }

  const startBar = picked.window[0]
  const endBar = picked.window[picked.window.length - 1]
  const offsetDays = picked !== null && dimension !== 'random_stock' ? drawOffsetDays(rng) : null
  const industry = await industrySnapshot(config, picked.code)
  const id = commitTrainingCreation(database, {
    tier: RANGE_TIER_SENTINEL, code: picked.code, name: picked.name, market: picked.market,
    startDate: startBar.date, plannedEnd: endBar.date,
    blind: 0, adjustMode, initialCash, createdAt: now.toISOString(),
    currentDate: startBar.date,
    currentClose: clockMode === 'open_close' ? null : startBar.close,
    currentOpen: clockMode === 'open_close' ? startBar.open : null,
    currentPhase: clockMode === 'open_close' ? 'open' : 'close',
    clockMode, ordersEnabled,
    range: {
      mode: 'random',
      requestedStart: startBar.date,
      requestedEnd: endBar.date,
      barCount: picked.window.length,
      fingerprint: picked.fingerprint,
      notes: picked.notes,
    },
    industry,
    random: { mode: dimension, offsetDays },
  })
  const row = database.prepare('SELECT * FROM trainings WHERE id = ?').get(id) as unknown as TrainingRow
  return maskedMetaOf(database, row)
}

// ===== Fastify 挂接（api.ts 一行接入；钩子对非随机会话零改动直通） =====

export function registerRandomTrainingSupport(app: FastifyInstance, database: DatabaseSync, config: AppConfig): void {
  app.post('/api/trainings/random', async (request, reply) => {
    if (!config.tdxRoot) return reply.code(503).send({ error: 'TDX directory not found' })
    const training = await createRandomTraining(database, config, request.body as Record<string, unknown>)
    return reply.code(201).send({ training })
  })

  // RF-05 显式揭示（RANDOM-REVEAL-MIDRUN）：运行中随机会话经用户确认后的主动揭示动作，
  // 返回真实 code/name 与真实日期区间；仅此端点下发真实值，其余端点遮蔽不因揭示失效。
  app.post('/api/trainings/:id/reveal', async (request, reply) => {
    const id = Number((request.params as { id?: string }).id)
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'id 必须是正整数')
    // 注意：current_date 是 SQLite 关键字（CURRENT_DATE＝今日日期），列名必须加引号取列值
    const row = database.prepare(
      'SELECT id, code, name, start_date, planned_end, "current_date" AS currentDate FROM trainings WHERE id = ?',
    ).get(id) as unknown as { id: number; code: string; name: string; start_date: string; planned_end: string; currentDate: string | null } | undefined
    if (!row) throw new HttpError(404, `训练 ${id} 不存在`)
    if (!randomSessionOf(database, id)) {
      throw new HttpError(409, '该训练已结束或不是随机模式训练，无需揭示（结束后信息自动揭晓）', 'RANDOM_REVEAL_UNAVAILABLE')
    }
    return {
      training: {
        id: Number(row.id),
        code: row.code,
        name: row.name,
        startDate: row.start_date,
        plannedEnd: row.planned_end,
        currentDate: row.currentDate,
      },
    }
  })

  // 请求侧去偏移：隐藏时间会话的 bars?before 与画线 timestamp 由客户端偏移空间换回真实空间
  app.addHook('preHandler', async request => {
    const url = request.routeOptions?.url ?? ''
    if (url !== '/api/trainings/:id/bars' && url !== '/api/trainings/:id/drawings') return
    const id = Number((request.params as { id?: string }).id)
    const session = randomSessionOf(database, id)
    if (!session || !session.hideTime || session.offsetDays === null) return
    if (url === '/api/trainings/:id/bars') {
      const query = request.query as { before?: string }
      if (typeof query.before === 'string') query.before = deshiftDateString(query.before, session.offsetDays)
      return
    }
    if (request.body !== undefined) deshiftDrawingsPayload(request.body, session.offsetDays)
  })

  // 响应侧遮蔽：该会话一切出口（含错误消息）统一深度变换；结算/放弃后 status 非 running 自动停用。
  // 揭示端点自身除外——它的合同就是下发真实值（下方显式排除，防止遮蔽层把揭示结果再洗掉）。
  app.addHook('onSend', async (request, _reply, payload) => {
    const url = request.routeOptions?.url ?? ''
    if (url === '/api/trainings/:id/reveal') return payload
    if (url !== '/api/trainings/active' && !url.startsWith('/api/trainings/:id')) return payload
    if (typeof payload !== 'string' || payload.length === 0) return payload
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return payload
    }
    if (parsed === null || typeof parsed !== 'object') return payload
    const session = url === '/api/trainings/active'
      ? activeRandomSessionOf(database)
      : randomSessionOf(database, Number((request.params as { id?: string }).id))
    if (!session) return payload
    return JSON.stringify(transformRandomPayload(parsed, session))
  })
}
