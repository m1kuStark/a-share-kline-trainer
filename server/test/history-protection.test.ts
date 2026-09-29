// DATA-03 可读取的历史版本保护——内容指纹、差异重分类、保护库 lineage、协调器接线与保留版只读读取。
// 全程合成 TDX 目录与独立临时库；不读真实通达信，不依赖网络。

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase } from '../src/db.js'
import { createDataRefreshCoordinator } from '../src/data/refresh.js'
import { diffAgainstBaseline, type ScannedFileState } from '../src/data/source.js'
import { createTdxSource } from '../src/data/tdxSource.js'
import { classifyContentChange, prefixSha256Hex, sha256Hex } from '../src/data/history/fingerprint.js'
import { HistoryStore, mergeScanBaselineWithFingerprints } from '../src/data/history/store.js'
import { readRetainedStock, retainStockVersion, verifyRetainedStock } from '../src/data/history/protect.js'
import { loadRefreshLog } from '../src/data/snapshot.js'
import type { AppConfig } from '../src/config.js'
import type { DataRefreshCoordinator } from '../src/data/refresh.js'

// ===== 夹具（与 data-refresh.test.ts 同款字节布局，独立实现日期工具交叉验证） =====

const encryptedGbbqRecord = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')

function dayRecord(date: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(close * 100) - 50, 4)
  buffer.writeInt32LE(Math.round(close * 100) + 50, 8)
  buffer.writeInt32LE(Math.round(close * 100) - 100, 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(1_000, 20)
  buffer.writeInt32LE(100, 24)
  return buffer
}

function dateInt(iso: string): number {
  return Number(iso.replaceAll('-', ''))
}

const D1 = '2024-03-04'
const D2 = '2024-03-05'
const D3 = '2024-03-06'

async function writeStockDayFile(root: string, fileName: string, records: Buffer[]): Promise<void> {
  const directory = join(root, 'vipdoc', 'sh', 'lday')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, fileName), Buffer.concat(records))
}

async function writeGbbq(root: string, recordCount: number): Promise<void> {
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const payload = Buffer.alloc(4 + recordCount * encryptedGbbqRecord.length)
  payload.writeUInt32LE(recordCount, 0)
  for (let index = 0; index < recordCount; index += 1) {
    encryptedGbbqRecord.copy(payload, 4 + index * encryptedGbbqRecord.length)
  }
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), payload)
}

async function createFixtureRoot(records: Buffer[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-history-protect-'))
  await writeStockDayFile(root, 'sh600519.day', records)
  await writeGbbq(root, 1)
  return root
}

async function createWorkspace(): Promise<{ databasePath: string; databaseDir: string; storeDir: string }> {
  const base = await mkdtemp(join(tmpdir(), 'tdx-history-protect-db-'))
  const databasePath = join(base, 'trainer.sqlite')
  return { databasePath, databaseDir: base, storeDir: join(base, 'history-versions') }
}

function configOf(tdxRoot: string, databasePath: string): AppConfig {
  return { host: '127.0.0.1', port: 0, databasePath, tdxRoot }
}

async function drain(coordinator: DataRefreshCoordinator): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const pending = coordinator.pendingTasks()
    if (pending.length === 0) return
    await Promise.all(pending)
  }
  throw new Error('刷新任务在 500 轮等待后仍未结束')
}

function fileState(path: string, rows: number, sha256: string, prefix?: { rows: number; sha256: string }, maxDate: string = D2): ScannedFileState {
  return {
    path, size: rows * 32, mtimeMs: 1000, maxDate, rows, sha256,
    ...(prefix ? { prefixRows: prefix.rows, prefixSha256: prefix.sha256 } : {}),
  }
}

// ===== 1. 内容指纹与分类（纯函数） =====

