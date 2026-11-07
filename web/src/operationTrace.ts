// DIAG-OPLOG-01：Web 端本地操作埋点（验收/问题定位）。
// 只采集「点击目标标签、页面错误、生命周期」等机器可读事件，绝不采集输入框文本、
// 交易备注或任何内容字段；事件批量 POST 到本机 /api/diagnostics/events，由服务端
// 脱敏后写入 <dataDir>/logs/operations.log。发送失败静默丢弃，绝不阻断 UI。
export const OPLOG_CLIENT_KEY = 'trainer.oplog.client.v1'
export const OPLOG_FLUSH_MS = 2000
export const OPLOG_BATCH_SIZE = 20
export const OPLOG_MAX_QUEUE = 200
export const OPLOG_ENDPOINT = '/api/diagnostics/events'

export interface ClickLabel { label: string, tag: string }

interface ClickElementLike {
  closest?(selector: string): ClickElementLike | null
  getAttribute?(name: string): string | null
  textContent?: string | null
  tagName?: string | null
}

function safeId(factory: () => string, storage?: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  try {
    const existing = storage?.getItem(OPLOG_CLIENT_KEY)
    if (existing) return existing
    const created = factory()
    storage?.setItem(OPLOG_CLIENT_KEY, created)
    return created
  } catch {
    return factory()
  }
}

function randomId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}

/** 从点击目标提取稳定标签：data-op > aria-label > 可见文本 > title；无标签返回 null。 */
export function selectClickLabel(target: ClickElementLike | null | undefined): ClickLabel | null {
  if (!target) return null
  const element = target.closest?.('button,[role="tab"],[role="button"],[role="menuitem"],[data-op]') ?? null
  if (!element) return null
  if (element.getAttribute?.('data-oplog-ignore') !== null && element.getAttribute?.('data-oplog-ignore') !== undefined) return null
  const candidates = [
    element.getAttribute?.('data-op'),
    element.getAttribute?.('aria-label'),
    (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    element.getAttribute?.('title'),
  ]
  const label = candidates.map(value => (value ?? '').trim()).find(Boolean)
  if (!label) return null
  return { label: label.slice(0, 40), tag: String(element.tagName ?? '').toLowerCase() }
}

export interface OperationTrace {
  track(type: 'ui' | 'error' | 'lifecycle' | 'desktop', action: string, data?: Record<string, unknown>): void
  flush(): Promise<void>
  dispose(): void
  queueSize(): number
  clientId(): string
  sessionId(): string
}

export interface OperationTraceOptions {
  endpoint?: string
  win?: Window & typeof globalThis
  doc?: Document
  fetchImpl?: typeof fetch
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => number
  randomIdImpl?: () => string
  flushMs?: number
}

/** 安装埋点（浏览器/Electron 渲染进程）；返回可手动 flush/dispose 的句柄。 */
export function installOperationTrace(options: OperationTraceOptions = {}): OperationTrace {
  const win = options.win ?? (typeof window !== 'undefined' ? window : undefined)
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined)
  const endpoint = options.endpoint ?? OPLOG_ENDPOINT
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)
  const now = options.now ?? (() => Date.now())
  const idFactory = options.randomIdImpl ?? randomId
  let storage: Pick<Storage, 'getItem' | 'setItem'> | null = options.storage ?? null
  if (storage === null && typeof window !== 'undefined') {
    try { storage = window.localStorage } catch { storage = null }
  }
  const client = safeId(idFactory, storage)
  const session = idFactory()
  let queue: Array<{ type: string, action: string, data?: Record<string, unknown>, at: number }> = []
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const flush = async (): Promise<void> => {
    if (queue.length === 0 || !fetchImpl) return
    const events = queue.splice(0, Math.min(queue.length, OPLOG_BATCH_SIZE)).map(event => ({
      type: event.type, action: event.action, data: event.data,
    }))
    try {
      await fetchImpl(endpoint, {
        method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: client, sessionId: session, events }),
      })
    } catch { /* 诊断失败静默丢弃，不影响业务 */ }
  }

  const track: OperationTrace['track'] = (type, action, data) => {
    if (disposed) return
    if (queue.length >= OPLOG_MAX_QUEUE) queue.shift()
    queue.push({ type, action, data, at: now() })
    if (queue.length >= OPLOG_BATCH_SIZE) void flush()
  }

  const clickHandler = (event: Event): void => {
    const label = selectClickLabel(event.target as ClickElementLike)
    if (label) track('ui', 'click', label as unknown as Record<string, unknown>)
  }
  const errorHandler = (event: ErrorEvent): void => {
    track('error', 'window.error', { message: String(event.message ?? '').slice(0, 300), source: String(event.filename ?? '').slice(0, 120) })
  }
  const rejectionHandler = (event: PromiseRejectionEvent): void => {
    const reason = event.reason as { message?: unknown } | null
    track('error', 'unhandledrejection', { message: String(reason?.message ?? reason ?? '').slice(0, 300) })
  }
  const hideHandler = (): void => { track('lifecycle', 'page.hide'); void flush() }

  if (win) {
    win.addEventListener('click', clickHandler, true)
    win.addEventListener('error', errorHandler)
    win.addEventListener('unhandledrejection', rejectionHandler as EventListener)
    win.addEventListener('pagehide', hideHandler)
    timer = setInterval(() => { void flush() }, options.flushMs ?? OPLOG_FLUSH_MS)
  }
  track('lifecycle', 'app.ready', { client, session })

  return {
    track, flush,
    dispose: () => {
      disposed = true
      if (timer) clearInterval(timer)
      if (win) {
        win.removeEventListener('click', clickHandler, true)
        win.removeEventListener('error', errorHandler)
        win.removeEventListener('unhandledrejection', rejectionHandler as EventListener)
        win.removeEventListener('pagehide', hideHandler)
      }
    },
    queueSize: () => queue.length,
    clientId: () => client,
    sessionId: () => session,
  }
}
