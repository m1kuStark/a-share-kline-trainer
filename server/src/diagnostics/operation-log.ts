// DIAG-OPLOG-01（用户 2026-11-08 拍板）：本地操作日志，用于验收/问题定位与后续用户反馈。
// 边界：只写本机 <dataDir>/logs/operations.log（JSONL，滚动保留有限份）；不联网上传；
// 一律经 sanitizeOperationData 脱敏（token/secret/password/authorization/cookie/note 等键、
// 绝对路径、长度/深度/数组上限）；写失败只降级告警，绝不阻断业务。
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const OPERATION_LOG_DIR_NAME = 'logs'
export const OPERATION_LOG_FILE_NAME = 'operations.log'
export const OPERATION_LOG_DEFAULT_MAX_BYTES = 2 * 1024 * 1024
export const OPERATION_LOG_DEFAULT_KEEP_FILES = 4
export const OPERATION_LOG_MAX_STRING = 500
export const OPERATION_LOG_MAX_ARRAY = 30
export const OPERATION_LOG_MAX_KEYS = 40
export const OPERATION_LOG_MAX_DEPTH = 4

export type OperationSource = 'server' | 'web' | 'desktop'
export type OperationEventType = 'ui' | 'error' | 'lifecycle' | 'api' | 'desktop'

export interface OperationRecord {
  type: OperationEventType
  action: string
  source: OperationSource
  data?: unknown
  status?: number
  durationMs?: number
  session?: string
  client?: string
  ts?: string
}

export interface OperationLogDeps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  appendFile(path: string, data: string): Promise<void>
  readFile(path: string): Promise<string>
  stat(path: string): Promise<{ size: number }>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: true }): Promise<void>
  fallback?: { warn(...args: unknown[]): void }
}

export type OperationLogTail = { ok: true, lines: string[] } | { ok: false, reason: string }

export interface OperationLog {
  readonly dirPath: string
  readonly filePath: string
  readonly maxBytes: number
  readonly keepFiles: number
  append(record: OperationRecord): Promise<void>
  readTail(maxLines: number): Promise<OperationLogTail>
}

const REDACT_KEY = /(token|secret|password|authorization|cookie|note|remark|comment|content)/i
const WINDOWS_ABS_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/
const REDACTED = '<redacted>'
const TRUNCATED = '<truncated>'

function capString(value: string): string {
  return value.length > OPERATION_LOG_MAX_STRING ? value.slice(0, OPERATION_LOG_MAX_STRING - 1) + '…' : value
}

function redactPath(value: string): string {
  if (!WINDOWS_ABS_PATH.test(value)) return value
  const parts = value.split(/[\\/]+/).filter(Boolean)
  const tail = parts.at(-1) ?? ''
  return tail ? '<path:' + capString(tail) + '>' : '<path>'
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value
  if (depth > OPERATION_LOG_MAX_DEPTH) return TRUNCATED
  if (typeof value === 'string') return capString(redactPath(value))
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return capString(value.toString())
  if (Buffer.isBuffer(value)) return '<binary:' + value.length + ' bytes>'
  if (Array.isArray(value)) return value.slice(0, OPERATION_LOG_MAX_ARRAY).map(item => sanitizeValue(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, item] of entries.slice(0, OPERATION_LOG_MAX_KEYS)) {
      if (REDACT_KEY.test(key)) { result[key] = REDACTED; continue }
      const sanitized = sanitizeValue(item, depth + 1)
      if (sanitized !== undefined) result[key] = sanitized
    }
    return result
  }
  return capString(String(value))
}

/** 导出给 API/测试：脱敏任意记录数据（不修改输入）。 */
export function sanitizeOperationData(value: unknown): unknown {
  return sanitizeValue(value, 0)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try { return String(error) } catch { return '(unstringifiable error)' }
}

function isNoEnt(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function nodeDeps(): OperationLogDeps {
  return {
    mkdir, appendFile, stat, rename, rm,
    readFile: (path: string) => readFile(path, 'utf8'),
  }
}

export function createOperationLog(options: {
  dataDir: string
  deps?: OperationLogDeps
  maxBytes?: number
  keepFiles?: number
}): OperationLog {
  const deps = options.deps ?? nodeDeps()
  const dirPath = join(options.dataDir, OPERATION_LOG_DIR_NAME)
  const filePath = join(dirPath, OPERATION_LOG_FILE_NAME)
  const maxBytes = Math.max(256, options.maxBytes ?? OPERATION_LOG_DEFAULT_MAX_BYTES)
  const keepFiles = Math.max(2, options.keepFiles ?? OPERATION_LOG_DEFAULT_KEEP_FILES)
  let queue: Promise<void> = Promise.resolve()

  const warn = (error: unknown): void => {
    deps.fallback?.warn('[diagnostics] 操作日志写入失败（降级仅继续业务）:', errorMessage(error))
  }

  const rotate = async (): Promise<void> => {
    try {
      await deps.rm(join(dirPath, OPERATION_LOG_FILE_NAME + '.' + (keepFiles - 1)), { force: true })
      for (let index = keepFiles - 2; index >= 1; index -= 1) {
        try {
          await deps.rename(join(dirPath, OPERATION_LOG_FILE_NAME + '.' + index), join(dirPath, OPERATION_LOG_FILE_NAME + '.' + (index + 1)))
        } catch (error) {
          if (!isNoEnt(error)) warn(error)
        }
      }
      try {
        await deps.rename(filePath, join(dirPath, OPERATION_LOG_FILE_NAME + '.1'))
      } catch (error) {
        if (!isNoEnt(error)) warn(error)
      }
    } catch (error) {
      warn(error)
    }
  }

  const append = (record: OperationRecord): Promise<void> => {
    const row = {
      v: 1,
      ts: record.ts ?? new Date().toISOString(),
      type: record.type,
      action: capString(record.action),
      source: record.source,
      ...(record.status !== undefined ? { status: record.status } : {}),
      ...(record.durationMs !== undefined ? { durationMs: Math.max(0, Math.round(record.durationMs)) } : {}),
      ...(record.session ? { session: capString(record.session) } : {}),
      ...(record.client ? { client: capString(record.client) } : {}),
      ...(record.data !== undefined ? { data: sanitizeOperationData(record.data) } : {}),
    }
    queue = queue.then(async () => {
      try {
        await deps.mkdir(dirPath, { recursive: true })
        const size = await deps.stat(filePath).then(result => result.size, () => 0)
        if (size >= maxBytes) await rotate()
        await deps.appendFile(filePath, JSON.stringify(row) + '\n')
      } catch (error) {
        warn(error)
      }
    })
    return queue
  }

  const readTail = async (maxLines: number): Promise<OperationLogTail> => {
    try {
      const raw = await deps.readFile(filePath)
      const lines = raw.split(/\r?\n/).filter(Boolean)
      const limit = Math.max(0, Math.min(500, Math.floor(maxLines)))
      return { ok: true, lines: limit === 0 ? [] : lines.slice(-limit) }
    } catch (error) {
      if (isNoEnt(error)) return { ok: true, lines: [] }
      return { ok: false, reason: errorMessage(error) }
    }
  }

  return { dirPath, filePath, maxBytes, keepFiles, append, readTail }
}
