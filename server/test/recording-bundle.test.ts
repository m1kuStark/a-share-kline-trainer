// REC-BULK-01：录像库批量导出/导入（web/src/recording/bundle.ts）。
// 契约 oracle：用户需求「录像文件批量导出、导入功能」＋简报设计决策——
// 合并包 { format: 'trainer-recordings-bundle', version: 1, exportedAt, items } 明文 JSON；
// 逐条容错（损坏跳过计数不整批失败）；重复（trainingKey/originalSessionId 相同）跳过计数不覆盖；
// 兼容既有单条 JSON/gzip/v1 导入与多选文件。
import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  RECORDING_BUNDLE_FORMAT,
  RECORDING_BUNDLE_VERSION,
  buildRecordingBundle,
  bulkImportRecordingFiles,
  exportRecordingBundleFile,
  parseRecordingBundle,
} from '../../web/src/recording/bundle'
import { RecordingLibraryRepository } from '../../web/src/recording/recordingRepository'
import { MemoryImportedRecordingStorage } from '../../web/src/recording/importedStorage'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'

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

function recording(sessionId: string, trainingKey: string | null = null): CompactRecordingFile {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-03T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1, height: 1 }, dpr: 1 }, trainingKey,
    events: [], checkpoints: [], resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] }, gaps: [], complete: true,
  }
}

async function repositoryWith(existing: CompactRecordingFile[] = []) {
  const storage = storageStub()
  for (const item of existing) await storage.save(item)
  const imports = new MemoryImportedRecordingStorage()
  const repository = new RecordingLibraryRepository(storage, imports, async () => () => {})
  return { storage, imports, repository }
}

function jsonFile(value: unknown, name: string): File {
  return new File([JSON.stringify(value)], name, { type: 'application/json' })
}

describe('recording bundle build/parse（合并包格式契约）', () => {
  it('builds a v1 bundle with header fields and validated items', () => {
    const bundle = buildRecordingBundle([recording('a'), recording('b')], new Date('2026-10-09T08:00:00.000Z'))
    expect(bundle.format).toBe(RECORDING_BUNDLE_FORMAT)
    expect(bundle.version).toBe(RECORDING_BUNDLE_VERSION)
    expect(bundle.exportedAt).toBe('2026-10-09T08:00:00.000Z')
    expect(bundle.items.map(item => item.sessionId)).toEqual(['a', 'b'])
  })

  it('rejects building a bundle from an invalid recording（导出自洽：不产出读不回的包）', () => {
    expect(() => buildRecordingBundle([{ ...recording('bad'), events: 'oops' as unknown as never }]))
      .toThrow(/录制/)
  })

  it('parses a bundle produced by export and returns its items', () => {
    const bundle = buildRecordingBundle([recording('a'), recording('b')])
    const items = parseRecordingBundle(JSON.parse(JSON.stringify(bundle)))
    expect(items.map(item => item.sessionId)).toEqual(['a', 'b'])
  })

  it('rejects unknown format, unsupported version, missing exportedAt and non-array items with actionable Chinese errors', () => {
    expect(() => parseRecordingBundle({ schemaVersion: 2 })).toThrow(/不是录像合并包/)
    expect(() => parseRecordingBundle({ format: RECORDING_BUNDLE_FORMAT, version: 99, exportedAt: 'x', items: [] })).toThrow(/合并包版本/)
    expect(() => parseRecordingBundle({ format: RECORDING_BUNDLE_FORMAT, version: 1, items: [] })).toThrow(/exportedAt/)
    expect(() => parseRecordingBundle({ format: RECORDING_BUNDLE_FORMAT, version: 1, exportedAt: '2026-10-09T00:00:00.000Z', items: 'nope' })).toThrow(/items/)
    expect(() => parseRecordingBundle(null)).toThrow(/不是录像合并包/)
  })

  it('exports the bundle as a plain JSON blob readable back by parse', async () => {
    const blob = await exportRecordingBundleFile([recording('a'), recording('b')])
    expect(blob.type).toBe('application/json')
    const parsed = parseRecordingBundle(JSON.parse(await blob.text()))
    expect(parsed).toHaveLength(2)
  })
})

