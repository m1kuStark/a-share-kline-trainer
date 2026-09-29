// 历史版本保护读取入口（DATA-03，对槽D冻结契约的落地面）：
// 「历史版本保护层对外提供只读的历史批次/行情版本读取入口，训练与结算历史读取
//   不得因保护层引入改写语义；无法恢复时明确阻断。」
// 本文件只提供读取与校验语义：
// - readRetainedStock：读保留版（可读取的旧行情），绝不回退现势文件；
//   无保留版时返回 unavailable（读取方必须阻断，不得拿现势数据冒充旧版）。
// - verifyRetainedStock：现势文件与保留版指纹比对；漂移即漂移，不静默换数据。
// - 市场版本 lineage 读取（listMarketVersions / getMarketVersion）在 store.ts，全部只读。
// 写入仅两个口：retainStockVersion（按需保留个股旧版）与刷新协调器的 recordMarketVersion（单写者）。

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { DayBar } from '../../tdx/dayfile.js'
import { parseDayBuffer } from '../../tdx/dayfile.js'
import type { TdxMarket } from '../../tdx/stocks.js'
import { parseGbbqBuffer, type AdjustmentEvent } from '../../tdx/gbbq.js'
import { sha256Hex } from './fingerprint.js'
import type { HistoryStore } from './store.js'

export interface RetainedStockMeta {
  id: string
  market: string
  code: string
  createdAt: string
  rows: number
  sha256: string
}

export interface RetainStockInput {
  market: TdxMarket
  code: string
  /** 个股 .day 文件路径（保留原始字节快照） */
  dayFilePath: string
  /** 全市场 gbbq 权息文件路径；null＝该来源无权息数据（保留版 events 为空并在校验时同口径处理） */
  gbbqFilePath: string | null
  /** 注入时钟；缺省取当前时间 */
  now?: Date
}

/** 保留个股旧版：读取一次字节快照（day＋gbbq），内容指纹与解析校验通过后入库。
 * 字节快照在保留时点固定——之后现势文件如何被通达信改写，都不影响这份可读取的旧版。 */
export async function retainStockVersion(store: HistoryStore, input: RetainStockInput): Promise<RetainedStockMeta> {
  const dayBytes = await readFile(input.dayFilePath)
  const bars = parseDayBuffer(dayBytes)
  const events = input.gbbqFilePath
    ? filterStockEvents(parseGbbqBuffer(await readFile(input.gbbqFilePath)), input.market, input.code)
    : []
  const row = {
    id: randomUUID(),
    market: input.market,
    code: input.code,
    createdAt: (input.now ?? new Date()).toISOString(),
    rows: bars.length,
    sha256: sha256Hex(dayBytes),
    dayBytes,
    eventsJson: JSON.stringify(events),
  }
  store.insertRetainedVersion(row)
  return { id: row.id, market: row.market, code: row.code, createdAt: row.createdAt, rows: row.rows, sha256: row.sha256 }
}

export type RetainedStockRead =
  | { state: 'ok'; version: RetainedStockMeta; bars: DayBar[]; events: AdjustmentEvent[] }
  | { state: 'unavailable'; reason: string }

/**
 * 只读读取保留版旧行情。无保留版＝unavailable：调用方（训练/结算/复盘读取）必须明确阻断，
 * 绝不允许用现势文件顶替——那是改写语义，正是本层要挡住的。
 */
export function readRetainedStock(store: HistoryStore, id: string): RetainedStockRead {
  const row = store.getRetainedVersion(id)
  if (!row) {
    return {
      state: 'unavailable',
      reason: `没有可读取的历史版本 ${id}：该数据版本从未被保留（保护层建立前的旧训练或未保留的股票），无法恢复旧行情，已明确阻断而不以现势数据顶替`,
    }
  }
  return {
    state: 'ok',
    version: {
      id: row.id, market: row.market, code: row.code, createdAt: row.createdAt, rows: row.rows, sha256: row.sha256,
    },
    bars: parseDayBuffer(row.dayBytes),
    events: JSON.parse(row.eventsJson) as AdjustmentEvent[],
  }
}

export type RetainedStockVerification =
  | { state: 'intact'; detail: string }
  | { state: 'drifted'; barsChanged: boolean; eventsChanged: boolean; detail: string }
  | { state: 'missing'; detail: string }
  | { state: 'unavailable'; reason: string }

/**
 * 现势文件与保留版比对（只读，不写任何数据）。
 * intact＝日线与权息均逐字节一致；drifted＝现势已被改写（旧行情仅存在于保留版）；
 * missing＝现势文件不存在；unavailable＝没有保留版可比对。
 */
export async function verifyRetainedStock(
  store: HistoryStore,
  id: string,
  dayFilePath: string,
  gbbqFilePath: string | null,
): Promise<RetainedStockVerification> {
  const row = store.getRetainedVersion(id)
  if (!row) {
    return {
      state: 'unavailable',
      reason: `没有可读取的历史版本 ${id}：该数据版本从未被保留，无法判定现势文件相对旧版是否漂移`,
    }
  }
  let currentBytes: Buffer
  try {
    currentBytes = await readFile(dayFilePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'missing', detail: `现势日线文件不存在：${dayFilePath}` }
    }
    throw error
  }
  const barsChanged = sha256Hex(currentBytes) !== row.sha256
  const currentEvents = gbbqFilePath
    ? filterStockEvents(parseGbbqBuffer(await readFile(gbbqFilePath)), row.market as TdxMarket, row.code)
    : []
  const eventsChanged = JSON.stringify(currentEvents) !== row.eventsJson
  if (!barsChanged && !eventsChanged) {
    return { state: 'intact', detail: `现势日线与权息同保留版本 ${row.createdAt} 逐字节一致` }
  }
  const parts: string[] = []
  if (barsChanged) parts.push(`日线内容已变化（现势 ${currentBytes.byteLength / 32} 根，保留版 ${row.rows} 根）`)
  if (eventsChanged) parts.push('权息事件已变化')
  return {
    state: 'drifted',
    barsChanged,
    eventsChanged,
    detail: `${parts.join('；')}。旧行情仅存在于保留版本（保留于 ${row.createdAt}），读取历史必须使用保留版，不得以现势数据顶替`,
  }
}

function filterStockEvents(events: AdjustmentEvent[], market: TdxMarket, code: string): AdjustmentEvent[] {
  return events
    .filter(event => event.market === market && event.code === code)
    .sort((left, right) => left.date.localeCompare(right.date))
}
