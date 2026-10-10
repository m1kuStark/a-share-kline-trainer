// MIG-01 v1.2.7→v1.3.0 迁移导出核心：读取老版本同源 IndexedDB，汇总为 REC-BULK 合并包。
// 契约：web/src/recording/recording-file.md「录像合并包」节＋「迁移工具载荷适配」附录。
// 校验/转换直接 import 仓库正源（validation/compactCodec/compactValidation 与 v1.2.7 逐字段一致，
// 仅 main 的枚举集合是其超集——v1.2.7 合法录像必然通过 main 导入校验，见任务卡核对记录）。
// IndexedDB 访问一律「无版本号 open」：绝不触发 upgrade、绝不写老库（真实数据只读铁律）；
// 打开不存在的库会创建空 v1 壳，检测到后立即 close+deleteDatabase 清理自建残留。
import { compactRecording } from '../../../web/src/recording/compactCodec'
import { validateCompactRecording } from '../../../web/src/recording/compactValidation'
import type { CompactRecordingFile } from '../../../web/src/recording/compactTypes'
import { configureRecordingDbNamespace, getRecordingDbName } from '../../../web/src/recording/storage'
import { validateRecording } from '../../../web/src/recording/validation'

/** 与 v1.2.7 loadLocalRecording 同口径的旧录像迁移检查点预算 */
export const LEGACY_MAX_CHECKPOINTS = 20_000

/** 本工具产出的合并包格式常量（与 web/src/recording/bundle.ts 保持一致；不 import 以免拉入 File API 面） */
export const MIGRATION_BUNDLE_FORMAT = 'trainer-recordings-bundle'
export const MIGRATION_BUNDLE_VERSION = 1

export interface MigrationBundle {
  format: typeof MIGRATION_BUNDLE_FORMAT
  version: typeof MIGRATION_BUNDLE_VERSION
  exportedAt: string
  items: unknown[]
}

/** 单条导出条目的页面清单行 */
export interface MigrationItemSummary {
  sessionId: string
  source: 'local-compact' | 'local-legacy' | 'local-legacy-raw' | 'imported' | 'imported-raw'
  eventCount: number
  createdAt: unknown
  trainingKey: string | null
  /** 原样入包原因（转换/校验失败，不静默丢弃；新版导入时会如实计为失败） */
  note?: string
}

/** 扫描结果：items 进合并包；failures 为结构性损坏（无法组出单条载荷，只能如实报告） */
export interface MigrationScanOutcome {
  items: unknown[]
  summaries: MigrationItemSummary[]
  failures: Array<{ sessionId: string; reason: string }>
}

// ===== compact 行重组（compactStorage.ts assemble 的只读镜像；原函数未导出且该文件不属本任务可改范围） =====

const RESOURCE_KINDS = ['series', 'drawings', 'trainingMeta', 'accounts', 'trades', 'contexts'] as const
type ResourceKind = (typeof RESOURCE_KINDS)[number]
type CompactRecordKind = 'event' | 'checkpoint' | ResourceKind
const RECORD_KINDS = ['event', 'checkpoint', ...RESOURCE_KINDS] as const

interface CompactCountsShape {
  events: number
  checkpoints: number
  series: number
  drawings: number
  trainingMeta: number
  accounts: number
  trades: number
  contexts: number
}

function entryIdentityOf(kind: CompactRecordKind, value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as Record<string, unknown>)[kind === 'event' ? 'opId' : 'id']
  return typeof id === 'string' && id !== '' ? id : null
}

function countsKeyOf(kind: CompactRecordKind): keyof CompactCountsShape {
  return kind === 'event' ? 'events' : kind === 'checkpoint' ? 'checkpoints' : kind
}

