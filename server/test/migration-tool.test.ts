// MIG-01：v1.2.7→v1.3.0 迁移工具单测。
// 覆盖四层：① compact 行重组（export-core assembleCompactSession 与 MemoryCompactStorage 落库行等价）；
// ② 旧 v1 会话转换链（validateRecording→compactRecording→validateCompactRecording，与 v1.2.7 loadLocalRecording 同链）；
// ③ collectMigrationItems 扫描编排（micro-fake IndexedDB：compact/legacy/imports 三来源、同 id compact 优先、损坏容错不静默丢弃）；
// ④ Node 侧纯函数（dist/migrate-v127/export-v127.cjs：trainer.config.json 子集解析、状态身份、目录/端口解析优先级）。
// 兼容性论据（行为面）：v1.2.7 语义合法的录像 fixture 必须通过 main 的 validateCompactRecording
// （diff 证据：main 的 DRAWING_PANES/RANGE_MODES 是 v1.2.7 的超集，compactValidation 两版逐字节一致）。
import { describe, expect, it } from 'vitest'
import {
  MIGRATION_BUNDLE_FORMAT,
  MIGRATION_BUNDLE_VERSION,
  assembleCompactSession,
  buildMigrationBundle,
  collectMigrationItems,
  convertLegacySession,
  discoverTrainerDbNames,
  migrationBundleFileName,
  trainerDbNameFor,
  type OpenedDatabase,
} from '../../tools/migrate-v127/src/export-core'
import { buildRecordingBundle, parseRecordingBundle } from '../../web/src/recording/bundle'
import { validateCompactRecording } from '../../web/src/recording/compactValidation'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'
import { MemoryCompactStorage } from '../../web/src/recording/compactStorage'
import type { CompactCheckpoint, SeriesBaseVersion } from '../../web/src/recording/compactTypes'
import type { RecordingEvent } from '../../web/src/recording/types'
import tool from '../../tools/migrate-v127/dist/migrate-v127/export-v127.cjs'

// ===== fixtures（形状对齐 server/test/recording-compact-storage.test.ts 与 e2e/recording-migration.spec.ts） =====

/** started/finished 配对事件（assertEvent：started 不得带 outcome；seq 从 1 连续递增） */
function makeEventPair(): RecordingEvent[] {
  return [
    { seq: 1, opId: 'op-1', segmentId: 'seg-1', elapsedMs: 0, phase: 'started', action: 'training.advance', source: 'ui', params: { day: 1 }, checkpointId: 'cp-1' },
    { seq: 2, opId: 'op-1', segmentId: 'seg-1', elapsedMs: 100, phase: 'finished', action: 'training.advance', source: 'ui', outcome: 'accepted', result: { ok: true }, checkpointId: 'cp-1' },
  ] as unknown as RecordingEvent[]
}

function makeCheckpoint(seq: number): CompactCheckpoint {
  return {
    id: `cp-${seq}`,
    afterSeq: seq,
    segmentId: 'seg-1',
    capturedAt: `2026-01-01T00:0${seq}:00.000Z`,
    ui: { theme: 'light', tool: null, magnet: 'off', multiSelect: false },
    training: null,
    chart: {
      timeframe: '1D',
      seriesRef: 's-d-1',
      drawingsRef: 'dw-1',
      view: { fromTimestamp: 1577836800000, toTimestamp: 1577923200000, barSpace: 8, paneHeights: { candle: 300, volume: 100 } },
      costPrice: null,
    },
    contextRef: null,
  }
}

function makeSeriesBase(id = 's-d-1'): SeriesBaseVersion {
  return {
    id,
    timeframe: '1D',
    asOf: '2020-01-02',
    firstCheckpoint: 0,
    base: null,
    bars: [
      { date: '2020-01-01', open: 10, high: 11, low: 9, close: 10, volume: 1000, amount: 10500 },
      { date: '2020-01-02', open: 10, high: 11, low: 9, close: 10.1, volume: 1001, amount: 10501 },
    ] as SeriesBaseVersion['bars'],
  }
}

