import { compactRecording } from './compactCodec'
import { validateCompactRecording } from './compactValidation'
import { IndexedDbCompactStorage, type CompactRecordingStorage } from './compactStorage'
import type { CompactRecordingFile } from './compactTypes'
import type { RecordingFile } from './types'
import { IndexedDbImportedRecordingStorage, type ImportedRecordingStorage } from './importedStorage'
import type { RecordingLibraryItem, RecordingRemovalResult, RecordingSource } from './libraryTypes'
import { acquireRecordingLease } from './recordingLease'
import { configureRecordingDbNamespace, getRecordingDbName } from './storage'
import { validateRecording } from './validation'

export type { RecordingLibraryItem, RecordingRemovalResult, RecordingSource } from './libraryTypes'

let namespace = ''
export let recordingStorage = new IndexedDbCompactStorage(() => {
  throw new Error('录像库尚未完成安装隔离初始化，请稍后重试')
})
let importedStorage: IndexedDbImportedRecordingStorage | null = null
let repository: RecordingLibraryRepository | null = null

/** Replace instances so an existing recorder can never start writing to a different namespace. */
export function configureRecordingNamespace(value: string): void {
  if (!value.trim()) throw new Error('录像库命名空间为空，拒绝访问未隔离的本机录像')
  if (namespace === value) return
  configureRecordingDbNamespace(value)
  const databaseName = getRecordingDbName()
  recordingStorage.close()
  importedStorage?.close()
  namespace = value
  recordingStorage = new IndexedDbCompactStorage(databaseName)
  importedStorage = new IndexedDbImportedRecordingStorage(`${databaseName}.imports`)
  repository = new RecordingLibraryRepository(recordingStorage, importedStorage, acquireRecordingLease)
}
export function recordingNamespaceKey(key: string): string {
  if (!namespace) throw new Error('录像库尚未完成安装隔离初始化，请稍后重试')
  return `${key}.${namespace}`
}

export class RecordingLibraryRepository {
  constructor(
    private readonly local: CompactRecordingStorage,
    private readonly imports: ImportedRecordingStorage,
    private readonly acquireLease: (id: string) => Promise<(() => void) | null>,
  ) {}
  async list(): Promise<RecordingLibraryItem[]> {
    const [local, imported] = await Promise.all([this.local.list(), this.imports.list()])
    const items: RecordingLibraryItem[] = [...local.map(item => ({ ...item, source: 'local' as const })), ...imported]
    return items.sort((a, b) => (b.importedAt ?? b.createdAt).localeCompare(a.importedAt ?? a.createdAt))
  }
  async import(file: CompactRecordingFile, fileName: string): Promise<RecordingLibraryItem> {
    return this.imports.save(validateCompactRecording(file), fileName)
  }
  async load(item: Pick<RecordingLibraryItem, 'sessionId' | 'source'>): Promise<CompactRecordingFile | null> {
    const file = item.source === 'imported' ? await this.imports.load(item.sessionId) : await this.local.load(item.sessionId)
    if (file) return validateCompactRecording(file)
    if (item.source !== 'local' || typeof this.local.loadLegacy !== 'function') return null
    const legacy = await this.local.loadLegacy(item.sessionId)
    if (!legacy) return null
    const migrated = compactRecording(validateRecording(legacy, { maxCheckpoints: 20_000 }))
    const checked = validateCompactRecording(migrated)
    await this.local.save(checked)
    return checked
  }
  async remove(items: RecordingLibraryItem[], activeTrainingKey: string | null = null): Promise<RecordingRemovalResult> {
    const result: RecordingRemovalResult = { deleted: [], failed: [] }
    const current = await this.list()
    for (const requested of items) {
      const item = current.find(row => row.sessionId === requested.sessionId && row.source === requested.source)
      if (!item) continue
      let release: (() => void) | null = null
      try {
        if (item.source === 'local') {
          if (activeTrainingKey && item.trainingKey === activeTrainingKey) throw new Error('训练正在进行，不能删除当前录像')
          release = await this.acquireLease(item.sessionId)
          if (!release) throw new Error('另一页面正在记录这份录像，请结束录制后再删除')
          if (!this.local.remove) throw new Error('当前存储不支持删除录像')
          await this.local.remove(item.sessionId)
        } else await this.imports.remove(item.sessionId)
        result.deleted.push(item)
      } catch (error) { result.failed.push({ item, reason: error instanceof Error ? error.message : String(error) }) }
      finally { release?.() }
    }
    return result
  }
  async clear(source: RecordingSource, activeTrainingKey: string | null = null): Promise<RecordingRemovalResult> {
    return this.remove((await this.list()).filter(item => item.source === source), activeTrainingKey)
  }
}

function library(): RecordingLibraryRepository {
  if (!repository) throw new Error('录像库尚未完成安装隔离初始化，请稍后重试')
  return repository
}
export const listRecordingLibrary = () => library().list()
export const importRecording = (file: CompactRecordingFile, fileName: string) => library().import(file, fileName)
export const loadLibraryRecording = (item: Pick<RecordingLibraryItem, 'sessionId' | 'source'>) => library().load(item)
export const removeLibraryRecordings = (items: RecordingLibraryItem[], activeTrainingKey: string | null = null) => library().remove(items, activeTrainingKey)
export const clearRecordingSource = (source: RecordingSource, activeTrainingKey: string | null = null) => library().clear(source, activeTrainingKey)

/** Migrate on demand, retaining the original v1 row until the v2 transaction succeeds. */
export async function loadLocalRecording(id: string): Promise<CompactRecordingFile | null> {
  const current = await recordingStorage.load(id)
  if (current) return validateCompactRecording(current)
  const legacy = await recordingStorage.loadLegacy(id)
  if (!legacy) return null
  const migrated = validateCompactRecording(compactRecording(validateRecording(legacy, { maxCheckpoints: 20_000 })))
  await recordingStorage.save(migrated)
  return migrated
}