/** 重组紧凑文件：行下标连续、身份合法、行数与 header.counts 精确一致；错误文案与 compactStorage.assemble 一致 */
export function assembleCompactSession(header: Record<string, unknown>, rows: Array<Record<string, unknown>>): CompactRecordingFile {
  const sessionId = String(header.sessionId ?? '')
  const counts = (header.counts ?? {}) as Record<string, unknown>
  const byKind = new Map<CompactRecordKind, Map<number, unknown>>(RECORD_KINDS.map(kind => [kind, new Map()]))
  for (const row of rows) {
    const kind = row.kind as CompactRecordKind
    const bucket = byKind.get(kind)
    if (!bucket) {
      throw new Error(`会话 ${sessionId} 持久记录损坏：存在未知 kind「${String(row.kind)}」的记录行，拒绝加载。`)
    }
    if (entryIdentityOf(kind, row.value) === null) {
      throw new Error(`会话 ${sessionId} 持久记录损坏：${kind} #${String(row.index)} 的条目缺少合法 id/opId，拒绝加载。`)
    }
    const index = row.index as number
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error(`会话 ${sessionId} 持久记录损坏：${kind} 行下标 ${String(row.index)} 非法，拒绝加载。`)
    }
    if (bucket.has(index)) {
      throw new Error(`会话 ${sessionId} 持久记录损坏：${kind} #${index} 出现重复行，拒绝加载。`)
    }
    bucket.set(index, row.value)
  }
  for (const kind of RECORD_KINDS) {
    const bucket = byKind.get(kind)!
    const count = counts[countsKeyOf(kind)]
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`会话 ${sessionId} 持久记录损坏：header.counts.${countsKeyOf(kind)} 非法（${String(count)}），拒绝加载。`)
    }
    if (bucket.size !== count) {
      throw new Error(`会话 ${sessionId} 持久记录损坏：${kind} 行数 ${bucket.size} 与 header.counts ${count} 不一致，拒绝加载。`)
    }
    for (let index = 0; index < count; index++) {
      if (!bucket.has(index)) {
        throw new Error(`会话 ${sessionId} 持久记录损坏：${kind} 缺少下标 ${index} 的记录行（counts=${count}），拒绝加载。`)
      }
    }
  }
  const resources: Record<string, unknown[]> = {}
  for (const kind of RESOURCE_KINDS) {
    const list: unknown[] = []
    const bucket = byKind.get(kind)!
    const count = counts[kind] as number
    for (let index = 0; index < count; index++) list.push(bucket.get(index))
    resources[kind] = list
  }
  const events: unknown[] = []
  for (let index = 0; index < (counts.events as number); index++) events.push(byKind.get('event')!.get(index))
  const checkpoints: unknown[] = []
  for (let index = 0; index < (counts.checkpoints as number); index++) checkpoints.push(byKind.get('checkpoint')!.get(index))
  return {
    format: 'trainer-session',
    schemaVersion: header.schemaVersion as 2 | 3,
    sessionId,
    createdAt: header.createdAt as string,
    app: header.app,
    environment: header.environment,
    trainingKey: (header.trainingKey ?? null) as string | null,
    events: events as never,
    checkpoints: checkpoints as never,
    gaps: header.gaps,
    complete: header.complete as boolean,
    resources: resources as never,
  }
}

// ===== 旧 v1 会话转换（与 v1.2.7 recordingRepository.load 的迁移链一致，但不回写老库） =====

