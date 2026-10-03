import type { CompactRecordingFile } from './compactTypes'
import type { RecordingLibraryItem } from './libraryTypes'

interface ImportedRecordingEntry extends RecordingLibraryItem {
  source: 'imported'
  recording: CompactRecordingFile
}
export interface ImportedRecordingStorage {
  save(file: CompactRecordingFile, fileName: string): Promise<RecordingLibraryItem>
  load(id: string): Promise<CompactRecordingFile | null>
  list(): Promise<RecordingLibraryItem[]>
  remove(id: string): Promise<void>
}

function newEntry(file: CompactRecordingFile, fileName: string): ImportedRecordingEntry {
  const id = `imported-${crypto.randomUUID()}`
  return {
    sessionId: id, source: 'imported', originalSessionId: file.sessionId, importedAt: new Date().toISOString(),
    fileName, createdAt: file.createdAt, trainingKey: file.trainingKey, eventCount: file.events.length,
    recording: { ...file, sessionId: id },
  }
}
function summary(entry: ImportedRecordingEntry): RecordingLibraryItem {
  const { recording: _recording, ...item } = entry
  return item
}

export class IndexedDbImportedRecordingStorage implements ImportedRecordingStorage {
  private connection: Promise<IDBDatabase> | null = null
  constructor(private readonly databaseName: string) {}

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB，无法保存导入录像'))
        return
      }
      let settled = false
      const request = indexedDB.open(this.databaseName, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        const upgrade = request.transaction
        if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'sessionId' })
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'sessionId' })
        // v1 stored summary and payload together in `imports`. Preserve those
        // rows when upgrading; the legacy store can remain for rollback safety.
        if (upgrade && db.objectStoreNames.contains('imports')) {
          const summaries = upgrade.objectStore('summaries')
          const recordings = upgrade.objectStore('recordings')
          const cursorRequest = upgrade.objectStore('imports').openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            const entry = cursor.value as ImportedRecordingEntry
            summaries.put(summary(entry))
            recordings.put(entry.recording)
            cursor.continue()
          }
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); if (this.connection === opening) this.connection = null }
        if (settled) { db.close(); return }
        settled = true
        resolve(db)
      }
      request.onerror = () => {
        if (settled) return
        settled = true
        reject(new Error(`打开导入录像库失败：${request.error?.message ?? '未知错误'}`))
      }
      request.onblocked = () => {
        if (settled) return
        settled = true
        reject(new Error('导入录像库被其他页面占用，请关闭其他训练器页面后重试'))
      }
    })
    this.connection = opening
    void opening.catch(() => { if (this.connection === opening) this.connection = null })
    return opening
  }

  private async transaction<T>(stores: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => () => T): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      tx.onerror = () => reject(new Error(`处理导入录像失败：${tx.error?.message ?? '未知错误'}`))
      tx.onabort = () => reject(new Error(`导入录像事务已中止：${tx.error?.message ?? '未知错误'}`))
      try {
        const result = operation(tx)
        tx.oncomplete = () => resolve(result())
      } catch (error) {
        tx.abort()
        reject(error)
      }
    })
  }

  async save(file: CompactRecordingFile, fileName: string): Promise<RecordingLibraryItem> {
    const entry = newEntry(file, fileName)
    const item = summary(entry)
    return this.transaction(['summaries', 'recordings'], 'readwrite', tx => {
      tx.objectStore('summaries').add(item)
      tx.objectStore('recordings').add(entry.recording)
      return () => item
    })
  }
  async load(id: string): Promise<CompactRecordingFile | null> {
    return this.transaction(['recordings'], 'readonly', tx => {
      const request = tx.objectStore('recordings').get(id) as IDBRequest<CompactRecordingFile | undefined>
      return () => request.result ?? null
    })
  }
  async list(): Promise<RecordingLibraryItem[]> {
    return this.transaction(['summaries'], 'readonly', tx => {
      const request = tx.objectStore('summaries').getAll() as IDBRequest<RecordingLibraryItem[]>
      return () => request.result
    })
  }
  async remove(id: string): Promise<void> {
    await this.transaction(['summaries', 'recordings'], 'readwrite', tx => {
      tx.objectStore('summaries').delete(id)
      tx.objectStore('recordings').delete(id)
      return () => undefined
    })
  }
  close(): void {
    const connection = this.connection
    this.connection = null
    void connection?.then(db => db.close()).catch(() => {})
  }
}

export class MemoryImportedRecordingStorage implements ImportedRecordingStorage {
  readonly entries = new Map<string, ImportedRecordingEntry>()
  async save(file: CompactRecordingFile, fileName: string): Promise<RecordingLibraryItem> {
    const entry = structuredClone(newEntry(file, fileName))
    this.entries.set(entry.sessionId, entry)
    return summary(entry)
  }
  async load(id: string): Promise<CompactRecordingFile | null> { return structuredClone(this.entries.get(id)?.recording ?? null) }
  async list(): Promise<RecordingLibraryItem[]> { return [...this.entries.values()].map(summary) }
  async remove(id: string): Promise<void> { this.entries.delete(id) }
}