describe('内容指纹与分类（DATA-03）', () => {
  it('前缀哈希等于对应子缓冲的完整哈希；记录数不足返回 null', () => {
    const bytes = Buffer.concat([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)])
    expect(prefixSha256Hex(bytes, 2)).toBe(sha256Hex(bytes.subarray(0, 64)))
    expect(prefixSha256Hex(bytes, 3)).toBe(sha256Hex(bytes))
    expect(prefixSha256Hex(bytes, 4)).toBeNull()
    expect(prefixSha256Hex(Buffer.alloc(0), 0)).toBe(sha256Hex(Buffer.alloc(0)))
  })

  it('分类：identical / appended / rewritten / shrunk / unverifiable', () => {
    const bytes3 = Buffer.concat([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)])
    const bytes2 = bytes3.subarray(0, 64)
    const previous = { rows: 2, sha256: sha256Hex(bytes2) }
    expect(classifyContentChange(previous, { rows: 2, sha256: previous.sha256 })).toBe('identical')
    expect(classifyContentChange(previous, { rows: 3, sha256: sha256Hex(bytes3), prefixSha256: prefixSha256Hex(bytes3, 2) })).toBe('appended')
    // 追加同时改写历史：末条前进，但前缀对不上
    const tampered = Buffer.concat([dayRecord(dateInt(D1), 99), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)])
    expect(classifyContentChange(previous, { rows: 3, sha256: sha256Hex(tampered), prefixSha256: prefixSha256Hex(tampered, 2) })).toBe('rewritten')
    expect(classifyContentChange(previous, { rows: 1, sha256: sha256Hex(bytes2.subarray(0, 32)) })).toBe('shrunk')
    expect(classifyContentChange(previous, { rows: 3, sha256: null })).toBe('unverifiable')
    expect(classifyContentChange(null, { rows: 3, sha256: 'abc' })).toBe('unverifiable')
    expect(classifyContentChange({ rows: 2, sha256: null }, { rows: 3, sha256: 'abc' })).toBe('unverifiable')
  })
})

// ===== 2. 扫描差异的内容级重分类（修漏报） =====

