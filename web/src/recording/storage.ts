// REC-01 录制存储：MemoryRecordingStorage（测试/注入故障）与 IndexedDbRecordingStorage（生产）
// 存储接口见 docs/engineering/recording-contract.md；只依赖 ./types 的纯类型。
import type { RecordingFile, RecordingStorage, RecordingSummary } from './types'

function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * 内存存储：供测试与无持久化环境使用。
 * failWith 注入保存故障；loadFailure 注入读取故障；onSave 可观察每次落库快照并延迟其完成。
 */
export class MemoryRecordingStorage implements RecordingStorage {
  readonly records = new Map<string, RecordingFile>()
  onSave: (file: RecordingFile) => void | Promise<void> = () => {}
  loadFailure: Error | null = null
  private saveFailure: Error | null = null

  failWith(error: Error | null): void {
    this.saveFailure = error
  }

  async save(file: RecordingFile): Promise<void> {
    if (this.saveFailure) throw this.saveFailure
    await this.onSave(file)
    this.records.set(file.sessionId, clone(file))
  }

  async load(id: string): Promise<RecordingFile | null> {
    if (this.loadFailure) throw this.loadFailure
    const file = this.records.get(id)
    return file ? clone(file) : null
  }

  async list(): Promise<RecordingSummary[]> {
    return [...this.records.values()]
      .map(toSummary)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}

export const RECORDING_DB_NAME = 'trainer-recordings'
export const RECORDING_STORE_NAME = 'sessions'

function describeDbError(error: DOMException | null): string {
  return error?.message ?? '未知错误'
}

function openRecordingDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB，无法持久化录制会话。'))
      return
    }
    const request = indexedDB.open(RECORDING_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDING_STORE_NAME)) {
        db.createObjectStore(RECORDING_STORE_NAME, { keyPath: 'sessionId' })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(new Error(`打开录制会话数据库失败：${describeDbError(request.error)}`))
    request.onblocked = () => reject(new Error('录制会话数据库被其他标签页占用，请关闭本站点其他标签页后重试。'))
  })
}

function putAndWait(db: IDBDatabase, file: RecordingFile): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE_NAME, 'readwrite')
    tx.objectStore(RECORDING_STORE_NAME).put(file)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error(`保存录制会话失败：${describeDbError(tx.error)}`))
    tx.onabort = () => reject(new Error(`保存录制会话被中止：${describeDbError(tx.error)}`))
  })
}

function getAndWait<T>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE_NAME, 'readonly')
    const request = tx.objectStore(RECORDING_STORE_NAME).get(id)
    tx.oncomplete = () => resolve(request.result as T | undefined)
    tx.onerror = () => reject(new Error(`读取录制会话失败：${describeDbError(tx.error)}`))
    tx.onabort = () => reject(new Error(`读取录制会话被中止：${describeDbError(tx.error)}`))
  })
}

function getAllAndWait<T>(db: IDBDatabase): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE_NAME, 'readonly')
    const request = tx.objectStore(RECORDING_STORE_NAME).getAll()
    tx.oncomplete = () => resolve((request.result ?? []) as T[])
    tx.onerror = () => reject(new Error(`读取录制会话列表失败：${describeDbError(tx.error)}`))
    tx.onabort = () => reject(new Error(`读取录制会话列表被中止：${describeDbError(tx.error)}`))
  })
}

function toSummary(file: RecordingFile): RecordingSummary {
  return {
    sessionId: file.sessionId,
    trainingKey: file.trainingKey,
    createdAt: file.createdAt,
    eventCount: file.events.length,
  }
}

/**
 * 生产 IndexedDB 存储：单 objectStore，以 sessionId 为 keyPath。
 * 每个标签页的 Recorder 生成各自 sessionId，put 按 sessionId 覆盖互不影响。
 * save 仅在事务 complete 后 resolve（put 成功不代表事务已提交）。
 */
export class IndexedDbRecordingStorage implements RecordingStorage {
  private dbPromise: Promise<IDBDatabase> | null = null

  static get supported(): boolean {
    return typeof indexedDB !== 'undefined'
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openRecordingDb()
    return this.dbPromise
  }

  async save(file: RecordingFile): Promise<void> {
    const db = await this.open()
    await putAndWait(db, file)
  }

  async load(id: string): Promise<RecordingFile | null> {
    const db = await this.open()
    const file = await getAndWait<RecordingFile>(db, id)
    return file ?? null
  }

  async list(): Promise<RecordingSummary[]> {
    const db = await this.open()
    const files = await getAllAndWait<RecordingFile>(db)
    return files
      .map(toSummary)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  close(): void {
    if (!this.dbPromise) return
    void this.dbPromise.then(db => db.close()).catch(() => {})
  }
}
