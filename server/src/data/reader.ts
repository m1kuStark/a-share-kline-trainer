// 统一行情读取入口（DATA-04）：训练/结算经此读取 bars/actions/coverage/version，
// 不再直读 TDX 文件路径与 tdx/* 内部函数。来源选择与刷新扫描同口径：本地 TDX 可用
// （config.tdxRoot 非空＝发现阶段已确认可用）→ 用 TDX；否则按注册顺序取第一个
// available() 的注册读取器；均不可用则明确不可用（引擎侧映射为 503，不虚构数据）。
// 本轮不接任何真实在线来源（R2 属 V2 门槛，见 roadmap.md:23,25）；替代来源实现本
// 接口即可参与训练，注册入口供测试夹具与未来在线适配器使用。
// 写入边界：读取器只承载「读取前的缓存保障」（TDX＝权息缓存刷新、目录刷新），
// 整批发布（DATA-01）与市场版本记账（DATA-03）仍归刷新协调器，读取器绝不写行情。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import { readDayFileRange, type DayBar } from '../tdx/dayfile.js'
import { gbbqFilePath, loadAdjustmentEvents, refreshAdjustmentCache } from '../tdx/adjustment-cache.js'
import { refreshStockCatalog } from '../tdx/catalog.js'
import { parseGbbqBuffer, type AdjustmentEvent } from '../tdx/gbbq.js'
import type { TdxMarket } from '../tdx/stocks.js'

/** 原始日线区间（闭区间，均可选；缺省＝全部记录） */
export interface ReaderBarsQuery {
  from?: string
  to?: string
}

/**
 * 权息事件读取口径。cached（默认）＝来源的持久缓存（TDX＝adj_factors 表，读取廉价）；
 * fresh＝绕过持久缓存直接从来源现势字节解码（TDX＝gbbq 文件），用于范围预览指纹等
 * 「字节已变而缓存指纹（size:mtime）未变时缓存保持陈旧」的场景（GPT-WAKE-02）。
 */
export interface ReaderActionsQuery {
  fresh?: boolean
}

/** 股票目录条目：训练创建用它确认代码在目录中并取名称；lastDate/bars 供覆盖口径 */
export interface ReaderCatalogEntry {
  code: string
  market: TdxMarket
  name: string
  lastDate: string | null
  bars: number | null
}

/** 个股覆盖：最后交易日与记录数；来源无法证明时为 null，不得用全市场尾日冒充 */
export interface ReaderCoverage {
  lastDate: string | null
  rows: number | null
}

export type MarketReaderKind = 'tdx' | 'online' | 'other'

export interface MarketDataReader {
  readonly kind: MarketReaderKind
  readonly name: string
  /** 廉价可用性检查；不得全量扫描 */
  available(): Promise<boolean>
  /** 原始日线：未复权、未聚合、未按训练推进日截断（截断/复权/聚合归调用方） */
  readBars(market: TdxMarket, code: string, query?: ReaderBarsQuery): Promise<DayBar[]>
  /** 权息/公司行动事件（按日期升序）；fresh 语义见 ReaderActionsQuery */
  readActions(market: TdxMarket, code: string, query?: ReaderActionsQuery): Promise<AdjustmentEvent[]>
  /** 股票目录；TDX 实现沿用既有目录刷新（与 DATA-01 目录扫描同源），替代来源自带目录 */
  readCatalog(): Promise<ReaderCatalogEntry[]>
  /** 个股覆盖；TDX 实现读目录缓存（随最近一次目录刷新） */
  readCoverage(market: TdxMarket, code: string): Promise<ReaderCoverage>
  /** 当前数据版本：TDX＝cache_meta 的 snapshot_batch（DATA-01 整批发布标识）；未发布过为 null */
  readVersion(): Promise<string | null>
  /** 读取前的缓存保障（TDX＝权息缓存刷新）；无缓存的来源为无操作 */
  ensureCaches(): Promise<void>
}

/** 无任何可用来源：引擎侧映射为 HttpError 503（保持既有 API 状态码合约），数据层不感知 HTTP 类型。 */
export class MarketReaderUnavailableError extends Error {
  readonly statusCode = 503
  constructor(message = '未发现 TDX 数据目录，且未配置其他行情来源') {
    super(message)
    this.name = 'MarketReaderUnavailableError'
  }
}

// 注册表：与 source.ts 的在线来源注册同款模块级模式（按注册顺序，先到先得）。
// 返回的注销函数只移除该实例；测试必须在结束前注销，避免跨用例泄漏。
const registeredReaders: MarketDataReader[] = []

export function registerMarketReader(reader: MarketDataReader): () => void {
  registeredReaders.push(reader)
  return () => {
    const index = registeredReaders.indexOf(reader)
    if (index >= 0) registeredReaders.splice(index, 1)
  }
}

/**
 * 解析当前应使用的读取器：config.tdxRoot 非空＝TDX 优先（与 selectSource 的
 * 「本地 TDX 可用 → 用 TDX」同口径）；否则按注册顺序取第一个 available() 的读取器。
 */
export async function resolveMarketReader(database: DatabaseSync, config: AppConfig): Promise<MarketDataReader> {
  if (config.tdxRoot) return createTdxMarketReader(database, config)
  for (const reader of registeredReaders) {
    if (await reader.available()) return reader
  }
  throw new MarketReaderUnavailableError()
}

/** TDX 文件读取器：包装既有 tdx/* 读取与缓存函数，行为与旧直读路径逐点一致。 */
export function createTdxMarketReader(database: DatabaseSync, config: AppConfig): MarketDataReader {
  if (!config.tdxRoot) throw new MarketReaderUnavailableError()
  const tdxRoot = config.tdxRoot
  const dayFilePath = (market: TdxMarket, code: string): string =>
    join(tdxRoot, 'vipdoc', market, 'lday', `${market}${code}.day`)
  return {
    kind: 'tdx',
    name: '通达信本地数据',
    async available() {
      return config.tdxRoot !== null
    },
    readBars(market, code, query) {
      return readDayFileRange(dayFilePath(market, code), query?.from, query?.to)
    },
    async readActions(market, code, query) {
      if (!query?.fresh) return loadAdjustmentEvents(database, market, code)
      // fresh：绕过 stat 指纹缓存的 adj_factors，直接解码现势 gbbq 字节并按股票过滤
      const bytes = await readFile(gbbqFilePath(tdxRoot))
      return parseGbbqBuffer(bytes)
        .filter(event => event.market === market && event.code === code)
        .sort((left, right) => left.date.localeCompare(right.date))
    },
    async readCatalog() {
      const result = await refreshStockCatalog(database, tdxRoot)
      return result.stocks.map(stock => ({
        code: stock.code,
        market: stock.market,
        name: stock.name,
        lastDate: stock.lastDate,
        bars: stock.bars,
      }))
    },
    readCoverage(market, code) {
      const row = database.prepare('SELECT last_date, bars FROM stocks WHERE code = ? AND market = ?')
        .get(code, market) as unknown as { last_date: string | null; bars: number | null } | undefined
      return Promise.resolve({ lastDate: row?.last_date ?? null, rows: row?.bars ?? null })
    },
    readVersion() {
      const row = database.prepare("SELECT value FROM cache_meta WHERE key = 'snapshot_batch'")
        .get() as unknown as { value: string } | undefined
      return Promise.resolve(row?.value ?? null)
    },
    ensureCaches() {
      return refreshAdjustmentCache(database, tdxRoot).then(() => undefined)
    },
  }
}