/** v1.2.7 语义下的合法 v2 录像（画线窗格 MACD、区间模式 preset——均为 v1.2.7 允许且 main 超集允许） */
function v127CompactFile(sessionId: string, trainingKey: string | null = 'k-1'): CompactRecordingFile {
  return {
    format: 'trainer-session',
    schemaVersion: 2,
    sessionId,
    createdAt: '2026-01-01T00:00:00.000Z',
    app: { version: '1.2.7', gitCommit: 'bbd368b', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 720 }, dpr: 1 },
    trainingKey,
    events: makeEventPair(),
    checkpoints: [makeCheckpoint(1)],
    gaps: [],
    complete: true,
    resources: {
      series: [makeSeriesBase()],
      drawings: [{ id: 'dw-1', base: null, items: [{ id: 'dw-1', name: 'horizontalSegment', paneId: 'MACD', points: [{ timestamp: 1577836800000, value: 10.5 }] }] }],
      trainingMeta: [],
      accounts: [],
      trades: [],
      contexts: [],
    },
  }
}

/** v1 原始会话（e2e/recording-migration.spec.ts 同形） */
const legacyV1File = {
  format: 'trainer-session', schemaVersion: 1, sessionId: 'legacy-fixture',
  createdAt: '2026-09-19T00:00:00Z', app: { version: '1.1.0', gitCommit: 'legacy', dirty: false, chartLibrary: '10.0.3' },
  environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 800 }, dpr: 1 },
  trainingKey: null, events: [], gaps: [], complete: true,
  checkpoints: [{ id: 'c0', afterSeq: 0, segmentId: 'seg0', capturedAt: '2026-09-19T00:00:00Z',
    training: null, chart: null, ui: { theme: 'dark', tool: null, magnet: 'weak_magnet', multiSelect: false }, context: null }],
}

// ===== micro-fake IndexedDB（per-DB store 隔离；只实现 export-core 用到的无版本 open/getAll 面；事件异步自驱动） =====

interface FakeStore { keyPath: string | string[]; rows: Array<{ key: unknown[]; value: Record<string, unknown> }> }