export function convertLegacySession(raw: unknown): { ok: true; file: CompactRecordingFile } | { ok: false; error: string } {
  try {
    const legacy = validateRecording(raw, { maxCheckpoints: LEGACY_MAX_CHECKPOINTS })
    const migrated = compactRecording(legacy)
    return { ok: true, file: validateCompactRecording(migrated) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ===== IndexedDB 只读访问（无版本 open；不存在则清理自建空壳后返回 null） =====

function idb(): { open(name: string): IDBOpenDBRequest; deleteDatabase(name: string): IDBOpenDBRequest; databases?(): Promise<Array<{ name?: string }>> } {
  const scope = globalThis as unknown as { indexedDB?: never }
  if (!scope.indexedDB) throw new Error('当前环境不支持 IndexedDB，无法读取训练录像。')
  return scope.indexedDB as never
}

export function trainerDbNameFor(namespace: string): string {
  configureRecordingDbNamespace(namespace)
  return getRecordingDbName()
}

/** 列出当前 profile+origin 下全部库名；浏览器不支持 databases() 时返回 null（退化为按已知库名直开） */
export async function listIndexedDbNames(): Promise<string[] | null> {
  const api = idb() as { databases?: () => Promise<Array<{ name?: string }>> }
  if (typeof api.databases !== 'function') return null
  try {
    const found = await api.databases()
    return found.map(entry => entry.name).filter((name): name is string => typeof name === 'string')
  } catch {
    return null
  }
}

/** 找出形如 trainer-recordings.<ns> 的本机录像主库（排除 .imports 后缀），供无 namespace 时的页面发现 */
export function discoverTrainerDbNames(names: string[]): { main: string; imports: string }[] {
  const result: { main: string; imports: string }[] = []
  for (const name of names) {
    if (!name.startsWith('trainer-recordings.')) continue
    if (name.endsWith('.imports')) continue
    result.push({ main: name, imports: `${name}.imports` })
  }
  return result
}

export interface OpenedDatabase {
  db: IDBDatabase
  version: number
  storeNames: string[]
}

export function openExistingDatabase(name: string): Promise<OpenedDatabase | null> {
  return new Promise(resolve => {
    let request: IDBOpenDBRequest
    try {
      request = idb().open(name)
    } catch {
      resolve(null)
      return
    }
    request.onsuccess = () => {
      const db = request.result
      // 无版本 open 一个不存在的库会创建空 v1 壳：识别后清理自建残留，绝不留下污染
      if (db.version === 1 && db.objectStoreNames.length === 0) {
        db.close()
        try {
          void idb().deleteDatabase(name)
        } catch { /* 清理失败不影响主流程 */ }
        resolve(null)
        return
      }
      resolve({ db, version: db.version, storeNames: [...db.objectStoreNames] })
    }
    request.onerror = () => resolve(null)
  })
}

function waitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function waitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
  })
}

/** 只读读取一个 store 的全部行（可选区间）；事务 complete 后才返回 */
async function readAll<T>(db: IDBDatabase, storeName: string, range?: IDBKeyRange): Promise<T[]> {
  const tx = db.transaction([storeName], 'readonly')
  const pending = waitRequest(tx.objectStore(storeName).getAll(range) as IDBRequest<T[]>)
  await waitTransaction(tx)
  return pending
}

function sessionRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, ''], [sessionId, '\uffff'])
}

// ===== 扫描编排 =====

function summaryOf(payload: { sessionId?: unknown; events?: unknown[]; createdAt?: unknown; trainingKey?: unknown }, source: MigrationItemSummary['source'], note?: string): MigrationItemSummary {
  return {
    sessionId: String(payload.sessionId ?? '(未知)'),
    source,
    eventCount: Array.isArray(payload.events) ? payload.events.length : 0,
    createdAt: payload.createdAt ?? '',
    trainingKey: typeof payload.trainingKey === 'string' ? payload.trainingKey : null,
    note,
  }
}

/**
 * 扫描一个已打开的老版本录像主库（v1 sessions + v2 compactSessions/compactRecords）与
 * 可选的导入分享库（recordings / 旧 imports store），产出合并包条目与清单。
 * 同 sessionId 优先 compact（v1.2.7 list() 同语义）；旧 v1 行只读转换、绝不回写。
 */