describe('diffAgainstBaseline 内容级重分类', () => {
  const bytes2 = Buffer.concat([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
  const bytes3Appended = Buffer.concat([bytes2, dayRecord(dateInt(D3), 12)])
  const bytes3Rewritten = Buffer.concat([dayRecord(dateInt(D1), 99), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)])

  it('有内容证据：纯追加记 added，追加同时改写记 revised（旧口径漏报）', () => {
    const previous = new Map([[ '/t/sh600519.day', fileState('/t/sh600519.day', 2, sha256Hex(bytes2)) ]])
    const appended = fileState('/t/sh600519.day', 3, sha256Hex(bytes3Appended), { rows: 2, sha256: sha256Hex(bytes2) }, D3)
    expect(diffAgainstBaseline(previous, [appended])).toEqual({ baseline: false, added: 1, removed: 0, revised: 0 })
    const rewritten = fileState('/t/sh600519.day', 3, sha256Hex(bytes3Rewritten), { rows: 2, sha256: prefixSha256Hex(bytes3Rewritten, 2)! }, D3)
    expect(diffAgainstBaseline(previous, [rewritten])).toEqual({ baseline: false, added: 0, removed: 0, revised: 1 })
  })

  it('无内容证据：维持元数据口径（maxDate 前移记 added），不虚构结论', () => {
    const previous = new Map([[ '/t/sh600519.day', { path: '/t/sh600519.day', size: 64, mtimeMs: 1, maxDate: D2, rows: 2 } ]])
    const current = { path: '/t/sh600519.day', size: 96, mtimeMs: 2, maxDate: D3, rows: 3 }
    expect(diffAgainstBaseline(previous, [current])).toEqual({ baseline: false, added: 1, removed: 0, revised: 0 })
  })

  it('基线叠加：只给主库仍存在的路径补 sha256，不注入已移除路径', () => {
    const base = new Map([[ '/t/a.day', { path: '/t/a.day', size: 32, mtimeMs: 1, maxDate: D1, rows: 1 } ]])
    const fingerprints = new Map([
      ['/t/a.day', { path: '/t/a.day', size: 32, mtimeMs: 1, rows: 1, maxDate: D1, sha256: 'aa', present: true }],
      ['/t/gone.day', { path: '/t/gone.day', size: 64, mtimeMs: 1, rows: 2, maxDate: D2, sha256: 'bb', present: false }],
    ])
    const merged = mergeScanBaselineWithFingerprints(base, fingerprints)
    expect(merged.size).toBe(1)
    expect(merged.get('/t/a.day')?.sha256).toBe('aa')
    expect(merged.has('/t/gone.day')).toBe(false)
  })
})

describe('tdxSource 扫描携带内容指纹', () => {
  it('全量读取给出 sha256 与相对上一版本的前缀哈希；基线无指纹时补读', async () => {
    const root = await createFixtureRoot([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
    try {
      const source = createTdxSource(root)
      const first = await source.scan()
      expect(first.baseline).toBe(true)
      const firstFile = first.files[0]
      expect(firstFile.rows).toBe(2)
      expect(firstFile.sha256).toBe(sha256Hex(await readFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'))))
      expect(firstFile.prefixSha256).toBeUndefined()

      const appended = Buffer.concat([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)])
      await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), appended)
      const second = await source.scan(first.files.reduce((map, file) => { map.set(file.path, file); return map }, new Map()))
      const secondFile = second.files[0]
      expect(secondFile.sha256).toBe(sha256Hex(appended))
      expect(secondFile.prefixRows).toBe(2)
      expect(secondFile.prefixSha256).toBe(prefixSha256Hex(appended, 2))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// ===== 3. 保护库 lineage 与指纹层 =====

describe('HistoryStore 市场版本记录', () => {
  it('首版即迁移基线（全部 baseline），第二版按内容分类 appended/rewritten/unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tdx-history-store-'))
    const store = await HistoryStore.open(dir)
    try {
      const filesV1 = [fileState('/t/a.day', 2, 'sha-a1'), fileState('/t/b.day', 4, 'sha-b1')]
      const v1 = store.recordMarketVersion({ batchId: 'batch-1', finishedAt: '2026-09-29T10:00:00Z', outcome: {
        kind: 'tdx', name: '通达信本地数据', totalStocks: 2, added: 2, removed: 0, revised: 0, baseline: true,
        sourceMaxDate: D2, files: filesV1,
      } })
      expect(v1.baseline).toBe(true)
      expect(v1.appended).toBe(0)
      expect(v1.rewritten).toBe(0)
      const detail = store.getMarketVersion('batch-1')
      expect(detail?.files.every(file => file.status === 'baseline')).toBe(true)

      // 纯追加 + 改写 + 未变
      const filesV2 = [
        fileState('/t/a.day', 3, 'sha-a2', { rows: 2, sha256: 'sha-a1' }),
        fileState('/t/b.day', 5, 'sha-b2', { rows: 4, sha256: 'sha-x' }),
        fileState('/t/c.day', 1, 'sha-c1'),
      ]
      const v2 = store.recordMarketVersion({ batchId: 'batch-2', finishedAt: '2026-09-29T11:00:00Z', outcome: {
        kind: 'tdx', name: '通达信本地数据', totalStocks: 3, added: 2, removed: 0, revised: 0, baseline: false,
        sourceMaxDate: D3, files: filesV2,
      } })
      expect(v2.baseline).toBe(false)
      expect(v2.appended).toBe(1)
      expect(v2.rewritten).toBe(1)
      expect(v2.unchanged).toBe(0)
      const files2 = store.getMarketVersion('batch-2')!.files
      expect(files2.find(file => file.path === '/t/a.day')?.status).toBe('appended')
      expect(files2.find(file => file.path === '/t/b.day')?.status).toBe('rewritten')
      expect(files2.find(file => file.path === '/t/c.day')?.status).toBe('added')

      // 未变文件不落 version_files
      const v3 = store.recordMarketVersion({ batchId: 'batch-3', finishedAt: '2026-09-29T12:00:00Z', outcome: {
        kind: 'tdx', name: '通达信本地数据', totalStocks: 3, added: 0, removed: 0, revised: 0, baseline: false,
        sourceMaxDate: D3, files: filesV2.map(file => ({ ...file })),
      } })
      expect(v3.unchanged).toBe(3)
      expect(v3.appended).toBe(0)
      expect(v3.rewritten).toBe(0)
      expect(store.getMarketVersion('batch-3')!.files).toEqual([])
      expect(store.listMarketVersions().map(version => version.id)).toEqual(['batch-1', 'batch-2', 'batch-3'])
    } finally {
      store.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('移除路径标记 present=0，文件再现时按旧指纹校验改写', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tdx-history-store-'))
    const store = await HistoryStore.open(dir)
    try {
      store.recordMarketVersion({ batchId: 'b1', finishedAt: 't1', outcome: {
        kind: 'tdx', name: 's', totalStocks: 1, added: 1, removed: 0, revised: 0, baseline: true, sourceMaxDate: D2,
        files: [fileState('/t/a.day', 2, 'sha-a1')],
      } })
      store.recordMarketVersion({ batchId: 'b2', finishedAt: 't2', outcome: {
        kind: 'tdx', name: 's', totalStocks: 0, added: 0, removed: 1, revised: 0, baseline: false, sourceMaxDate: D2,
        files: [],
      } })
      const removed = store.getMarketVersion('b2')!.files
      expect(removed).toEqual([{ status: 'removed', path: '/t/a.day', size: null, mtimeMs: null, rows: null, maxDate: null, sha256: null }])
      expect(store.latestFingerprints().get('/t/a.day')?.present).toBe(false)

      // 再现但历史被改写：前缀对不上 → rewritten
      store.recordMarketVersion({ batchId: 'b3', finishedAt: 't3', outcome: {
        kind: 'tdx', name: 's', totalStocks: 1, added: 1, removed: 0, revised: 0, baseline: false, sourceMaxDate: D3,
        files: [fileState('/t/a.day', 3, 'sha-new', { rows: 2, sha256: 'old-prefix' })],
      } })
      expect(store.getMarketVersion('b3')!.files[0].status).toBe('rewritten')
      expect(store.latestFingerprints().get('/t/a.day')?.present).toBe(true)
    } finally {
      store.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('记录失败整体回滚：版本行与指纹层都不留半状态', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tdx-history-store-'))
    const store = await HistoryStore.open(dir)
    try {
      const outcome = { kind: 'tdx' as const, name: 's', totalStocks: 1, added: 1, removed: 0, revised: 0, baseline: true, sourceMaxDate: D2, files: [fileState('/t/a.day', 2, 'sha-a1')] }
      store.recordMarketVersion({ batchId: 'b1', finishedAt: 't1', outcome })
      const before = store.latestFingerprints()
      expect(() => store.recordMarketVersion({ batchId: 'b1', finishedAt: 't2', outcome: { ...outcome, files: [fileState('/t/a.day', 3, 'sha-a2', { rows: 2, sha256: 'sha-a1' })] } })).toThrow()
      expect(store.listMarketVersions()).toHaveLength(1)
      expect(store.latestFingerprints().get('/t/a.day')?.sha256).toBe(before.get('/t/a.day')?.sha256)
    } finally {
      store.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ===== 4. 协调器接线：发布后记账 + 内容级计数进刷新日志 =====

describe('刷新协调器接入历史版本保护库', () => {
  it('首刷建立迁移基线（版本 id 与 cache_meta 批次一致），纯追加批记 appended', async () => {
    const root = await createFixtureRoot([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
    const { databasePath, storeDir } = await createWorkspace()
    const database = new DatabaseSync(databasePath)
    migrateDatabase(database)
    const coordinator = createDataRefreshCoordinator(database, configOf(root, databasePath))
    try {
      await coordinator.start()
      await drain(coordinator)
      const store = await HistoryStore.open(storeDir)
      try {
        const versions = store.listMarketVersions()
        expect(versions).toHaveLength(1)
        expect(versions[0].baseline).toBe(true)
        const batchId = (database.prepare("SELECT value FROM cache_meta WHERE key = 'snapshot_batch'").get() as unknown as { value: string }).value
        expect(versions[0].batchId).toBe(batchId)
        expect(store.getMarketVersion(versions[0].id)!.files[0].status).toBe('baseline')
      } finally {
        store.close()
      }

      // 纯追加一天
      await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'),
        Buffer.concat([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)]))
      await coordinator.start()
      await drain(coordinator)
      const reopened = await HistoryStore.open(storeDir)
      try {
        const versions = reopened.listMarketVersions()
        expect(versions).toHaveLength(2)
        expect(versions[1].baseline).toBe(false)
        expect(versions[1].appended).toBe(1)
        expect(versions[1].rewritten).toBe(0)
        expect(versions[1].unchanged).toBe(0)
        const { lastSuccess } = loadRefreshLog(database)
        expect(lastSuccess?.added).toBe(1)
        expect(lastSuccess?.revised).toBe(0)
      } finally {
        reopened.close()
      }
    } finally {
      await drain(coordinator)
      database.close()
      // 协调器持有保护库句柄（进程退出时释放）；storeDir 交由系统临时目录回收，不在此强删（Windows 文件锁）
      await rm(root, { recursive: true, force: true })
    }
  })

  it('追加同时改写历史：不再漏报——刷新日志记 revised，保护库记 rewritten', async () => {
    const root = await createFixtureRoot([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
    const { databasePath, storeDir } = await createWorkspace()
    const database = new DatabaseSync(databasePath)
    migrateDatabase(database)
    const coordinator = createDataRefreshCoordinator(database, configOf(root, databasePath))
    try {
      await coordinator.start()
      await drain(coordinator)
      // 改写 D1 收盘价并追加 D3：maxDate 前移，但历史记录已变
      await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'),
        Buffer.concat([dayRecord(dateInt(D1), 99), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)]))
      await coordinator.start()
      await drain(coordinator)
      const { lastSuccess } = loadRefreshLog(database)
      expect(lastSuccess?.revised).toBe(1)
      expect(lastSuccess?.added).toBe(0)
      const store = await HistoryStore.open(storeDir)
      try {
        const versions = store.listMarketVersions()
        expect(versions).toHaveLength(2)
        expect(versions[1].rewritten).toBe(1)
        expect(versions[1].appended).toBe(0)
        expect(store.getMarketVersion(versions[1].id)!.files[0].status).toBe('rewritten')
      } finally {
        store.close()
      }
    } finally {
      await drain(coordinator)
      database.close()
      // 同上：storeDir 交由系统临时目录回收（协调器句柄随进程退出释放）
      await rm(root, { recursive: true, force: true })
    }
  })

  it('内存主库（:memory:）注入保护库实例仍可记账；记账失败任务明确失败且已提交数据保留', async () => {
    const root = await createFixtureRoot([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
    const injectDir = await mkdtemp(join(tmpdir(), 'tdx-history-inject-'))
    const injected = await HistoryStore.open(injectDir)
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    try {
      const coordinator = createDataRefreshCoordinator(database, configOf(root, ':memory:'), { historyStore: injected })
      await coordinator.start()
      await drain(coordinator)
      expect(injected.listMarketVersions()).toHaveLength(1)
      expect(injected.listMarketVersions()[0].baseline).toBe(true)
      database.close()

      // 记账失败：任务 failed、原因可行动；主库快照已提交（data_file_state 有行）
      const failingPath = join(await mkdtemp(join(tmpdir(), 'tdx-history-fail-')), 'trainer.sqlite')
      const failingDatabase = new DatabaseSync(failingPath)
      migrateDatabase(failingDatabase)
      const failingStore = await HistoryStore.open(join(await mkdtemp(join(tmpdir(), 'tdx-history-fail-store-')), 'store'))
      const bomb: HistoryStore = Object.create(failingStore) as HistoryStore
      bomb.recordMarketVersion = () => { throw new Error('注入的记账故障') }
      const failingCoordinator = createDataRefreshCoordinator(failingDatabase, configOf(root, failingPath), { historyStore: bomb })
      try {
        await failingCoordinator.start()
        await drain(failingCoordinator)
        const { last } = loadRefreshLog(failingDatabase)
        expect(last?.outcome).toBe('failed')
        expect(last?.message).toContain('历史版本记录失败')
        expect(last?.message).toContain('行情数据已更新')
        const rows = failingDatabase.prepare('SELECT COUNT(*) AS count FROM data_file_state').get() as unknown as { count: number }
        expect(rows.count).toBe(1)
      } finally {
        failingDatabase.close()
        failingStore.close()
      }
    } finally {
      injected.close()
      await rm(root, { recursive: true, force: true })
      await rm(injectDir, { recursive: true, force: true })
    }
  })
})

// ===== 5. 保留版：可读取的旧版 + 明确阻断 =====

describe('保留版只读读取与校验（protect.ts）', () => {
  it('保留→读取：旧版逐字节可读（含权息事件），读取不回退现势文件', async () => {
    const root = await createFixtureRoot([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
    const dir = await mkdtemp(join(tmpdir(), 'tdx-history-retain-'))
    const store = await HistoryStore.open(dir)
    try {
      const dayPath = join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day')
      const gbbqPath = join(root, 'T0002', 'hq_cache', 'gbbq')
      const retained = await retainStockVersion(store, { market: 'sh', code: '600519', dayFilePath: dayPath, gbbqFilePath: gbbqPath, now: new Date('2026-09-29T08:00:00Z') })
      expect(retained.rows).toBe(2)
      expect(retained.sha256).toBe(sha256Hex(await readFile(dayPath)))

      // 现势文件随后被改写：保留版必须仍读出旧版
      await writeFile(dayPath, Buffer.concat([dayRecord(dateInt(D1), 77), dayRecord(dateInt(D2), 11), dayRecord(dateInt(D3), 12)]))
      const read = readRetainedStock(store, retained.id)
      expect(read.state).toBe('ok')
      if (read.state === 'ok') {
        expect(read.bars.map(bar => bar.close)).toEqual([10, 11])
        expect(read.bars.map(bar => bar.date)).toEqual([D1, D2])
        expect(read.events).toHaveLength(1)
        expect(read.events[0]).toMatchObject({ market: 'sh', code: '600519', date: '2002-07-25' })
        expect(read.version.createdAt).toBe('2026-09-29T08:00:00.000Z')
      }
      expect((await verifyRetainedStock(store, retained.id, dayPath, gbbqPath)).state).toBe('drifted')

      // 无保留版＝明确阻断，不回退现势
      const missing = readRetainedStock(store, 'no-such-id')
      expect(missing.state).toBe('unavailable')
      if (missing.state === 'unavailable') expect(missing.reason).toContain('明确阻断')
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('校验：intact / 权息漂移 / 现势缺失 / 未知版本', async () => {
    const root = await createFixtureRoot([dayRecord(dateInt(D1), 10), dayRecord(dateInt(D2), 11)])
    const dir = await mkdtemp(join(tmpdir(), 'tdx-history-verify-'))
    const store = await HistoryStore.open(dir)
    try {
      const dayPath = join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day')
      const gbbqPath = join(root, 'T0002', 'hq_cache', 'gbbq')
      const retained = await retainStockVersion(store, { market: 'sh', code: '600519', dayFilePath: dayPath, gbbqFilePath: gbbqPath })
      expect((await verifyRetainedStock(store, retained.id, dayPath, gbbqPath)).state).toBe('intact')

      // 权息事件翻倍：日线未变也判 drifted
      await writeGbbq(root, 2)
      const eventsDrift = await verifyRetainedStock(store, retained.id, dayPath, gbbqPath)
      expect(eventsDrift.state).toBe('drifted')
      if (eventsDrift.state === 'drifted') {
        expect(eventsDrift.barsChanged).toBe(false)
        expect(eventsDrift.eventsChanged).toBe(true)
      }

      // 现势文件删除
      await rm(dayPath)
      expect((await verifyRetainedStock(store, retained.id, dayPath, gbbqPath)).state).toBe('missing')
      expect((await verifyRetainedStock(store, 'no-such-id', dayPath, gbbqPath)).state).toBe('unavailable')
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })
})