function compareKeyElement(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const left = String(a), right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function keyInRange(key: unknown[], range: { lower: unknown[]; upper: unknown[] }): boolean {
  let cmp = 0
  for (let i = 0; i < Math.min(key.length, range.lower.length); i++) {
    cmp = compareKeyElement(key[i], range.lower[i])
    if (cmp !== 0) break
  }
  if (cmp === 0) cmp = key.length - range.lower.length
  if (cmp < 0) return false
  cmp = 0
  for (let i = 0; i < Math.min(key.length, range.upper.length); i++) {
    cmp = compareKeyElement(key[i], range.upper[i])
    if (cmp !== 0) break
  }
  if (cmp === 0) cmp = key.length - range.upper.length
  return cmp <= 0
}

function keyOf(keyPath: string | string[], value: Record<string, unknown>): unknown[] {
  return Array.isArray(keyPath) ? keyPath.map(part => value[part]) : [value[keyPath]]
}

class FakeDb {
  closed = false
  private readonly nameList: string[]
  readonly objectStoreNames: DOMStringList
  constructor(readonly version: number, private readonly stores: Map<string, FakeStore>) {
    this.nameList = [...stores.keys()]
    this.objectStoreNames = this.nameList as unknown as DOMStringList
    ;(this.objectStoreNames as unknown as { contains: (name: string) => boolean }).contains = (name: string) => this.nameList.includes(name)
  }
  close() { this.closed = true }
  transaction(storeNames: string[]): IDBTransaction {
    const tx = { oncomplete: null, onerror: null, onabort: null } as unknown as IDBTransaction
    const store = this.stores.get(storeNames[0]!)!
    const api = {
      getAll: (range?: { lower: unknown[]; upper: unknown[] }): IDBRequest<unknown> => {
        const matched = store.rows.filter(row => (range ? keyInRange(row.key, range) : true)).map(row => row.value)
        const request = { onsuccess: null, onerror: null, result: matched } as unknown as IDBRequest<unknown>
        queueMicrotask(() => request.onsuccess?.())
        setTimeout(() => { tx.oncomplete?.() }, 0)
        return request
      },
    }
    return Object.assign(tx, { objectStore: () => api })
  }
}

interface SeededDb { opened: OpenedDatabase; seed(storeName: string, value: Record<string, unknown>): void }

function installFakeIndexedDb(): { databases: Map<string, SeededDb> } {
  const databases = new Map<string, SeededDb>()
  const api = {
    open(name: string): { onsuccess: (() => void) | null; onerror: (() => void) | null; result: FakeDb } {
      const entry = databases.get(name)
      const db = entry ? entry.opened.db as unknown as FakeDb : new FakeDb(2, new Map())
      const request = { onsuccess: null, onerror: null, result: db }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = api
  ;(globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = {
    bound: (lower: unknown[], upper: unknown[]) => ({ lower, upper }),
  }
  return { databases }
}

function createFakeDb(databases: Map<string, SeededDb>, name: string, version: number, stores: Array<{ name: string; keyPath: string | string[] }>): SeededDb {
  const map = new Map<string, FakeStore>()
  for (const store of stores) map.set(store.name, { keyPath: store.keyPath, rows: [] })
  const db = new FakeDb(version, map)
  const seeded: SeededDb = {
    opened: { db: db as unknown as IDBDatabase, version, storeNames: [...map.keys()] },
    seed(storeName, value) {
      const store = map.get(storeName)!
      store.rows.push({ key: keyOf(store.keyPath, value), value })
    },
  }
  databases.set(name, seeded)
  return seeded
}

// ===== ① compact 行重组 =====

describe('MIG-01 assembleCompactSession（compact 行重组等价）', () => {
  it('MemoryCompactStorage 落库的 header+rows 重组后与原录像深等', async () => {
    const file = v127CompactFile('sess-equivalence')
    const storage = new MemoryCompactStorage()
    await storage.save(file)
    const persisted = (storage as unknown as { persisted: Map<string, { header: Record<string, unknown>; rows: Array<Record<string, unknown>> }> }).persisted
    const { header, rows } = persisted.get('sess-equivalence')!
    expect(assembleCompactSession(header, rows)).toEqual(file)
  })

  it('缺行/多行/重复行/未知 kind/非法 id/坏 counts 均以中文错误拒绝', () => {
    const file = v127CompactFile('sess-corrupt')
    const storage = new MemoryCompactStorage()
    return storage.save(file).then(() => {
      const persisted = (storage as unknown as { persisted: Map<string, { header: Record<string, unknown>; rows: Array<Record<string, unknown>> }> }).persisted
      const { header, rows } = persisted.get('sess-corrupt')!
      const clone = () => ({ header: structuredClone(header), rows: structuredClone(rows) })

      const missing = clone(); missing.rows.pop()
      expect(() => assembleCompactSession(missing.header, missing.rows)).toThrow(/行数 .* 与 header.counts .* 不一致/)

      const duplicated = clone(); duplicated.rows.push(structuredClone(duplicated.rows[duplicated.rows.length - 1]!))
      expect(() => assembleCompactSession(duplicated.header, duplicated.rows)).toThrow(/出现重复行/)

      const unknown = clone(); (unknown.rows[0] as Record<string, unknown>).kind = 'mystery'
      expect(() => assembleCompactSession(unknown.header, unknown.rows)).toThrow(/未知 kind/)

      const noIdentity = clone(); delete (noIdentity.rows[0] as Record<string, unknown>).value.opId
      expect(() => assembleCompactSession(noIdentity.header, noIdentity.rows)).toThrow(/缺少合法 id\/opId/)

      const badCounts = clone(); (badCounts.header.counts as Record<string, unknown>).events = 'x'
      expect(() => assembleCompactSession(badCounts.header, badCounts.rows)).toThrow(/header.counts.events 非法/)
    })
  })
})

// ===== ② 旧 v1 会话转换 =====

describe('MIG-01 convertLegacySession（旧格式转换链）', () => {
  it('v1 会话转换为合法 v2 紧凑录像，checkpoint 元信息保留', () => {
    const converted = convertLegacySession(structuredClone(legacyV1File))
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    const checked = validateCompactRecording(converted.file)
    expect(checked.schemaVersion).toBe(2)
    expect(checked.sessionId).toBe('legacy-fixture')
    expect(checked.checkpoints[0]!.ui).toEqual(legacyV1File.checkpoints[0]!.ui)
    expect(checked.gaps).toEqual([])
    expect(checked.complete).toBe(true)
  })

  it('损坏 v1 会话返回失败原因（不抛出），供上层原样入包', () => {
    const broken = structuredClone(legacyV1File) as Record<string, unknown>
    broken.events = [{ noOpId: true }]
    const converted = convertLegacySession(broken)
    expect(converted.ok).toBe(false)
    if (converted.ok) return
    expect(converted.error).toMatch(/事件|opId|校验/)
  })
})

// ===== ③ 扫描编排（fake IndexedDB） =====

async function scan(databases: Map<string, SeededDb>, mainName: string, importsName: string | null) {
  const main = databases.get(mainName)!
  const imports = importsName ? databases.get(importsName) ?? null : null
  return collectMigrationItems(main.opened, imports ? imports.opened : null)
}

describe('MIG-01 collectMigrationItems（三来源扫描与容错）', () => {
  it('compact、legacy、imports 三来源全部进包且来源标记正确', async () => {
    const { databases } = installFakeIndexedDb()
    const main = createFakeDb(databases, 'trainer-recordings.ns1', 2, [
      { name: 'sessions', keyPath: 'sessionId' },
      { name: 'compactSessions', keyPath: 'sessionId' },
      { name: 'compactRecords', keyPath: ['sessionId', 'kind', 'index'] },
    ])
    const imports = createFakeDb(databases, 'trainer-recordings.ns1.imports', 2, [
      { name: 'summaries', keyPath: 'sessionId' },
      { name: 'recordings', keyPath: 'sessionId' },
    ])

    // compact 场次（行形状按 compactStorage.buildRows：kind/index/value）
    const file = v127CompactFile('sess-a', 'key-a')
    const storage = new MemoryCompactStorage()
    await storage.save(file)
    const persisted = (storage as unknown as { persisted: Map<string, { header: Record<string, unknown>; rows: Array<Record<string, unknown>> }> }).persisted.get('sess-a')!
    main.seed('compactSessions', persisted.header)
    for (const row of persisted.rows) main.seed('compactRecords', row)

    // legacy 场次
    main.seed('sessions', structuredClone(legacyV1File) as unknown as Record<string, unknown>)

    // 导入的分享录像（sessionId 已被老版本重写为 imported-uuid）
    const importedFile = v127CompactFile('imported-1111', 'key-imported')
    imports.seed('recordings', importedFile as unknown as Record<string, unknown>)

    const outcome = await scan(databases, 'trainer-recordings.ns1', 'trainer-recordings.ns1.imports')
    expect(outcome.failures).toEqual([])
    expect(outcome.items).toHaveLength(3)
    expect(outcome.summaries.map(s => s.source).sort()).toEqual(['imported', 'local-compact', 'local-legacy'])
    const bySession = new Map(outcome.summaries.map(s => [s.sessionId, s]))
    expect(bySession.get('sess-a')!.eventCount).toBe(2)
    expect(bySession.get('legacy-fixture')!.note).toContain('旧 v1 格式已转换为 v2')
    expect(outcome.items).toContainEqual(file)
    expect(outcome.items).toContainEqual(importedFile)
    // legacy 转换结果与手动同链一致
    const manual = convertLegacySession(legacyV1File)
    expect(manual.ok && outcome.items).toContainEqual(manual.file)
  })

  it('同 sessionId 已有 compact 时 legacy 行不重复入包（v1.2.7 list 同语义）', async () => {
    const { databases } = installFakeIndexedDb()
    const main = createFakeDb(databases, 'trainer-recordings.ns2', 2, [
      { name: 'sessions', keyPath: 'sessionId' },
      { name: 'compactSessions', keyPath: 'sessionId' },
      { name: 'compactRecords', keyPath: ['sessionId', 'kind', 'index'] },
    ])
    const file = v127CompactFile('legacy-fixture', 'key-dup')
    const storage = new MemoryCompactStorage()
    await storage.save(file)
    const persisted = (storage as unknown as { persisted: Map<string, { header: Record<string, unknown>; rows: Array<Record<string, unknown>> }> }).persisted.get('legacy-fixture')!
    main.seed('compactSessions', persisted.header)
    for (const row of persisted.rows) main.seed('compactRecords', row)
    main.seed('sessions', structuredClone(legacyV1File) as unknown as Record<string, unknown>)

    const outcome = await scan(databases, 'trainer-recordings.ns2', null)
    expect(outcome.items).toHaveLength(1)
    expect(outcome.summaries[0]!.source).toBe('local-compact')
  })

  it('compact 行损坏计入 failures 而非静默丢弃；legacy 转换失败时原样入包并标记', async () => {
    const { databases } = installFakeIndexedDb()
    const main = createFakeDb(databases, 'trainer-recordings.ns3', 2, [
      { name: 'sessions', keyPath: 'sessionId' },
      { name: 'compactSessions', keyPath: 'sessionId' },
      { name: 'compactRecords', keyPath: ['sessionId', 'kind', 'index'] },
    ])
    const file = v127CompactFile('sess-broken', 'key-b')
    const storage = new MemoryCompactStorage()
    await storage.save(file)
    const persisted = (storage as unknown as { persisted: Map<string, { header: Record<string, unknown>; rows: Array<Record<string, unknown>> }> }).persisted.get('sess-broken')!
    persisted.rows.pop() // 缺一行 → 重组失败
    main.seed('compactSessions', persisted.header)
    for (const row of persisted.rows) main.seed('compactRecords', row)

    const brokenLegacy = structuredClone(legacyV1File) as unknown as Record<string, unknown>
    brokenLegacy.events = [{ noOpId: true }]
    main.seed('sessions', brokenLegacy)

    const outcome = await scan(databases, 'trainer-recordings.ns3', null)
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]!.sessionId).toBe('sess-broken')
    expect(outcome.failures[0]!.reason).toMatch(/行数 .* 与 header.counts/)
    expect(outcome.items).toHaveLength(1)
    expect(outcome.summaries[0]!.source).toBe('local-legacy-raw')
    expect(outcome.summaries[0]!.note).toContain('转换失败原样入包')
    expect(outcome.items[0]).toEqual(brokenLegacy)
  })

  it('旧 v1 导入库（imports store）按 entry.recording 提取', async () => {
    const { databases } = installFakeIndexedDb()
    createFakeDb(databases, 'trainer-recordings.ns4', 2, [
      { name: 'sessions', keyPath: 'sessionId' },
      { name: 'compactSessions', keyPath: 'sessionId' },
      { name: 'compactRecords', keyPath: ['sessionId', 'kind', 'index'] },
    ])
    const legacyImports = createFakeDb(databases, 'trainer-recordings.ns4.imports', 1, [
      { name: 'imports', keyPath: 'sessionId' },
    ])
    const importedFile = v127CompactFile('imported-legacy', 'key-il')
    legacyImports.seed('imports', { sessionId: 'imported-legacy', recording: importedFile, trainingKey: 'key-il' })

    const outcome = await scan(databases, 'trainer-recordings.ns4', 'trainer-recordings.ns4.imports')
    expect(outcome.items).toEqual([importedFile])
    expect(outcome.summaries[0]!.source).toBe('imported')
  })
})

// ===== 合并包组装与 REC-BULK 契约兼容 =====

describe('MIG-01 buildMigrationBundle（合并包契约）', () => {
  it('产出的包被新版 parseRecordingBundle 接受且条目深等', () => {
    const items = [v127CompactFile('b-1'), v127CompactFile('b-2', null)]
    const bundle = buildMigrationBundle(items, new Date('2026-10-09T08:00:00.000Z'))
    expect(bundle.format).toBe(MIGRATION_BUNDLE_FORMAT)
    expect(bundle.version).toBe(MIGRATION_BUNDLE_VERSION)
    expect(bundle.exportedAt).toBe('2026-10-09T08:00:00.000Z')
    const parsed = parseRecordingBundle(JSON.parse(JSON.stringify(bundle)))
    expect(parsed).toEqual(items)
    // 每个条目按新版导入路径逐条校验通过
    for (const item of parsed) expect(() => validateCompactRecording(item)).not.toThrow()
  })

  it('空库报错文案与新版 buildRecordingBundle 一致；文件名遵循合并包命名约定', () => {
    expect(() => buildMigrationBundle([])).toThrow('库中没有录像，无法导出合并包')
    expect(() => buildRecordingBundle([])).toThrow('库中没有录像，无法导出合并包')
    expect(migrationBundleFileName(new Date(2026, 9, 9, 8, 5))).toMatch(/^训练录像库-202610090805\.trainer-recordings\.json$/)
  })

  it('v1.2.7 语义合法的录像通过新版校验（超集兼容行为面）', () => {
    // 画线窗格 MACD（v1.2.7 允许）+ 无 range 元数据：v1.2.7 侧合法 → main 侧必须合法
    expect(() => validateCompactRecording(v127CompactFile('compat-1'))).not.toThrow()
  })
})

describe('MIG-01 库名发现与命名空间', () => {
  it('discoverTrainerDbNames 排除 .imports 后缀并成对返回', () => {
    const found = discoverTrainerDbNames(['other', 'trainer-recordings.abc', 'trainer-recordings.abc.imports', 'trainer-recordings.xyz.imports'])
    expect(found).toEqual([{ main: 'trainer-recordings.abc', imports: 'trainer-recordings.abc.imports' }])
  })

  it('trainerDbNameFor 复用 storage.ts 的命名空间清洗规则', () => {
    expect(trainerDbNameFor('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')).toBe('trainer-recordings.0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')
    expect(() => trainerDbNameFor('   ')).toThrow(/命名空间为空/)
  })
})

// ===== ④ Node 侧纯函数（交付物 dist cjs） =====

describe('MIG-01 export-v127.cjs 纯函数', () => {
  it('parseTrainerConfig：dataDir 相对路径按包根解析、databasePath 必须绝对、port 非法拒绝', () => {
    expect(tool.parseTrainerConfig({ dataDir: 'x/y', port: '9100' }, 'C:/pkg/root')).toEqual({
      port: 9100, portExplicit: true, dataDir: 'C:\\pkg\\root\\x\\y', dataDirExplicit: true,
      databasePath: null, databasePathExplicit: false,
    })
    expect(tool.parseTrainerConfig(null, 'C:/pkg/root').dataDirExplicit).toBe(false)
    expect(() => tool.parseTrainerConfig({ databasePath: 'relative.sqlite' }, 'C:/pkg/root')).toThrow(/absolute/)
    expect(() => tool.parseTrainerConfig({ port: 'x' }, 'C:/pkg/root')).toThrow(/1\.\.65535/)
  })

  it('readStateIdentity：合法状态通过；异 app / 端口与 baseURL 不一致拒绝', () => {
    expect(tool.readStateIdentity({ appId: 'a-share-kline-trainer', port: 8788, baseURL: 'http://127.0.0.1:8788', pid: 53008 }))
      .toEqual({ state: { port: 8788, pid: 53008 } })
    expect(tool.readStateIdentity({ appId: 'other' }).problem).toMatch(/another app/)
    expect(tool.readStateIdentity({ appId: 'a-share-kline-trainer', port: 8788, baseURL: 'http://127.0.0.1:9999' }).problem).toMatch(/does not match/)
    expect(tool.readStateIdentity(null).problem).toMatch(/not an object/)
  })

  it('pickDataDir：有状态文件 > 有训练库 > 默认第一位', () => {
    expect(tool.pickDataDir([
      { path: 'A', source: 'a', hasState: false, hasDb: true },
      { path: 'B', source: 'b', hasState: true, hasDb: false },
    ])).toEqual({ dir: 'B', source: 'b' })
    expect(tool.pickDataDir([
      { path: 'A', source: 'a', hasState: false, hasDb: false },
      { path: 'B', source: 'b', hasState: false, hasDb: true },
    ]).dir).toBe('B')
    expect(tool.pickDataDir([{ path: 'A', source: 'a', hasState: false, hasDb: false }]))
      .toEqual({ dir: 'A', source: 'a（未发现训练库文件，将使用默认）' })
  })

  it('resolvePort：--port > 状态文件 > 显式配置 > 默认 8787（带警示）', () => {
    expect(tool.resolvePort({ argPort: 9001, statePort: 8788, configPort: 8787, configPortExplicit: true }).port).toBe(9001)
    expect(tool.resolvePort({ argPort: null, statePort: 8788, configPort: 8787, configPortExplicit: true }).port).toBe(8788)
    expect(tool.resolvePort({ argPort: null, statePort: null, configPort: 8790, configPortExplicit: true }).port).toBe(8790)
    const fallback = tool.resolvePort({ argPort: null, statePort: null, configPort: 8787, configPortExplicit: false })
    expect(fallback.port).toBe(8787)
    expect(fallback.warning).toMatch(/trainer-state\.json/)
  })

  it('parseArgs：--data-dir/--port 校验与未知参数拒绝', () => {
    expect(tool.parseArgs(['--data-dir', 'D:/tmp/x', '--port', '8977', '--no-open']))
      .toEqual({ openBrowser: false, dataDir: 'D:/tmp/x', port: 8977 })
    expect(() => tool.parseArgs(['--port', 'abc'])).toThrow(/1\.\.65535/)
    expect(() => tool.parseArgs(['--wat'])).toThrow(/unknown argument/)
  })
})
