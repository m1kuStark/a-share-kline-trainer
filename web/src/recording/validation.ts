// REC-VALIDATE：RecordingFile 校验/解析/导出（docs/engineering/recording-contract.md）
// parse 与 export 统一走 validateRecording；本模块只做纯数据校验，不执行输入中的任何代码或 URL。
import { ACTIONS } from './types'
import type { ChartCapture, RecordingFile } from './types'
import type { TrainingSnapshot } from '../api'

const MAX_BYTES = 25 * 1024 * 1024
const MAX_EVENTS = 50_000
const MAX_CHECKPOINTS = 2_000
const MAX_DEPTH = 40

const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS)
const PHASES: ReadonlySet<string> = new Set(['started', 'finished'])
const SOURCES: ReadonlySet<string> = new Set(['ui', 'keyboard', 'chart', 'system'])
const OUTCOMES: ReadonlySet<string> = new Set(['accepted', 'rejected', 'failed', 'cancelled', 'interrupted', 'unknown'])
const TIMEFRAMES: ReadonlySet<string> = new Set(['1D', '1W', '1M'])
const TIERS: ReadonlySet<string> = new Set(['1M', '3M', '6M', '1Y', '2Y'])
const TRAINING_STATUS: ReadonlySet<string> = new Set(['running', 'settled', 'abandoned'])
const ADJUST_MODES: ReadonlySet<string> = new Set(['forward', 'raw'])
const TRADE_SIDES: ReadonlySet<string> = new Set(['buy', 'sell'])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const OHLC_KEYS = ['open', 'high', 'low', 'close', 'volume', 'amount'] as const
const ACCOUNT_KEYS = ['cash', 'shares', 'availableShares', 'marketValue', 'equity'] as const