describe('bulkImportRecordingFiles（批量导入编排：多选/单条兼容/容错/去重）', () => {
  it('imports every item of a bundle file', async () => {
    const { repository } = await repositoryWith()
    const bundle = buildRecordingBundle([recording('a', '7.2026-10-01'), recording('b', '8.2026-10-02')])
    const outcome = await bulkImportRecordingFiles([jsonFile(bundle, '库备份.trainer-recordings.json')], repository)
    expect(outcome.imported).toHaveLength(2)
    expect(outcome.skipped).toEqual([])
    expect(outcome.failed).toEqual([])
    expect((await repository.list()).filter(item => item.source === 'imported')).toHaveLength(2)
  })

  it('imports multiple single files selected together（多选：明文 JSON 与 gzip 单条并存）', async () => {
    const { repository } = await repositoryWith()
    const gzipFile = new File([gzipSync(Buffer.from(JSON.stringify(recording('gz'))))], 'single.json.gz', { type: 'application/gzip' })
    const outcome = await bulkImportRecordingFiles([jsonFile(recording('plain'), 'one.json'), gzipFile], repository)
    expect(outcome.imported).toHaveLength(2)
    expect(outcome.failed).toEqual([])
  })

  it('counts a corrupt file as one failure without failing the batch（损坏文件不整批失败）', async () => {
    const { repository } = await repositoryWith()
    const corrupt = new File(['{not json'], 'corrupt.json', { type: 'application/json' })
    const outcome = await bulkImportRecordingFiles([jsonFile(recording('ok'), 'ok.json'), corrupt], repository)
    expect(outcome.imported.map(item => item.originalSessionId)).toEqual(['ok'])
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]!.label).toBe('corrupt.json')
    expect(outcome.failed[0]!.reason).toContain('corrupt.json')
  })

  it('skips invalid items inside a bundle but imports the valid ones（包内逐条容错）', async () => {
    const { repository } = await repositoryWith()
    const raw = JSON.parse(JSON.stringify(buildRecordingBundle([recording('good', '9.2026-10-09')])))
    raw.items.push({ ...recording('bad'), checkpoints: 42 })
    const outcome = await bulkImportRecordingFiles([jsonFile(raw, 'mixed.trainer-recordings.json')], repository)
    expect(outcome.imported.map(item => item.originalSessionId)).toEqual(['good'])
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]!.label).toContain('mixed.trainer-recordings.json')
    expect(outcome.failed[0]!.label).toContain('第 2 条')
  })

  it('skips duplicates by trainingKey against existing library items and within the same batch（重复不覆盖）', async () => {
    const { repository } = await repositoryWith([recording('local', '1.2026-10-01')])
    const bundle = buildRecordingBundle([
      recording('dup-of-local', '1.2026-10-01'),
      recording('dup-in-batch', '2.2026-10-02'),
      recording('dup-in-batch-2', '2.2026-10-02'),
      recording('fresh', '3.2026-10-03'),
    ])
    const outcome = await bulkImportRecordingFiles([jsonFile(bundle, 'bundle.json')], repository)
    expect(outcome.imported.map(item => item.originalSessionId)).toEqual(['dup-in-batch', 'fresh'])
    expect(outcome.skipped.map(item => item.reason)).toEqual(['trainingKey 重复', 'trainingKey 重复'])
    expect(outcome.failed).toEqual([])
  })

  it('skips re-importing an already imported recording by originalSessionId（防二次导入堆积）', async () => {
    const { repository } = await repositoryWith()
    const bundle = buildRecordingBundle([recording('shared', '5.2026-10-05')])
    await bulkImportRecordingFiles([jsonFile(bundle, 'first.json')], repository)
    const again = await bulkImportRecordingFiles([jsonFile(bundle, 'again.json')], repository)
    expect(again.imported).toEqual([])
    expect(again.skipped).toHaveLength(1)
    expect((await repository.list()).filter(item => item.source === 'imported')).toHaveLength(1)
  })

  it('imports recordings with null trainingKey without dedup（trainingKey 缺失不算重复）', async () => {
    const { repository } = await repositoryWith([recording('legacy-local')])
    const outcome = await bulkImportRecordingFiles([jsonFile(recording('legacy-import'), 'legacy.json')], repository)
    expect(outcome.imported).toHaveLength(1)
    expect(outcome.skipped).toEqual([])
  })

  it('migrates legacy v1 plaintext recordings through the bulk path（v1 兼容）', async () => {
    const { repository } = await repositoryWith()
    const v1 = {
      format: 'trainer-session', schemaVersion: 1, sessionId: 'old-v1', createdAt: '2026-01-01T00:00:00.000Z',
      app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
      environment: { timezone: 'Asia/Shanghai', viewport: { width: 1, height: 1 }, dpr: 1 }, trainingKey: null,
      events: [], checkpoints: [], resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] }, gaps: [], complete: true,
    }
    const outcome = await bulkImportRecordingFiles([jsonFile(v1, 'v1.json')], repository)
    expect(outcome.imported).toHaveLength(1)
    expect(outcome.imported[0]!.originalSessionId).toBe('old-v1')
  })
})
