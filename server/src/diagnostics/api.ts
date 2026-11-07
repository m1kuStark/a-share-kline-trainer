// DIAG-OPLOG-01：本地操作日志 HTTP 面＋业务 API 自动记录中间件。
// - POST /api/diagnostics/events：Web 端批量上报 UI/错误/生命周期事件（同源守卫在 index.ts）。
// - GET  /api/diagnostics/info：日志路径/版本（设置页展示与支持人员定位用）。
// - GET  /api/diagnostics/tail：最近若干行（供验收时读取操作轨迹；脱敏后的 JSONL）。
// - onResponse：把 /api/** 业务调用（方法/路由/状态/耗时/脱敏请求数据）记入同一日志。
// 日志只落本机 dataDir，不联网；写失败不影响响应。
import type { FastifyInstance } from 'fastify'
import { basename, dirname, join } from 'node:path'
import type { AppConfig } from '../config.js'
import { serverVersion } from '../update/version.js'
import {
  createOperationLog, sanitizeOperationData, type OperationEventType, type OperationLog,
} from './operation-log.js'

export const DIAGNOSTICS_EVENTS_MAX = 50
export const DIAGNOSTICS_TAIL_MAX = 200
export const DIAGNOSTICS_TAIL_DEFAULT = 100
const EVENT_TYPES: readonly OperationEventType[] = ['ui', 'error', 'lifecycle', 'desktop', 'api']
const ACTION_PATTERN = /^[a-zA-Z0-9_.:/-]{1,80}$/
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/

interface IncomingEvent {
  type: OperationEventType
  action: string
  data?: unknown
}

type ParsedEvents = { ok: true, events: IncomingEvent[], session?: string, client?: string } | { ok: false, error: string }

function parseEventList(body: unknown): ParsedEvents {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: '请求体必须是对象' }
  const raw = body as { events?: unknown, sessionId?: unknown, clientId?: unknown }
  const session = typeof raw.sessionId === 'string' && CLIENT_ID_PATTERN.test(raw.sessionId) ? raw.sessionId : undefined
  const client = typeof raw.clientId === 'string' && CLIENT_ID_PATTERN.test(raw.clientId) ? raw.clientId : undefined
  if (!Array.isArray(raw.events) || raw.events.length === 0) return { ok: false, error: 'events 必须是非空数组' }
  if (raw.events.length > DIAGNOSTICS_EVENTS_MAX) return { ok: false, error: '单次最多上报 ' + DIAGNOSTICS_EVENTS_MAX + ' 个事件' }
  const events: IncomingEvent[] = []
  for (const item of raw.events) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: '事件必须是对象' }
    const entry = item as { type?: unknown, action?: unknown, data?: unknown }
    if (typeof entry.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(entry.type)) return { ok: false, error: '事件 type 非法' }
    if (typeof entry.action !== 'string' || !ACTION_PATTERN.test(entry.action)) return { ok: false, error: '事件 action 非法' }
    if (entry.data !== undefined && (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data))) return { ok: false, error: '事件 data 必须是对象' }
    events.push({ type: entry.type as OperationEventType, action: entry.action, data: entry.data })
  }
  return { ok: true, events, session, client }
}

function boundedJson(value: unknown, maxLength = 1200): unknown {
  const sanitized = sanitizeOperationData(value)
  try {
    const text = JSON.stringify(sanitized)
    if (text.length > maxLength) return { truncated: true, preview: text.slice(0, maxLength) }
  } catch { return undefined }
  return sanitized
}

function parseLimit(raw: unknown): number {
  const text = Array.isArray(raw) ? raw[0] : raw
  const value = Number(text)
  if (!Number.isFinite(value)) return DIAGNOSTICS_TAIL_DEFAULT
  return Math.max(1, Math.min(DIAGNOSTICS_TAIL_MAX, Math.floor(value)))
}

export interface DiagnosticsApiResult {
  log: OperationLog
}

export function registerDiagnosticsApi(
  app: FastifyInstance,
  config: AppConfig,
  options?: { log?: OperationLog, version?: string },
): DiagnosticsApiResult {
  const dataDir = config.dataDir ?? dirname(config.databasePath)
  const log = options?.log ?? createOperationLog({ dataDir })
  const version = options?.version ?? serverVersion()

  app.post('/api/diagnostics/events', { config: { bodyLimit: 64 * 1024 } }, async (request, reply) => {
    const parsed = parseEventList(request.body)
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error, code: 'DIAGNOSTICS_INVALID_EVENTS' })
    for (const event of parsed.events) {
      await log.append({
        type: event.type,
        action: event.action,
        source: 'web',
        data: event.data,
        session: parsed.session,
        client: parsed.client,
      })
    }
    return { ok: true, written: parsed.events.length }
  })

  app.get('/api/diagnostics/info', async () => ({
    enabled: true,
    version,
    format: 'jsonl',
    logPath: log.filePath,
    logDir: log.dirPath,
    mainLogPath: join(log.dirPath, 'main.log'),
    tailMax: DIAGNOSTICS_TAIL_MAX,
    retention: { maxBytes: log.maxBytes, keepFiles: log.keepFiles },
    note: '仅保存在本机；不联网上传。',
  }))

  app.get('/api/diagnostics/tail', async (request) => {
    const limit = parseLimit((request.query as { limit?: unknown } | undefined)?.limit)
    const tail = await log.readTail(limit)
    return tail.ok ? { ok: true, lines: tail.lines } : { ok: false, error: tail.reason, lines: [] }
  })

  app.addHook('onResponse', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? ''
    if (!pathname.startsWith('/api/')) return
    if (pathname.startsWith('/api/diagnostics') || pathname === '/api/health') return
    const route = request.routeOptions?.url ?? pathname
    const source = request.method === 'GET' ? undefined : boundedJson(request.body)
    const query = request.query && Object.keys(request.query as object).length > 0 ? boundedJson(request.query) : undefined
    await log.append({
      type: 'api',
      action: request.method + ' ' + route,
      source: 'server',
      status: reply.statusCode,
      durationMs: reply.elapsedTime,
      data: { ...(query !== undefined ? { query } : {}), ...(source !== undefined ? { body: source } : {}) },
    })
  })

  return { log }
}
