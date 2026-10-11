// MIG-EXT-01：v1.2.7 训练历史导入（desktop 主进程侧）单测。
// 覆盖：迁移清单解析契约、包体检（sha256/schema/计数一致性）、fail-closed 导入语义
// （空库采用＋schema 升级、非空库拒绝、原子性中断恢复）、boot 应用（换库/备份/恢复）、
// IPC 路由（结构化错误不抛出）。
// 真实边界（harness 4.2）：迁移包由 tools/migrate-v127 真实 buildHistoryPackage 产出、
// schema 升级走 server/dist 真实 migrateDatabase、断言用 node:sqlite 直查。
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../../server/dist/db.js'
import buildTool from '../../tools/migrate-v127/dist/migrate-v127/export-v127.cjs'
import {
  applyPendingHistoryAtBoot,
  inspectHistoryPackage,
  parseHistoryManifest,
  PENDING_HISTORY_SUFFIX,
  registerMigrationIpc,
  stageHistoryImport,
} from '../src/mig-import'

const buildHistoryPackage = (buildTool as { buildHistoryPackage: (dbPath: string, root: string) => Promise<unknown> }).buildHistoryPackage

let fixtureSeq = 0
async function freshDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `migext01d-${prefix}-${Date.now()}-${fixtureSeq += 1}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 合法 v1.2.7 形状最小库（与 server/test/migration-tool-history.test.ts 同形状） */
function buildLegalV127Db(dbPath: string, trainings = 2): void {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, code TEXT NOT NULL,
      name TEXT NOT NULL, market TEXT NOT NULL DEFAULT 'sh', adjust_mode TEXT NOT NULL DEFAULT 'forward',
      start_date TEXT NOT NULL, planned_end TEXT NOT NULL,
      status TEXT NOT NULL, initial_cash REAL NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
      seq INTEGER NOT NULL, trade_date TEXT NOT NULL, side TEXT NOT NULL,
      price REAL NOT NULL, shares INTEGER NOT NULL, amount REAL NOT NULL,
      fee REAL NOT NULL, cash_after REAL NOT NULL, shares_after INTEGER NOT NULL, cost_after REAL NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
      side TEXT NOT NULL, order_type TEXT NOT NULL, trigger_price_raw REAL NOT NULL,
      shares INTEGER NOT NULL, status TEXT NOT NULL, created_date TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE equity_curve (training_id INTEGER NOT NULL, date TEXT NOT NULL, equity REAL NOT NULL, PRIMARY KEY (training_id, date));
    CREATE TABLE position_events (training_id INTEGER NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, shares_delta REAL NOT NULL, cash_delta REAL NOT NULL, PRIMARY KEY (training_id, seq));
    CREATE TABLE drawings (training_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE trade_notes (training_id INTEGER NOT NULL, trade_seq INTEGER NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (training_id, trade_seq));
  `)
  for (let index = 1; index <= trainings; index += 1) {
    db.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600000','浦发银行','sh','forward','2026-01-01','2026-06-30','active',1000000,'2026-01-01T00:00:00.000Z')").run()
  }
  db.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after) VALUES (1,1,'2026-01-05','buy',10.0,100,1000,5,998995,100,1000)").run()
  db.close()
}

/** v1.3.0 目标库：真实 migrateDatabase 产出（WAL、全 schema） */
function buildV130Target(dbPath: string, trainings = 0): void {
  const db = new DatabaseSync(dbPath)
  migrateDatabase(db)
  for (let index = 0; index < trainings; index += 1) {
    db.prepare("INSERT INTO trainings (tier, code, name, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600519','贵州茅台','2026-03-01','2026-09-30','active',1000000,'2026-03-01T00:00:00.000Z')").run()
  }
  db.close()
}

interface PackageFixture { root: string; manifestPath: string; sqlitePath: string; trainings: number }

async function buildPackageFixture(trainings = 2): Promise<PackageFixture> {
  const root = await freshDir('pkg')
  const dbPath = join(root, 'trainer.sqlite')
  buildLegalV127Db(dbPath, trainings)
  const outcome = await buildHistoryPackage(dbPath, root) as { ok: boolean; folder?: string; error?: string }
  if (!outcome.ok || !outcome.folder) throw new Error(`fixture package build failed: ${outcome.error}`)
  return { root, manifestPath: join(outcome.folder, '迁移清单.json'), sqlitePath: join(outcome.folder, 'trainer.sqlite'), trainings }
}

