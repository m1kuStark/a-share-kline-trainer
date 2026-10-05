// M7-01 随机训练模式·服务端核心（docs/verification/2026-10/M7-01/design.md §2 为契约）。
// 三种维度：random_stock（用户起止日期＋服务器随机选股）/ random_time（用户股票＋服务器
// 随机 window_bars 时间窗）/ random_both（全随机）。随机决定全部经可注入 rng；股票池按
// 窗口需求（含 200 根指标预热）过滤，池空 422 RANDOM_STOCK_UNIVERSE_EMPTY、无可行起点
// 422 RANDOM_WINDOW_NOT_FIT。
//
// 信息隐藏是 API 级真隐藏（网络面板可见即算泄漏）：隐藏股票→运行中会话一切响应无名称/代码；
// 隐藏时间→响应内全部市场日期经会话级随机常量偏移变换（纯日期/月键/长字符串内日期子串/
// drawings 时间戳），间距与缺口逐日保留，ISO 挂钟时间戳保持真实；请求侧（bars?before、
// 画线 timestamp）反向去偏移，库内恒真实空间。结算/放弃后隐藏停用，揭晓真实信息。
// 训练引擎撮合/推进/结算语义零改动：创建复用 commitTrainingCreation 提交边界，
// 遮蔽在 HTTP 出口层（onSend）实施，威胁模型不含拿偏移序列对全市场日历做缺口指纹暴力比对。

import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import { isDayDate, type DayBar } from '../tdx/dayfile.js'
import { parseTdxSymbol } from '../tdx/symbol.js'
import type { TdxMarket } from '../tdx/stocks.js'
import type { ReaderCatalogEntry } from '../data/reader.js'
import {
  HttpError, MA_WARMUP_BARS, RANGE_TIER_SENTINEL, commitTrainingCreation, industrySnapshot, marketReader,
  rangeFingerprint, shanghaiCompleteDataDate, toMeta,
  type RandomDimension, type TrainingCreationRow, type TrainingMeta, type TrainingRow,
} from './engine.js'

export const RANDOM_DEFAULT_WINDOW_BARS = 250
export const RANDOM_OFFSET_MAX_DAYS = 3650

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
  return sessionOfRow(row)
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
    masked.random = { dimension: session.dimension, hideStock: session.hideStock, hideTime: session.hideTime }
  }
  return masked
}

/** 创建响应等模块内直用：把真实 meta 按会话隐藏规则变换后返回 */
function maskedMetaOf(row: TrainingRow): TrainingMeta {
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
  return { ...meta, random: { dimension: session.dimension, hideStock: session.hideStock, hideTime: session.hideTime } }
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

  let picked: PickedWindow | null = null

  if (dimension === 'random_stock') {
    if (input?.code !== undefined) throw new HttpError(400, 'random_stock 不接受 code（股票由服务器随机选取）')
    if (windowBars !== null) throw new HttpError(400, 'random_stock 不接受 window_bars（时间段由用户指定）')
    if (typeof input?.start_date !== 'string' || !isDayDate(input.start_date) || typeof input?.end_date !== 'string' || !isDayDate(input.end_date)) {
      throw new HttpError(400, 'start_date 与 end_date 必须是有效的 YYYY-MM-DD 日期')
    }
    const startDateInput = input.start_date
    const endDate = input.end_date
    if (startDateInput > endDate) throw new HttpError(400, 'start_date 不得晚于 end_date')
    const stocks = await reader.readCatalog()
    // 目录预筛：数据覆盖到窗末；再逐股核验预热与窗口可推进（拒绝采样）
    const candidates = stocks.filter(stock => typeof stock.lastDate === 'string' && stock.lastDate >= endDate)
    const remaining = [...candidates]
    while (remaining.length > 0) {
      const index = Math.floor(rng() * remaining.length)
      const candidate = remaining.splice(index, 1)[0] as ReaderCatalogEntry & { market: TdxMarket }
      const all = await reader.readBars(candidate.market, candidate.code)
      const prefix = all.filter(bar => bar.date <= startDateInput)
      if (prefix.length < MA_WARMUP_BARS + 1) continue
      const startBar = prefix[prefix.length - 1]
      if (startBar.date >= endDate) continue
      const window = all.filter(bar => bar.date >= startBar.date && bar.date <= endDate)
      if (window.length < 2) continue
      const cutoff = shanghaiCompleteDataDate(now)
      picked = {
        market: candidate.market,
        code: candidate.code,
        name: candidate.name,
        window,
        fingerprint: await fingerprintOf(database, config, candidate.market, candidate.code, all.filter(bar => bar.date <= cutoff)),
        notes: [
          '随机股票模式：股票由服务器从满足窗口约束的池中随机选取',
          `请求窗口 ${startDateInput} 至 ${endDate}`,
        ],
      }
      break
    }
    if (!picked) {
      throw universeEmpty(`请求时间段 ${startDateInput} 至 ${endDate} 内没有满足窗口需求（含 ${MA_WARMUP_BARS} 根指标预热且数据覆盖窗末）的股票，请调整起止日期或补充本地数据`)
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
    } else {
      if (input?.code !== undefined) throw new HttpError(400, 'random_both 不接受 code（股票由服务器随机选取）')
      const stocks = await reader.readCatalog()
      const remaining = stocks.filter(stock =>
        typeof stock.bars === 'number' && stock.bars >= effectiveWindowBars + MA_WARMUP_BARS) as Array<ReaderCatalogEntry & { market: TdxMarket }>
      while (remaining.length > 0) {
        const index = Math.floor(rng() * remaining.length)
        const candidate = remaining.splice(index, 1)[0]
        const bars = (await reader.readBars(candidate.market, candidate.code)).filter(bar => bar.date <= cutoff)
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
        break
      }
      if (!picked) {
        throw universeEmpty(`本地数据中没有可用 K 线根数满足 ${effectiveWindowBars} 根窗口（含 ${MA_WARMUP_BARS} 根指标预热）的股票，请减小窗口或补充本地数据`)
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
  return maskedMetaOf(row)
}

// ===== Fastify 挂接（api.ts 一行接入；钩子对非随机会话零改动直通） =====

export function registerRandomTrainingSupport(app: FastifyInstance, database: DatabaseSync, config: AppConfig): void {
  app.post('/api/trainings/random', async (request, reply) => {
    if (!config.tdxRoot) return reply.code(503).send({ error: 'TDX directory not found' })
    const training = await createRandomTraining(database, config, request.body as Record<string, unknown>)
    return reply.code(201).send({ training })
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

  // 响应侧遮蔽：该会话一切出口（含错误消息）统一深度变换；结算/放弃后 status 非 running 自动停用
  app.addHook('onSend', async (request, _reply, payload) => {
    const url = request.routeOptions?.url ?? ''
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