export async function collectMigrationItems(main: OpenedDatabase, imports: OpenedDatabase | null): Promise<MigrationScanOutcome> {
  const outcome: MigrationScanOutcome = { items: [], summaries: [], failures: [] }
  const has = (opened: OpenedDatabase, store: string) => opened.storeNames.includes(store)

  const headers = has(main, 'compactSessions') ? await readAll<Record<string, unknown>>(main.db, 'compactSessions') : []
  const legacyFiles = has(main, 'sessions') ? await readAll<Record<string, unknown>>(main.db, 'sessions') : []
  const compactIds = new Set(headers.map(header => String(header.sessionId)))

  for (const header of headers) {
    const sessionId = String(header.sessionId ?? '')
    try {
      const rows = has(main, 'compactRecords')
        ? await readAll<Record<string, unknown>>(main.db, 'compactRecords', sessionId ? sessionRange(sessionId) : undefined)
        : []
      const assembled = assembleCompactSession(header, rows)
      try {
        outcome.items.push(validateCompactRecording(assembled))
        outcome.summaries.push(summaryOf(assembled, 'local-compact'))
      } catch (error) {
        outcome.items.push(assembled)
        outcome.summaries.push(summaryOf(assembled, 'local-compact', `校验失败原样入包：${error instanceof Error ? error.message : String(error)}`))
      }
    } catch (error) {
      outcome.failures.push({ sessionId, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  for (const legacy of legacyFiles) {
    const sessionId = String(legacy.sessionId ?? '')
    if (compactIds.has(sessionId)) continue // compact 为权威，v1.2.7 同语义
    const converted = convertLegacySession(legacy)
    if (converted.ok) {
      outcome.items.push(converted.file)
      outcome.summaries.push(summaryOf(converted.file, 'local-legacy', '旧 v1 格式已转换为 v2'))
    } else {
      outcome.items.push(legacy)
      outcome.summaries.push(summaryOf(legacy, 'local-legacy-raw', `转换失败原样入包：${converted.error}`))
    }
  }

  if (imports) {
    if (has(imports, 'recordings')) {
      const stored = await readAll<Record<string, unknown>>(imports.db, 'recordings')
      for (const recording of stored) {
        try {
          outcome.items.push(validateCompactRecording(recording))
          outcome.summaries.push(summaryOf(recording, 'imported'))
        } catch (error) {
          outcome.items.push(recording)
          outcome.summaries.push(summaryOf(recording, 'imported-raw', `校验失败原样入包：${error instanceof Error ? error.message : String(error)}`))
        }
      }
    } else if (has(imports, 'imports')) {
      // v1 导入库（summaries/recordings 尚未升级的更老形态）：载荷在 entry.recording
      const entries = await readAll<{ sessionId?: unknown; recording?: unknown }>(imports.db, 'imports')
      for (const entry of entries) {
        const recording = entry.recording
        if (!recording || typeof recording !== 'object') {
          outcome.failures.push({ sessionId: String(entry.sessionId ?? '(未知)'), reason: '旧导入记录缺少 recording 载荷' })
          continue
        }
        try {
          outcome.items.push(validateCompactRecording(recording))
          outcome.summaries.push(summaryOf(recording as { sessionId?: unknown }, 'imported'))
        } catch (error) {
          outcome.items.push(recording)
          outcome.summaries.push(summaryOf(recording as { sessionId?: unknown }, 'imported-raw', `校验失败原样入包：${error instanceof Error ? error.message : String(error)}`))
        }
      }
    }
  }

  outcome.summaries.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  return outcome
}

// ===== 合并包组装（格式与 web/src/recording/bundle.ts 一致；原样入包条目不重复校验——导入端逐条容错） =====

export function buildMigrationBundle(items: unknown[], now: Date = new Date()): MigrationBundle {
  if (!items.length) throw new Error('库中没有录像，无法导出合并包')
  return {
    format: MIGRATION_BUNDLE_FORMAT,
    version: MIGRATION_BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    items,
  }
}

/** 合并包文件名（与新版全部导出的命名约定一致） */
export function migrationBundleFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
  return `训练录像库-${stamp}.trainer-recordings.json`
}

/** 触发浏览器下载（a[download]；不使用 showSaveFilePicker 以保持自动化可驱动） */
export function downloadMigrationBundle(bundle: MigrationBundle): { blob: Blob; fileName: string } {
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
  const fileName = migrationBundleFileName()
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 60_000)
  return { blob, fileName }
}