function legalManifestRaw(): Record<string, unknown> {
  return {
    format: 'trainer-history-migration',
    version: 1,
    exportedAt: '2026-10-12T08:30:00.000Z',
    sourceApp: 'a-share-kline-trainer v1.2.7',
    sqliteFile: 'trainer.sqlite',
    sqliteBytes: 4096,
    sqliteSha256: 'a'.repeat(64),
    counts: { trainings: 2, trades: 1, orders: 0, equityCurve: 0, positionEvents: 0, drawings: 0, tradeNotes: 0 },
  }
}

async function countTrainingsOf(dbPath: string): Promise<number> {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return (db.prepare('SELECT COUNT(*) AS count FROM trainings').get() as { count: number }).count
  } finally {
    db.close()
  }
}

describe('迁移清单解析（parseHistoryManifest）', () => {
  it('parseHistoryManifest: 合法清单解析通过并保留契约字段', () => {
    const parsed = parseHistoryManifest(legalManifestRaw())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.manifest.format).toBe('trainer-history-migration')
    expect(parsed.manifest.version).toBe(1)
    expect(parsed.manifest.sqliteFile).toBe('trainer.sqlite')
    expect(parsed.manifest.counts.trainings).toBe(2)
  })

  it('parseHistoryManifest: 非法 format、version、sha256、带路径分隔符的 sqliteFile 均拒绝', () => {
    expect(parseHistoryManifest({ ...legalManifestRaw(), format: 'other' }).ok).toBe(false)
    expect(parseHistoryManifest({ ...legalManifestRaw(), version: 2 }).ok).toBe(false)
    expect(parseHistoryManifest({ ...legalManifestRaw(), sqliteSha256: 'xyz' }).ok).toBe(false)
    expect(parseHistoryManifest({ ...legalManifestRaw(), sqliteFile: '..\\evil.sqlite' }).ok).toBe(false)
    expect(parseHistoryManifest(null).ok).toBe(false)
    expect(parseHistoryManifest('string').ok).toBe(false)
  })
})