function fail(field: string, reason: string): never {
  throw new Error(`录制文件校验失败：${field ? `${field} ` : ''}${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function joinField(field: string, key: string): string {
  return field ? `${field}.${key}` : key
}

/** 全树 JSON 安全检查：有限数值、无 undefined/函数/非纯对象，嵌套深度受限 */
function assertJson(value: unknown, field: string, depth: number): void {
  if (depth > MAX_DEPTH) fail(field, `嵌套深度超过 ${MAX_DEPTH} 层`)
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return
    case 'number':
      if (!Number.isFinite(value)) {
        fail(field, '数值必须有限（NaN/Infinity 无法被 JSON 安全序列化，JSON.stringify 会静默写成 null）')
      }
      return
    case 'object':
      if (value === null) return
      if (Array.isArray(value)) {
        value.forEach((item, index) => assertJson(item, `${field}[${index}]`, depth + 1))
        return
      }
      if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) assertJson(item, joinField(field, key), depth + 1)
        return
      }
      fail(field, `仅支持纯 JSON 对象/数组（收到 ${(value as object).constructor?.name ?? '未知对象'}）`)
      return
    case 'undefined':
      fail(field, '含 undefined，无法被 JSON 安全序列化（JSON.stringify 会静默丢弃该值）')
      return
    default:
      fail(field, `类型 ${typeof value} 不能被 JSON 序列化`)
  }
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) fail(field, '必须是 JSON 对象')
  return value
}

function assertArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(field, '必须是数组')
  return value
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(field, '必须是非空字符串')
  return value
}

function assertStringOrNull(value: unknown, field: string): string | null {
  if (value === null) return null
  return assertString(value, field)
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field, '必须是布尔值')
  return value
}

function assertFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, '必须是有限数值')
  return value
}

function assertNumberOrNull(value: unknown, field: string): number | null {
  if (value === null) return null
  return assertFinite(value, field)
}

function assertInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(field, '必须是整数')
  return value
}

function assertEnum(value: unknown, field: string, allowed: ReadonlySet<string>): string {
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail(field, `必须是 ${[...allowed].join('/')} 之一（收到 ${JSON.stringify(value)}）`)
  }
  return value
}

function assertDate(value: unknown, field: string): string {
  const text = assertString(value, field)
  if (!DATE_PATTERN.test(text)) fail(field, `日期须为 YYYY-MM-DD 格式（收到 ${JSON.stringify(text)}）`)
  const [year, month, day] = text.split('-').map(Number) as [number, number, number]
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    fail(field, `不是有效的日历日期（${text}）`)
  }
  return text
}

function assertDateOrNull(value: unknown, field: string): string | null {
  if (value === null) return null
  return assertDate(value, field)
}

function assertTimestamp(value: unknown, field: string): string {
  const text = assertString(value, field)
  if (Number.isNaN(Date.parse(text))) fail(field, `时间须为可解析的日期时间字符串（收到 ${JSON.stringify(text)}）`)
  return text
}

interface CheckedEvent {
  segmentId: string
  checkpointId: string | undefined
}

function assertEvent(raw: unknown, field: string, index: number): CheckedEvent {
  const event = assertRecord(raw, field)
  assertInteger(event.seq, `${field}.seq`)
  if (event.seq !== index + 1) {
    fail(`${field}.seq`, `必须从 1 连续递增（位置 ${index} 期望 ${index + 1}，实际 ${JSON.stringify(event.seq)}）`)
  }
  assertString(event.opId, `${field}.opId`)
  const segmentId = assertString(event.segmentId, `${field}.segmentId`)
  if (assertFinite(event.elapsedMs, `${field}.elapsedMs`) < 0) fail(`${field}.elapsedMs`, '不能为负数')
  assertEnum(event.phase, `${field}.phase`, PHASES)
  if (typeof event.action !== 'string' || !ACTION_SET.has(event.action)) {
    fail(`${field}.action`, `不在动作白名单内（收到 ${JSON.stringify(event.action)}）`)
  }
  assertEnum(event.source, `${field}.source`, SOURCES)
  if (event.outcome !== undefined) assertEnum(event.outcome, `${field}.outcome`, OUTCOMES)
  const checkpointId = event.checkpointId === undefined ? undefined : assertString(event.checkpointId, `${field}.checkpointId`)
  // params/result 为 JsonValue，已由 assertJson 全树校验
  return { segmentId, checkpointId }
}

function assertEventPairing(events: unknown[], complete: boolean): void {
  const started = new Set<string>()
  const finished = new Set<string>()
  events.forEach((raw, index) => {
    const event = raw as { opId: string; phase: string }
    const field = `events[${index}].opId`
    if (event.phase === 'started') {
      if (started.has(event.opId)) fail(field, `started 重复（opId ${event.opId}）`)
      started.add(event.opId)
      return
    }
    if (!started.has(event.opId)) fail(field, `finished 缺少配对的 started（opId ${event.opId}）`)
    if (finished.has(event.opId)) fail(field, `finished 重复（opId ${event.opId}）`)
    finished.add(event.opId)
  })
  const dangling = [...started].filter(opId => !finished.has(opId))
  if (dangling.length > 0 && complete) {
    fail('complete', `存在未闭合的 started 操作（opId ${dangling.join('、')}），中断尾段未闭合时 complete 不能为 true`)
  }
}

function assertBar(raw: unknown, field: string): void {
  const bar = assertRecord(raw, field)
  assertDate(bar.date, `${field}.date`)
  for (const key of OHLC_KEYS) assertFinite(bar[key], `${field}.${key}`)
}

function assertDrawing(raw: unknown, field: string, drawingIds: Set<string>): void {
  const drawing = assertRecord(raw, field)
  const id = assertString(drawing.id, `${field}.id`)
  if (drawingIds.has(id)) fail(`${field}.id`, `画线 id 重复（${id}）`)
  drawingIds.add(id)
  assertString(drawing.name, `${field}.name`)
  assertString(drawing.paneId, `${field}.paneId`)
  const points = assertArray(drawing.points, `${field}.points`)
  points.forEach((point, index) => {
    const item = assertRecord(point, `${field}.points[${index}]`)
    assertFinite(item.timestamp, `${field}.points[${index}].timestamp`)
    assertFinite(item.value, `${field}.points[${index}].value`)
  })
  if (drawing.styles !== undefined && !isRecord(drawing.styles)) {
    fail(`${field}.styles`, '必须是 JSON 对象')
  }
  // extendData 为任意 JsonValue，已由 assertJson 全树校验
}

function assertChartCapture(raw: unknown, field: string): void {
  const chart = assertRecord(raw, field)
  assertEnum(chart.timeframe, `${field}.timeframe`, TIMEFRAMES)
  assertArray(chart.bars, `${field}.bars`).forEach((bar, index) => assertBar(bar, `${field}.bars[${index}]`))
  const drawingIds = new Set<string>()
  assertArray(chart.drawings, `${field}.drawings`).forEach((drawing, index) => {
    assertDrawing(drawing, `${field}.drawings[${index}]`, drawingIds)
  })
  const view = assertRecord(chart.view, `${field}.view`)
  assertNumberOrNull(view.fromTimestamp, `${field}.view.fromTimestamp`)
  assertNumberOrNull(view.toTimestamp, `${field}.view.toTimestamp`)
  assertFinite(view.barSpace, `${field}.view.barSpace`)
  const paneHeights = assertRecord(view.paneHeights, `${field}.view.paneHeights`)
  for (const [key, height] of Object.entries(paneHeights)) {
    assertFinite(height, `${field}.view.paneHeights.${key}`)
  }
  assertNumberOrNull(chart.costPrice, `${field}.costPrice`)
}

function assertTrade(raw: unknown, field: string): void {
  const trade = assertRecord(raw, field)
  assertInteger(trade.seq, `${field}.seq`)
  assertDate(trade.date, `${field}.date`)
  assertEnum(trade.side, `${field}.side`, TRADE_SIDES)
  assertFinite(trade.price, `${field}.price`)
  assertFinite(trade.shares, `${field}.shares`)
  assertFinite(trade.amount, `${field}.amount`)
  assertFinite(trade.fee, `${field}.fee`)
  if (trade.chartPrice !== undefined) assertFinite(trade.chartPrice, `${field}.chartPrice`)
  if (trade.blindIndex !== undefined) assertInteger(trade.blindIndex, `${field}.blindIndex`)
  if (trade.blindLabel !== undefined) assertString(trade.blindLabel, `${field}.blindLabel`)
}

function assertTrainingSnapshot(raw: unknown, field: string): void {
  const snapshot = assertRecord(raw, field)
  const meta = assertRecord(snapshot.training, `${field}.training`)
  assertInteger(meta.id, `${field}.training.id`)
  assertEnum(meta.tier, `${field}.training.tier`, TIERS)
  assertStringOrNull(meta.code, `${field}.training.code`)
  assertStringOrNull(meta.name, `${field}.training.name`)
  assertString(meta.market, `${field}.training.market`)
  assertDate(meta.startDate, `${field}.training.startDate`)
  assertDate(meta.plannedEnd, `${field}.training.plannedEnd`)
  assertDateOrNull(meta.currentDate, `${field}.training.currentDate`)
  assertEnum(meta.status, `${field}.training.status`, TRAINING_STATUS)
  assertDateOrNull(meta.settleDate, `${field}.training.settleDate`)
  assertBoolean(meta.earlySettle, `${field}.training.earlySettle`)
  assertBoolean(meta.blind, `${field}.training.blind`)
  assertEnum(meta.adjustMode, `${field}.training.adjustMode`, ADJUST_MODES)
  assertFinite(meta.initialCash, `${field}.training.initialCash`)
  assertTimestamp(meta.createdAt, `${field}.training.createdAt`)

  const account = assertRecord(snapshot.account, `${field}.account`)
  for (const key of ACCOUNT_KEYS) assertFinite(account[key], `${field}.account.${key}`)
  assertNumberOrNull(account.costPrice, `${field}.account.costPrice`)

  assertArray(snapshot.trades, `${field}.trades`).forEach((trade, index) => {
    assertTrade(trade, `${field}.trades[${index}]`)
  })
}

interface CheckedCheckpoint {
  training: TrainingSnapshot | null
  chart: ChartCapture | null
}

function assertCheckpoint(
  raw: unknown,
  field: string,
  eventCount: number,
  segmentIds: ReadonlySet<string>,
  checkpointIds: Set<string>,
): CheckedCheckpoint {
  const checkpoint = assertRecord(raw, field)
  const id = assertString(checkpoint.id, `${field}.id`)
  if (checkpointIds.has(id)) fail(`${field}.id`, `检查点 id 重复（${id}）`)
  checkpointIds.add(id)
  const afterSeq = assertInteger(checkpoint.afterSeq, `${field}.afterSeq`)
  if (afterSeq < 0 || afterSeq > eventCount) {
    fail(`${field}.afterSeq`, `须在 0..${eventCount} 范围内（收到 ${afterSeq}）`)
  }
  const segmentId = assertString(checkpoint.segmentId, `${field}.segmentId`)
  if (eventCount > 0 && !segmentIds.has(segmentId)) {
    fail(`${field}.segmentId`, `未出现在任何事件中（${segmentId}）`)
  }
  assertTimestamp(checkpoint.capturedAt, `${field}.capturedAt`)
  const training = checkpoint.training === null
    ? null
    : (assertTrainingSnapshot(checkpoint.training, `${field}.training`), checkpoint.training as TrainingSnapshot)
  const chart = checkpoint.chart === null
    ? null
    : (assertChartCapture(checkpoint.chart, `${field}.chart`), checkpoint.chart as ChartCapture)
  const ui = assertRecord(checkpoint.ui, `${field}.ui`)
  assertString(ui.theme, `${field}.ui.theme`)
  assertStringOrNull(ui.tool, `${field}.ui.tool`)
  assertString(ui.magnet, `${field}.ui.magnet`)
  assertBoolean(ui.multiSelect, `${field}.ui.multiSelect`)
  // context 为 JsonValue | null，已由 assertJson 全树校验
  return { training, chart }
}

/** 校验录制文件；失败抛中文可行动错误，通过则原样返回（不重排 checkpoints） */
export function validateRecording(value: unknown): RecordingFile {
  if (!isRecord(value)) fail('顶层', '必须是 JSON 对象')
  assertJson(value, '', 1)

  if (value.format !== 'trainer-session') {
    fail('format', `必须是 'trainer-session'（收到 ${JSON.stringify(value.format)}）`)
  }
  if (value.schemaVersion !== 1) {
    fail('schemaVersion', `必须是 1（收到 ${JSON.stringify(value.schemaVersion)}）`)
  }
  assertString(value.sessionId, 'sessionId')
  assertTimestamp(value.createdAt, 'createdAt')

  const app = assertRecord(value.app, 'app')
  assertString(app.version, 'app.version')
  assertString(app.gitCommit, 'app.gitCommit')
  assertBoolean(app.dirty, 'app.dirty')
  assertString(app.chartLibrary, 'app.chartLibrary')

  const environment = assertRecord(value.environment, 'environment')
  assertString(environment.timezone, 'environment.timezone')
  const viewport = assertRecord(environment.viewport, 'environment.viewport')
  assertFinite(viewport.width, 'environment.viewport.width')
  assertFinite(viewport.height, 'environment.viewport.height')
  assertFinite(environment.dpr, 'environment.dpr')

  assertStringOrNull(value.trainingKey, 'trainingKey')
  assertBoolean(value.complete, 'complete')

  const events = assertArray(value.events, 'events')
  if (events.length > MAX_EVENTS) fail('events', `事件数量 ${events.length} 超过上限 ${MAX_EVENTS}`)
  const checkpoints = assertArray(value.checkpoints, 'checkpoints')
  if (checkpoints.length > MAX_CHECKPOINTS) fail('checkpoints', `检查点数量 ${checkpoints.length} 超过上限 ${MAX_CHECKPOINTS}`)
  const gaps = assertArray(value.gaps, 'gaps')

  const segmentIds = new Set<string>()
  const checkpointRefs: Array<string | undefined> = []
  events.forEach((raw, index) => {
    const checked = assertEvent(raw, `events[${index}]`, index)
    segmentIds.add(checked.segmentId)
    checkpointRefs.push(checked.checkpointId)
  })
  assertEventPairing(events, value.complete as boolean)

  const checkpointIds = new Set<string>()
  const checkedCheckpoints = checkpoints.map((raw, index) =>
    assertCheckpoint(raw, `checkpoints[${index}]`, events.length, segmentIds, checkpointIds),
  )

  checkpointRefs.forEach((checkpointId, index) => {
    if (checkpointId !== undefined && !checkpointIds.has(checkpointId)) {
      fail(`events[${index}].checkpointId`, `引用了不存在的检查点 id（${checkpointId}）`)
    }
  })

  // bars 截止不晚于推进日；周/月 bar 的 date 为周期起点，同样不得越过边界
  checkedCheckpoints.forEach((checked, index) => {
    const currentDate = checked.training?.training.currentDate ?? null
    if (currentDate === null || checked.chart === null) return
    checked.chart.bars.forEach((bar, barIndex) => {
      if (bar.date > currentDate) {
        fail(`checkpoints[${index}].chart.bars[${barIndex}].date`, `晚于 training.currentDate（${currentDate}），不得包含未来数据`)
      }
    })
  })

  let previousAfterSeq = 0
  gaps.forEach((raw, index) => {
    const gap = assertRecord(raw, `gaps[${index}]`)
    const afterSeq = assertInteger(gap.afterSeq, `gaps[${index}].afterSeq`)
    if (afterSeq < 1 || afterSeq > events.length) {
      fail(`gaps[${index}].afterSeq`, `须在 1..${events.length} 范围内（收到 ${afterSeq}）`)
    }
    if (afterSeq <= previousAfterSeq) {
      fail(`gaps[${index}].afterSeq`, `gaps 须按 afterSeq 严格递增（前值 ${previousAfterSeq}，收到 ${afterSeq}）`)
    }
    previousAfterSeq = afterSeq
    if (gap.resumedAtSeq !== null) {
      const resumedAtSeq = assertInteger(gap.resumedAtSeq, `gaps[${index}].resumedAtSeq`)
      if (resumedAtSeq <= afterSeq) fail(`gaps[${index}].resumedAtSeq`, `必须大于 afterSeq（${afterSeq}）`)
      if (resumedAtSeq > events.length) {
        fail(`gaps[${index}].resumedAtSeq`, `超出事件范围（最大 ${events.length}，收到 ${resumedAtSeq}）`)
      }
    }
  })

  return value as unknown as RecordingFile
}

/** 解析录制 JSON 文本：字节大小 ≤ 25MiB → JSON.parse → validateRecording */
export function parseRecording(text: string): RecordingFile {
  if (typeof text !== 'string') fail('parseRecording', '输入必须是字符串')
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_BYTES) fail('文件大小', `${bytes} 字节超过上限 ${MAX_BYTES} 字节（25MiB）`)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('JSON 解析', '不是合法的 JSON 文本')
  }
  return validateRecording(value)
}

/** 导出录制文件：先校验（拦截 NaN/undefined 等静默序列化损失），再 JSON.stringify */
export function exportRecording(file: RecordingFile): string {
  validateRecording(file)
  const text = JSON.stringify(file)
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_BYTES) fail('导出大小', `${bytes} 字节超过上限 ${MAX_BYTES} 字节（25MiB）`)
  return text
}
