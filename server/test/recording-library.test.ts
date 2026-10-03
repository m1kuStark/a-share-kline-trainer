import { describe, expect, it } from 'vitest'
import { RecordingLibraryRepository } from '../../web/src/recording/recordingRepository'
import { MemoryImportedRecordingStorage } from '../../web/src/recording/importedStorage'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'
import type { RecordingFile } from '../../web/src/recording/types'

function storageStub() {
  const records = new Map<string, CompactRecordingFile>()
  return {
    records,
    async save(file: CompactRecordingFile) { records.set(file.sessionId, structuredClone(file)) },
    async load(id: string) { return records.get(id) ?? null },
    async list() { return [...records.values()].map(file => ({ sessionId: file.sessionId, trainingKey: file.trainingKey, createdAt: file.createdAt, eventCount: file.events.length })) },
    async remove(id: string) { records.delete(id) },
  }
}

function file(sessionId = 'same-session'): CompactRecordingFile {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-03T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1, height: 1 }, dpr: 1 }, trainingKey: '1.1',
    events: [], checkpoints: [], resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] }, gaps: [], complete: true,
  }
}

describe('recording library source isolation', () => {
  it('imports under a distinct id and keeps local/imported sources independent', async () => {
    const storage = storageStub()
    const repository = new RecordingLibraryRepository(storage, new MemoryImportedRecordingStorage(), async () => () => {})
    await storage.save(file())
    const imported = await repository.import(file(), 'share.json')
    expect(imported.sessionId).not.toBe('same-session')
    expect(imported.source).toBe('imported')
    const listed = await repository.list()
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'same-session', source: 'local' }),
      expect.objectContaining({ sessionId: imported.sessionId, source: 'imported' }),
    ]))
  })

  it('removes one recording and clears only the selected source', async () => {
    const storage = storageStub()
    const imports = new MemoryImportedRecordingStorage()
    const repository = new RecordingLibraryRepository(storage, imports, async () => () => {})
    await storage.save(file('local'))
    const imported = await repository.import(file('foreign'), 'first.json')
    await repository.remove([imported])
    expect((await repository.list()).map(item => item.sessionId)).toEqual(['local'])
    await repository.import(file('foreign-2'), 'second.json')
    await repository.clear('local')
    expect((await repository.list()).every(item => item.source === 'imported')).toBe(true)
    // A new repository sees persisted import metadata, independently of browser storage keys.
    const restarted = new RecordingLibraryRepository(storage, imports, async () => () => {})
    expect(await restarted.list()).toEqual([expect.objectContaining({ fileName: 'second.json', source: 'imported' })])
  })

  it('protects active training and recordings held by another tab', async () => {
    const storage = storageStub()
    await storage.save(file('active'))
    await storage.save({ ...file('locked'), trainingKey: 'other' })
    const repository = new RecordingLibraryRepository(storage, new MemoryImportedRecordingStorage(), async () => null)
    const result = await repository.clear('local', '1.1')
    expect(result.deleted).toHaveLength(0)
    expect(result.failed.map(item => item.reason)).toEqual([expect.stringContaining('训练正在进行'), expect.stringContaining('正在记录')])
    expect(storage.records.size).toBe(2)
  })

  it('reports deletion failures and releases a recording lease after failed storage writes', async () => {
    const storage = storageStub()
    await storage.save(file('failure'))
    storage.remove = async () => { throw new Error('disk full') }
    let released = false
    const repository = new RecordingLibraryRepository(storage, new MemoryImportedRecordingStorage(), async () => () => { released = true })
    const result = await repository.clear('local')
    expect(result.failed[0]?.reason).toBe('disk full')
    expect(released).toBe(true)
    expect((await repository.list()).map(item => item.sessionId)).toEqual(['failure'])
  })

  it('migrates a legacy local recording on replay without removing its original data', async () => {
    const compact = file('legacy')
    const { resources: _resources, ...common } = compact
    const legacy: RecordingFile = { ...common, schemaVersion: 1 }
    const storage = { ...storageStub(), async loadLegacy(id: string) { return id === legacy.sessionId ? legacy : null } }
    const repository = new RecordingLibraryRepository(storage, new MemoryImportedRecordingStorage(), async () => () => {})
    const loaded = await repository.load({ sessionId: 'legacy', source: 'local' })
    expect(loaded?.schemaVersion).toBe(2)
    expect(storage.records.get('legacy')).toEqual(loaded)
    expect(await storage.loadLegacy('legacy')).toEqual(legacy)
  })

  it('rejects invalid imports without adding them and preserves imports after local storage failure', async () => {
    const storage = storageStub()
    const imports = new MemoryImportedRecordingStorage()
    const repository = new RecordingLibraryRepository(storage, imports, async () => () => {})
    await expect(repository.import({ ...file(), createdAt: 'invalid' }, 'broken.json')).rejects.toThrow('createdAt')
    expect(await repository.list()).toEqual([])
    const imported = await repository.import(file(), 'valid.json')
    await storage.save(file('local-failure'))
    storage.remove = async () => { throw new Error('failed local delete') }
    const removal = await repository.clear('local')
    expect(removal.failed).toHaveLength(1)
    expect(await repository.load(imported)).toEqual(expect.objectContaining({ sessionId: imported.sessionId }))
  })
})