describe('包体检（inspectHistoryPackage）', () => {
  it('inspectHistoryPackage: 真实工具产出的合法包通过并回读计数', async () => {
    const fixture = await buildPackageFixture(3)
    const outcome = await inspectHistoryPackage(fixture.manifestPath)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.counts.trainings).toBe(3)
    expect(outcome.sqlitePath).toBe(fixture.sqlitePath)
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('inspectHistoryPackage: trainer.sqlite 被篡改（sha256 不匹配）拒绝', async () => {
    const fixture = await buildPackageFixture(1)
    const bytes = await readFile(fixture.sqlitePath)
    await writeFile(fixture.sqlitePath, Buffer.concat([bytes, Buffer.from('tampered')]))
    const outcome = await inspectHistoryPackage(fixture.manifestPath)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('校验和')
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('inspectHistoryPackage: 清单计数与包内实际计数不一致拒绝', async () => {
    const fixture = await buildPackageFixture(2)
    const raw = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as Record<string, unknown>
    ;(raw.counts as Record<string, number>).trainings = 99
    await writeFile(fixture.manifestPath, JSON.stringify(raw), 'utf8')
    const outcome = await inspectHistoryPackage(fixture.manifestPath)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('计数')
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('inspectHistoryPackage: 损坏 manifest JSON 拒绝（不抛出）', async () => {
    const fixture = await buildPackageFixture(1)
    await writeFile(fixture.manifestPath, '{not json', 'utf8')
    const outcome = await inspectHistoryPackage(fixture.manifestPath)
    expect(outcome.ok).toBe(false)
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('inspectHistoryPackage: 包内库缺表（schema 非法）拒绝', async () => {
    const root = await freshDir('noschema')
    const dbPath = join(root, 'trainer.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.close()
    const manifest = { ...legalManifestRaw(), sqliteBytes: (await stat(dbPath)).size, sqliteSha256: createHash('sha256').update(await readFile(dbPath)).digest('hex') }
    await writeFile(join(root, '迁移清单.json'), JSON.stringify(manifest), 'utf8')
    const outcome = await inspectHistoryPackage(join(root, '迁移清单.json'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('trades')
    await rm(root, { recursive: true, force: true })
  })
})

describe('导入暂存（stageHistoryImport，fail-closed）', () => {
  it('stageHistoryImport: 目标库为空时暂存成功并完成 schema 升级，trainings 可读且 pending 就位', async () => {
    const fixture = await buildPackageFixture(3)
    const dataDir = await freshDir('stage-ok')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0) // v1.3.0 已建库（空 trainings）
    const outcome = await stageHistoryImport(fixture.manifestPath, target)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.requiresRestart).toBe(true)
    expect(outcome.trainings).toBe(3)
    const pending = `${target}${PENDING_HISTORY_SUFFIX}`
    expect(await stat(pending).then(s => s.size > 0)).toBe(true)
    // pending 已被 migrateDatabase 升级为 v1.3.0 schema（random_mode 列存在）
    const pendingDb = new DatabaseSync(pending, { readOnly: true })
    const columns = (pendingDb.prepare('PRAGMA table_info(trainings)').all() as Array<{ name: string }>).map(column => column.name)
    pendingDb.close()
    expect(columns).toContain('random_mode')
    // 目标原库未被替换（仍为空）
    expect(await countTrainingsOf(target)).toBe(0)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('stageHistoryImport: 目标库已有 trainings 行时拒绝合并且目标原状', async () => {
    const fixture = await buildPackageFixture(2)
    const dataDir = await freshDir('stage-busy')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 1) // 已有一条训练
    const before = await readFile(target)
    const outcome = await stageHistoryImport(fixture.manifestPath, target)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('已有训练历史')
    expect(await readFile(target)).toEqual(before)
    expect(await stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(() => true, () => false)).toBe(false)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('stageHistoryImport: 目标库不存在时按空库采用（首启干净场景）', async () => {
    const fixture = await buildPackageFixture(1)
    const dataDir = await freshDir('stage-absent')
    const target = join(dataDir, 'trainer.sqlite')
    const outcome = await stageHistoryImport(fixture.manifestPath, target)
    expect(outcome.ok).toBe(true)
    expect(await stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(s => s.size > 0)).toBe(true)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('stageHistoryImport: 拷贝中断（注入 writeFile 失败）不产生 pending 且无临时残留', async () => {
    const fixture = await buildPackageFixture(1)
    const dataDir = await freshDir('stage-interrupt')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const outcome = await stageHistoryImport(fixture.manifestPath, target, {
      fs: {
        stat: async path => (await stat(path)) as { size: number },
        readFileBytes: async path => new Uint8Array(await readFile(path)),
        writeFile: async () => { throw new Error('EIO: simulated interruption') },
        rename: async (oldPath, newPath) => { await import('node:fs/promises').then(fs => fs.rename(oldPath, newPath)) },
        rm: async path => { await rm(path, { force: true }) },
      },
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('EIO')
    const leftovers = (await readdir(dataDir)).filter(name => name.includes('mig-incoming'))
    expect(leftovers).toEqual([])
    expect(await countTrainingsOf(target)).toBe(0)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })
})

describe('启动应用（applyPendingHistoryAtBoot）', () => {
  it('applyPendingHistoryAtBoot: 无 pending 时 no-op', async () => {
    const dataDir = await freshDir('boot-none')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(false)
    expect(outcome.reason).toBe('none')
    expect(await countTrainingsOf(target)).toBe(0)
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 目标存在且为空时换库并留备份，trainings 行进入目标', async () => {
    const fixture = await buildPackageFixture(3)
    const dataDir = await freshDir('boot-swap')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    // 先经 stage 产出 pending（同一管线），再断开重启语义
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    expect(await countTrainingsOf(target)).toBe(3)
    const backups = (await readdir(dataDir)).filter(name => name.includes('pre-migration'))
    expect(backups).toHaveLength(1)
    expect(await stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(() => true, () => false)).toBe(false)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 目标不存在时直接采用 pending', async () => {
    const fixture = await buildPackageFixture(1)
    const dataDir = await freshDir('boot-absent')
    const target = join(dataDir, 'trainer.sqlite')
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    expect(await countTrainingsOf(target)).toBe(1)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 目标在暂存后变为非空时不换库且保留 pending', async () => {
    const fixture = await buildPackageFixture(2)
    const dataDir = await freshDir('boot-busy')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    // 模拟用户在暂存与重启之间创建了训练
    const db = new DatabaseSync(target)
    db.prepare("INSERT INTO trainings (tier, code, name, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600519','新训练','2026-05-01','2026-09-30','active',1000000,'2026-05-01T00:00:00.000Z')").run()
    db.close()
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(false)
    expect(outcome.reason).toBe('target-not-empty')
    expect(await countTrainingsOf(target)).toBe(1)
    expect(await stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(() => true, () => false)).toBe(true)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 换库 rename 失败时恢复原状（备份回退、pending 保留）', async () => {
    const fixture = await buildPackageFixture(2)
    const dataDir = await freshDir('boot-fail')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    let renameCalls = 0
    const outcome = await applyPendingHistoryAtBoot(target, {
      fs: {
        stat: async path => (await stat(path)) as { size: number },
        readFileBytes: async path => new Uint8Array(await readFile(path)),
        writeFile: async (path, data, options) => { await import('node:fs/promises').then(fs => fs.writeFile(path, data, options)) },
        rename: async (oldPath, newPath) => {
          renameCalls += 1
          if (renameCalls === 2) throw new Error('EPERM: simulated rename failure')
          await import('node:fs/promises').then(fs => fs.rename(oldPath, newPath))
        },
        rm: async path => { await rm(path, { force: true }) },
      },
    })
    expect(outcome.applied).toBe(false)
    if (outcome.applied) return
    expect(outcome.error).toContain('EPERM')
    expect(renameCalls).toBe(3) // 备份 + 失败换库 + 恢复回退
    expect(await countTrainingsOf(target)).toBe(0) // 原空库已恢复
    expect(await stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(() => true, () => false)).toBe(true) // pending 保留可重试
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })
})

describe('迁移 IPC（registerMigrationIpc）', () => {
  function captureIpc() {
    const handlers = new Map<string, (event: unknown, request: unknown) => unknown>()
    return {
      ipcMain: { handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => { handlers.set(channel, listener) } },
      invoke: (request: unknown) => {
        const handler = handlers.get('desktop-migration:invoke')
        if (!handler) throw new Error('handler not registered')
        return handler({}, request) as Promise<unknown>
      },
    }
  }

  it('registerMigrationIpc: 未知方法与未就绪数据目录返回结构化错误（不抛出）', async () => {
    const captured = captureIpc()
    registerMigrationIpc({
      ipcMain: captured.ipcMain,
      pickManifestFile: async () => null,
      databasePath: () => null,
      logger: console,
    })
    const unknown = await captured.invoke({ method: 'bogus' }) as { ok: boolean, error: string }
    expect(unknown.ok).toBe(false)
    expect(unknown.error).toContain('未知')
    const notReady = await captured.invoke({ method: 'inspect', manifestPath: 'x' }) as { ok: boolean, error: string }
    expect(notReady.ok).toBe(false)
    expect(notReady.error).toContain('未就绪')
  })

  it('registerMigrationIpc: pick→inspect→import 路由贯通（注入 picker，真实包）', async () => {
    const fixture = await buildPackageFixture(2)
    const dataDir = await freshDir('ipc')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const captured = captureIpc()
    registerMigrationIpc({
      ipcMain: captured.ipcMain,
      pickManifestFile: async () => fixture.manifestPath,
      databasePath: () => target,
      logger: console,
    })
    const picked = await captured.invoke({ method: 'pick' }) as { ok: boolean, manifestPath?: string }
    expect(picked.ok).toBe(true)
    expect(picked.manifestPath).toBe(fixture.manifestPath)
    const inspected = await captured.invoke({ method: 'inspect', manifestPath: fixture.manifestPath }) as { ok: boolean, counts?: Record<string, number> }
    expect(inspected.ok).toBe(true)
    expect(inspected.counts?.trainings).toBe(2)
    const imported = await captured.invoke({ method: 'import', manifestPath: fixture.manifestPath }) as { ok: boolean, requiresRestart?: boolean, trainings?: number }
    expect(imported.ok).toBe(true)
    expect(imported.requiresRestart).toBe(true)
    expect(imported.trainings).toBe(2)
    expect(await stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(() => true, () => false)).toBe(true)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('registerMigrationIpc: pick 取消返回结构化取消（ok false 且不误报错误路径）', async () => {
    const captured = captureIpc()
    registerMigrationIpc({
      ipcMain: captured.ipcMain,
      pickManifestFile: async () => null,
      databasePath: () => 'unused',
      logger: console,
    })
    const picked = await captured.invoke({ method: 'pick' }) as { ok: boolean, error?: string }
    expect(picked.ok).toBe(false)
    expect(picked.error).toContain('取消')
  })
})
