// MIG-EXT-01 / MIG-MERGE-01：v1.2.7 训练历史导入（desktop 主进程侧）单测。
// 覆盖：迁移清单解析契约、包体检（sha256/schema/计数一致性）、暂存导入
// （schema 升级、非空合并语义、原子性中断恢复）、boot 合并应用（合并/备份/回滚/幂等/
// ID 重映射/命名空间保留）、IPC 路由（结构化错误不抛出）。
// 真实边界（harness 4.2）：迁移包由 tools/migrate-v127 真实 buildHistoryPackage 产出、
// schema 升级走 server/dist 真实 migrateDatabase、断言用 node:sqlite 直查。
// MIG-MERGE-01（2026-10-13）：整库换入改为合并式导入——迁移顺序不应影响迁移成功率
// （用户拍板），旧『非空拒绝/换库』断言按矩阵 binding_note 改为合并断言。
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
  const dir = join(tmpdir(), `migmerge01-${prefix}-${Date.now()}-${fixtureSeq += 1}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 合法 v1.2.7 最小形状库（契约下界；与 server/test/migration-tool-history.test.ts 同形状）。
 * MIG-MERGE-01：每局业务键 (code, created_at) 互异——合并幂等键依赖。 */
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
    db.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES (?,'600000',?,'sh','forward','2026-01-01','2026-06-30','active',1000000,?)")
      .run('t1', `标的${index}`, `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`)
  }
  db.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after) VALUES (1,1,'2026-01-05','buy',10.0,100,1000,5,998995,100,1000)").run()
  db.close()
}

/** 真实 v1.2.7 tag 形状库（server/src/db.ts@v1.2.7）：orders 全列（含 created_phase/
 * filled_trade_id）、trades.order_id、六张子表数据、cache_meta 三键。
 * 幂等键互异；局 1 挂全链子表（order↔trade 交叉引用）供 ID 重映射断言。 */
function buildLegalV127DbRich(dbPath: string, trainings = 2): void {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, code TEXT NOT NULL,
      name TEXT NOT NULL, market TEXT NOT NULL DEFAULT 'sh', start_date TEXT NOT NULL,
      planned_end TEXT NOT NULL, status TEXT NOT NULL, blind INTEGER NOT NULL DEFAULT 0,
      adjust_mode TEXT NOT NULL DEFAULT 'forward', initial_cash REAL NOT NULL,
      created_at TEXT NOT NULL, current_date TEXT, current_close REAL,
      settle_date TEXT, early_settle INTEGER NOT NULL DEFAULT 0, note TEXT
    );
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
      seq INTEGER NOT NULL, trade_date TEXT NOT NULL, side TEXT NOT NULL,
      price REAL NOT NULL, shares INTEGER NOT NULL, amount REAL NOT NULL,
      fee REAL NOT NULL, cash_after REAL NOT NULL, shares_after INTEGER NOT NULL,
      cost_after REAL NOT NULL, trade_phase TEXT NOT NULL DEFAULT 'close',
      execution_type TEXT NOT NULL DEFAULT 'market', reason TEXT, order_id INTEGER
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
      side TEXT NOT NULL, order_type TEXT NOT NULL, trigger_price_raw REAL NOT NULL,
      shares INTEGER NOT NULL, status TEXT NOT NULL, created_date TEXT NOT NULL,
      created_phase TEXT NOT NULL, expires_date TEXT, reason TEXT,
      filled_date TEXT, filled_phase TEXT, filled_trade_id INTEGER,
      status_reason TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE trade_notes (training_id INTEGER NOT NULL, trade_seq INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (training_id, trade_seq));
    CREATE TABLE equity_curve (training_id INTEGER NOT NULL, date TEXT NOT NULL, equity REAL NOT NULL, PRIMARY KEY (training_id, date));
    CREATE TABLE position_events (training_id INTEGER NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, shares_delta REAL NOT NULL, cash_delta REAL NOT NULL, cost_delta REAL, PRIMARY KEY (training_id, seq));
    CREATE TABLE drawings (training_id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE data_file_state (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms REAL NOT NULL, max_date TEXT, rows INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE data_refresh_log (id INTEGER PRIMARY KEY AUTOINCREMENT, finished_at TEXT NOT NULL, outcome TEXT NOT NULL, added INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0, revised INTEGER NOT NULL DEFAULT 0, source_kind TEXT NOT NULL, source_max_date TEXT, message TEXT NOT NULL DEFAULT '');
  `)
  db.prepare("INSERT INTO cache_meta (key, value) VALUES ('recording_namespace','bbbbbbbb-bbbb-4bbb-8bbb-cccccccccccc')").run()
  db.prepare("INSERT INTO cache_meta (key, value) VALUES ('saved-tdx-choice','D:\\\\old-tdx')").run()
  db.prepare("INSERT INTO cache_meta (key, value) VALUES ('legacy-flag','1')").run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('fee-rate','0.0003')").run()
  for (let index = 1; index <= trainings; index += 1) {
    db.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES (?, ?, ?, 'sh', 'forward', '2026-01-01', '2026-06-30', 'active', 1000000, ?)")
      .run('t1', `60000${index}`, `标的${index}`, `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`)
  }
  // 局 1 子表全链：order(旧id1) 由 trade seq2 成交（filled_trade_id=2）；trade seq2 由该条件单成交（order_id=1）
  db.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after, order_id) VALUES (1,1,'2026-01-05','buy',10.0,100,1000,5,998995,100,1000,NULL)").run()
  db.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after, order_id) VALUES (1,2,'2026-01-06','sell',10.5,100,1050,5,999995,0,0,1)").run()
  db.prepare("INSERT INTO orders (training_id, side, order_type, trigger_price_raw, shares, status, created_date, created_phase, filled_date, filled_phase, filled_trade_id, created_at) VALUES (1,'sell','limit',10.5,100,'filled','2026-01-05','close','2026-01-06','close',2,'2026-01-05T00:00:00.000Z')").run()
  db.prepare("INSERT INTO equity_curve (training_id, date, equity) VALUES (1,'2026-01-05',1000000)").run()
  db.prepare("INSERT INTO equity_curve (training_id, date, equity) VALUES (1,'2026-01-06',1004900)").run()
  db.prepare("INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta) VALUES (1,1,'2026-01-05','buy',100,-1005)").run()
  db.prepare("INSERT INTO drawings (training_id, payload, updated_at) VALUES (1,'{\"lines\":[\"hline:10.5\"]}','2026-01-06T00:00:00.000Z')").run()
  db.prepare("INSERT INTO trade_notes (training_id, trade_seq, note, updated_at) VALUES (1,1,'老版笔记','2026-01-06T00:00:00.000Z')").run()
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
  return finishPackageFixture(root, dbPath, trainings)
}

async function buildPackageFixtureRich(trainings = 2): Promise<PackageFixture> {
  const root = await freshDir('pkg-rich')
  const dbPath = join(root, 'trainer.sqlite')
  buildLegalV127DbRich(dbPath, trainings)
  return finishPackageFixture(root, dbPath, trainings)
}

async function finishPackageFixture(root: string, dbPath: string, trainings: number): Promise<PackageFixture> {
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
  return countRowsOf(dbPath, 'trainings')
}

async function countRowsOf(dbPath: string, table: string): Promise<number> {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  } finally {
    db.close()
  }
}

function queryOne(dbPath: string, sql: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(sql).get() as Record<string, unknown> | undefined
  } finally {
    db.close()
  }
}

async function pendingExists(target: string): Promise<boolean> {
  return stat(`${target}${PENDING_HISTORY_SUFFIX}`).then(() => true, () => false)
}

async function listBackups(dataDir: string): Promise<string[]> {
  return (await readdir(dataDir)).filter(name => /\.pre-migration-\d{8}-\d{6}\.bak$/.test(name))
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

describe('导入暂存（stageHistoryImport）', () => {
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

  it('stageHistoryImport: 目标库非空时不再拒绝（合并语义），预查跳过计数正确且目标原状', async () => {
    const fixture = await buildPackageFixtureRich(3) // 局键 600001..600003 / 2026-01-01..03
    const dataDir = await freshDir('stage-merge')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    // 既有局一条与包内第 2 局同业务键（code+created_at 完全一致）→ 应预查为跳过
    const db = new DatabaseSync(target)
    db.prepare("INSERT INTO trainings (tier, code, name, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600002','已存在的局','2026-01-01','2026-06-30','active',2000000,'2026-01-02T00:00:00.000Z')").run()
    db.close()
    const before = await readFile(target)
    const outcome = await stageHistoryImport(fixture.manifestPath, target)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.requiresRestart).toBe(true)
    expect(outcome.trainings).toBe(3)
    expect(outcome.skipped).toBe(1)
    expect(outcome.importing).toBe(2)
    expect(await readFile(target)).toEqual(before) // 暂存不写目标
    expect(await pendingExists(target)).toBe(true)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('stageHistoryImport: 目标库不存在时按空库采用（首启干净场景）', async () => {
    const fixture = await buildPackageFixture(1)
    const dataDir = await freshDir('stage-absent')
    const target = join(dataDir, 'trainer.sqlite')
    const outcome = await stageHistoryImport(fixture.manifestPath, target)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.skipped).toBe(0)
    expect(await pendingExists(target)).toBe(true)
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

describe('启动合并应用（applyPendingHistoryAtBoot，MIG-MERGE-01）', () => {
  it('applyPendingHistoryAtBoot: 无 pending 时 no-op', async () => {
    const dataDir = await freshDir('boot-none')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(false)
    if (outcome.applied) return
    expect(outcome.reason).toBe('none')
    expect(await countTrainingsOf(target)).toBe(0)
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 目标存在且为空时合并导入并留备份（不再整库换入）', async () => {
    const fixture = await buildPackageFixture(3)
    const dataDir = await freshDir('boot-merge-empty')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    if (!outcome.applied) return
    expect(outcome.imported).toBe(3)
    expect(outcome.skipped).toBe(0)
    expect(await countTrainingsOf(target)).toBe(3)
    expect(await listBackups(dataDir)).toHaveLength(1)
    expect(await pendingExists(target)).toBe(false)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 目标不存在时直接采用 pending（无备份产生）', async () => {
    const fixture = await buildPackageFixture(1)
    const dataDir = await freshDir('boot-absent')
    const target = join(dataDir, 'trainer.sqlite')
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    expect(await countTrainingsOf(target)).toBe(1)
    expect(await listBackups(dataDir)).toEqual([])
    expect(await pendingExists(target)).toBe(false)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('MIG-MERGE-NONEMPTY: 目标非空（用户已先训练）时合并导入，新旧训练并存且既有数据零损伤', async () => {
    const fixture = await buildPackageFixtureRich(3)
    const dataDir = await freshDir('boot-nonempty')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 1)
    // 既有新训练挂权益曲线，合并后必须原样保留
    const db = new DatabaseSync(target)
    const existingId = (db.prepare("SELECT id FROM trainings WHERE code = '600519'").get() as { id: number }).id
    db.prepare('INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)').run(existingId, '2026-03-05', 1000000)
    db.prepare('INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)').run(existingId, '2026-03-06', 1010000)
    db.close()
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true) // 旧实现此处拒绝（target-not-empty）——本行为即 wave-c 主缺陷
    if (!staged.ok) return
    expect(staged.skipped).toBe(0)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    if (!outcome.applied) return
    expect(outcome.imported).toBe(3)
    expect(outcome.skipped).toBe(0)
    expect(await countTrainingsOf(target)).toBe(4)
    // 既有新训练行与其权益曲线原样（零损伤）
    const kept = queryOne(target, "SELECT id, code, created_at, initial_cash FROM trainings WHERE code = '600519'")
    expect(kept?.id).toBe(existingId)
    expect(kept?.created_at).toBe('2026-03-01T00:00:00.000Z')
    expect((queryOne(target, `SELECT COUNT(*) AS count FROM equity_curve WHERE training_id = ${existingId}`) as { count: number }).count).toBe(2)
    // 导入局全部在场且规则快照随暂存升级冻结（MIG-MERGE-SCHEMA-STAGE）
    const imported = queryOne(target, "SELECT COUNT(*) AS count FROM trainings WHERE code LIKE '60000%' AND rules_json IS NOT NULL")
    expect((imported as { count: number }).count).toBe(3)
    // 非空合并路径同样不改既有录像命名空间（MIG-MERGE-NS-PRESERVE 非空面）
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('MIG-MERGE-ID-REMAP: 导入局 ID 与既有局冲突时分配新 ID 并全链重映射引用，不覆盖不丢弃', async () => {
    const fixture = await buildPackageFixtureRich(2) // 包内局旧 id=1,2，与目标既有局 id=1,2 撞号
    const dataDir = await freshDir('boot-remap')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 2) // 既有局 id=1,2（code 600519）
    // 既有局已持有 trades id=1,2 与 orders id=1,2 → 导入行新 id 从 3 起跳，与包内旧号分离
    // （变异抽检：若删掉重映射，旧 order_id=1 将不等于新 order id=3，断言必死）
    const warm = new DatabaseSync(target)
    for (const seq of [1, 2]) {
      warm.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after) VALUES (1,?,'2026-03-05','buy',1700.0,100,170000,5,829995,100,170000)").run(seq)
    }
    for (const trigger of [1720.0, 1690.0]) {
      warm.prepare("INSERT INTO orders (training_id, side, order_type, trigger_price_raw, shares, status, created_date, created_phase, created_at) VALUES (1,'sell','limit',?,100,'expired','2026-03-05','close','2026-03-05T00:00:00.000Z')").run(trigger)
    }
    warm.close()
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    if (!outcome.applied) return
    expect(outcome.imported).toBe(2)
    expect(await countTrainingsOf(target)).toBe(4)
    // 既有 id=1,2 未被覆盖（仍 600519）；导入局分配新 id=3,4
    expect((queryOne(target, 'SELECT code FROM trainings WHERE id = 1') as { code: string }).code).toBe('600519')
    expect((queryOne(target, 'SELECT code FROM trainings WHERE id = 2') as { code: string }).code).toBe('600519')
    const newId1 = (queryOne(target, "SELECT id FROM trainings WHERE code = '600001'") as { id: number }).id
    const newId2 = (queryOne(target, "SELECT id FROM trainings WHERE code = '600002'") as { id: number }).id
    expect(newId1).toBe(3)
    expect(newId2).toBe(4)
    // 子表引用闭合：trades/equity_curve/position_events/drawings/trade_notes 全部挂到新 id
    expect((queryOne(target, `SELECT COUNT(*) AS count FROM trades WHERE training_id = ${newId1}`) as { count: number }).count).toBe(2)
    expect((queryOne(target, `SELECT COUNT(*) AS count FROM equity_curve WHERE training_id = ${newId1}`) as { count: number }).count).toBe(2)
    expect((queryOne(target, `SELECT COUNT(*) AS count FROM position_events WHERE training_id = ${newId1}`) as { count: number }).count).toBe(1)
    expect((queryOne(target, `SELECT payload FROM drawings WHERE training_id = ${newId1}`) as { payload: string }).payload).toContain('hline')
    expect((queryOne(target, `SELECT note FROM trade_notes WHERE training_id = ${newId1} AND trade_seq = 1`) as { note: string }).note).toBe('老版笔记')
    // 交叉引用重映射（新旧 id 分离下的精确值）：包内 order 旧 id1→新 id3；trade seq2 旧 id2→新 id4
    const newTrade2Id = (queryOne(target, `SELECT id FROM trades WHERE training_id = ${newId1} AND seq = 2`) as { id: number }).id
    const newOrderId = (queryOne(target, `SELECT id FROM orders WHERE training_id = ${newId1}`) as { id: number }).id
    expect(newOrderId).toBe(3)
    expect(newTrade2Id).toBe(4)
    const remappedTrade = queryOne(target, `SELECT order_id FROM trades WHERE id = ${newTrade2Id}`) as { order_id: number | null }
    expect(remappedTrade.order_id).toBe(newOrderId)
    const remappedOrder = queryOne(target, `SELECT filled_trade_id FROM orders WHERE id = ${newOrderId}`) as { filled_trade_id: number | null }
    expect(remappedOrder.filled_trade_id).toBe(newTrade2Id)
    // 引用闭合：导入局所有非空交叉引用都指向本局行（无悬垂、无指向他人局）
    const danglingOrderRef = queryOne(target, `SELECT COUNT(*) AS count FROM trades t WHERE t.training_id = ${newId1} AND t.order_id IS NOT NULL AND t.order_id NOT IN (SELECT id FROM orders WHERE training_id = ${newId1})`) as { count: number }
    expect(danglingOrderRef.count).toBe(0)
    const danglingTradeRef = queryOne(target, `SELECT COUNT(*) AS count FROM orders o WHERE o.training_id = ${newId1} AND o.filled_trade_id IS NOT NULL AND o.filled_trade_id NOT IN (SELECT id FROM trades WHERE training_id = ${newId1})`) as { count: number }
    expect(danglingTradeRef.count).toBe(0)
    // 既有子表行不被覆盖、不丢弃（目标总 trades=4：既有 2＋导入 2）
    expect(await countRowsOf(target, 'trades')).toBe(4)
    expect(await countRowsOf(target, 'orders')).toBe(3)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('MIG-MERGE-IDEMPOTENT: 同一迁移包二次导入按业务键跳过全部局且子表不重复', async () => {
    const fixture = await buildPackageFixtureRich(3)
    const dataDir = await freshDir('boot-idem')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 1)
    const staged1 = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged1.ok).toBe(true)
    if (!staged1.ok) return
    expect(staged1.skipped).toBe(0)
    const applied1 = await applyPendingHistoryAtBoot(target)
    expect(applied1.applied).toBe(true)
    if (!applied1.applied) return
    expect(applied1.imported).toBe(3)
    expect(await countTrainingsOf(target)).toBe(4)
    const tradesAfterFirst = await countRowsOf(target, 'trades')
    const ordersAfterFirst = await countRowsOf(target, 'orders')
    // 同一包再次导入：stage 预查全部命中既有业务键
    const staged2 = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged2.ok).toBe(true)
    if (!staged2.ok) return
    expect(staged2.skipped).toBe(3)
    expect(staged2.importing).toBe(0)
    const applied2 = await applyPendingHistoryAtBoot(target)
    expect(applied2.applied).toBe(true)
    if (!applied2.applied) return
    expect(applied2.imported).toBe(0)
    expect(applied2.skipped).toBe(3)
    expect(await countTrainingsOf(target)).toBe(4)
    expect(await countRowsOf(target, 'trades')).toBe(tradesAfterFirst)
    expect(await countRowsOf(target, 'orders')).toBe(ordersAfterFirst)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('MIG-MERGE-NS-PRESERVE: 空/非空目标合并后 recording_namespace 均不变，cache_meta 其他键仅缺失时带入', async () => {
    const newNamespace = 'aaaaaaaa-aaaa-4aaa-8aaa-dddddddddddd'
    // 场景一（wave-c 复现）：目标库空 trainings 但已有 ns（用户先导入了录像）
    const fixture = await buildPackageFixtureRich(2)
    const dataDirEmpty = await freshDir('boot-ns-empty')
    const targetEmpty = join(dataDirEmpty, 'trainer.sqlite')
    buildV130Target(targetEmpty, 0)
    let db = new DatabaseSync(targetEmpty)
    db.prepare("INSERT INTO cache_meta (key, value) VALUES ('recording_namespace', ?)").run(newNamespace)
    db.prepare("INSERT INTO cache_meta (key, value) VALUES ('saved-tdx-choice', 'D:\\\\new-tdx')").run()
    db.close()
    const stagedEmpty = await stageHistoryImport(fixture.manifestPath, targetEmpty)
    expect(stagedEmpty.ok).toBe(true)
    const appliedEmpty = await applyPendingHistoryAtBoot(targetEmpty)
    expect(appliedEmpty.applied).toBe(true)
    expect((queryOne(targetEmpty, "SELECT value FROM cache_meta WHERE key = 'recording_namespace'") as { value: string }).value).toBe(newNamespace)
    expect((queryOne(targetEmpty, "SELECT value FROM cache_meta WHERE key = 'saved-tdx-choice'") as { value: string }).value).toBe('D:\\\\new-tdx')
    expect((queryOne(targetEmpty, "SELECT value FROM cache_meta WHERE key = 'legacy-flag'") as { value: string }).value).toBe('1')
    // 场景二：目标非空同样保 ns
    const dataDirBusy = await freshDir('boot-ns-busy')
    const targetBusy = join(dataDirBusy, 'trainer.sqlite')
    buildV130Target(targetBusy, 1)
    db = new DatabaseSync(targetBusy)
    db.prepare("INSERT INTO cache_meta (key, value) VALUES ('recording_namespace', ?)").run(newNamespace)
    db.close()
    const stagedBusy = await stageHistoryImport(fixture.manifestPath, targetBusy)
    expect(stagedBusy.ok).toBe(true)
    const appliedBusy = await applyPendingHistoryAtBoot(targetBusy)
    expect(appliedBusy.applied).toBe(true)
    expect((queryOne(targetBusy, "SELECT value FROM cache_meta WHERE key = 'recording_namespace'") as { value: string }).value).toBe(newNamespace)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDirEmpty, { recursive: true, force: true })
    await rm(dataDirBusy, { recursive: true, force: true })
  })

  it('MIG-MERGE-SCHEMA-STAGE: 包库 schema 旧于当前，经暂存升级后合并入目标可读（rules_json 冻结、random_mode 列在）', async () => {
    const fixture = await buildPackageFixture(2) // 最小形状：无 rules_json/random_mode 列
    const dataDir = await freshDir('boot-schema')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    // 暂存副本已升级（pending 内 trainings 有 random_mode 且 rules_json 已回填冻结）
    const pending = `${target}${PENDING_HISTORY_SUFFIX}`
    const pendingDb = new DatabaseSync(pending, { readOnly: true })
    const pendingColumns = (pendingDb.prepare('PRAGMA table_info(trainings)').all() as Array<{ name: string }>).map(column => column.name)
    const pendingFrozen = (pendingDb.prepare('SELECT COUNT(*) AS count FROM trainings WHERE rules_json IS NOT NULL').get() as { count: number }).count
    pendingDb.close()
    expect(pendingColumns).toContain('random_mode')
    expect(pendingFrozen).toBe(2)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    if (!outcome.applied) return
    expect(outcome.imported).toBe(2)
    const imported = queryOne(target, "SELECT COUNT(*) AS count FROM trainings WHERE rules_json IS NOT NULL AND initial_cash = 1000000 AND status = 'active'")
    expect((imported as { count: number }).count).toBe(2)
    const targetColumns = queryOne(target, "SELECT COUNT(*) AS count FROM pragma_table_info('trainings') WHERE name = 'random_mode'") as { count: number }
    expect(targetColumns.count).toBe(1)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('MIG-MERGE-ATOMIC-RECOVER: 合并中断时目标库回导入前状态、pending 保留，修复后重试成功', async () => {
    const fixture = await buildPackageFixtureRich(2)
    const dataDir = await freshDir('boot-atomic')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 1)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    // 注入合并中断：目标缺 trade_notes 表（事务中途 INSERT 失败）
    const damaged = new DatabaseSync(target)
    damaged.exec('DROP TABLE trade_notes')
    damaged.close()
    const failed = await applyPendingHistoryAtBoot(target)
    expect(failed.applied).toBe(false)
    if (failed.applied) return
    expect(failed.reason).toBe('merge-failed')
    expect(failed.error ?? '').not.toBe('')
    expect(await countTrainingsOf(target)).toBe(1) // ROLLBACK：导入行不残留
    expect(await pendingExists(target)).toBe(true) // pending 保留可重试
    // 修复目标结构后重试：全部局导入成功（幂等键未被半迁移污染）
    const repair = new DatabaseSync(target)
    migrateDatabase(repair)
    repair.close()
    const retried = await applyPendingHistoryAtBoot(target)
    expect(retried.applied).toBe(true)
    if (!retried.applied) return
    expect(retried.imported).toBe(2)
    expect(await countTrainingsOf(target)).toBe(3)
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('MIG-MERGE-BACKUP: 合并前整库备份 .pre-migration-<时间戳>.bak 且内容为导入前状态', async () => {
    const fixture = await buildPackageFixtureRich(2)
    const dataDir = await freshDir('boot-backup')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 1)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    const backups = await listBackups(dataDir)
    expect(backups).toHaveLength(1)
    const backupPath = join(dataDir, backups[0])
    expect(await countTrainingsOf(backupPath)).toBe(1) // 备份＝导入前快照
    expect((queryOne(backupPath, "SELECT COUNT(*) AS count FROM trainings WHERE code LIKE '60000%'") as { count: number }).count).toBe(0)
    expect(await countTrainingsOf(target)).toBe(3) // 目标＝导入后状态
    await rm(fixture.root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('applyPendingHistoryAtBoot: 暂存后用户又新建训练（先训练后迁移场景）仍合并并存', async () => {
    const fixture = await buildPackageFixtureRich(2)
    const dataDir = await freshDir('boot-trainfirst')
    const target = join(dataDir, 'trainer.sqlite')
    buildV130Target(target, 0)
    const staged = await stageHistoryImport(fixture.manifestPath, target)
    expect(staged.ok).toBe(true)
    // 模拟用户在暂存与重启之间创建了训练（旧实现此处 target-not-empty 暂缓，永不上岸）
    const db = new DatabaseSync(target)
    db.prepare("INSERT INTO trainings (tier, code, name, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600519','重启前新建','2026-05-01','2026-09-30','active',1000000,'2026-05-01T00:00:00.000Z')").run()
    db.close()
    const outcome = await applyPendingHistoryAtBoot(target)
    expect(outcome.applied).toBe(true)
    if (!outcome.applied) return
    expect(outcome.imported).toBe(2)
    expect(await countTrainingsOf(target)).toBe(3)
    expect((queryOne(target, "SELECT COUNT(*) AS count FROM trainings WHERE code = '600519'") as { count: number }).count).toBe(1)
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
    const imported = await captured.invoke({ method: 'import', manifestPath: fixture.manifestPath }) as { ok: boolean, requiresRestart?: boolean, trainings?: number, skipped?: number, importing?: number }
    expect(imported.ok).toBe(true)
    expect(imported.requiresRestart).toBe(true)
    expect(imported.trainings).toBe(2)
    expect(imported.skipped).toBe(0)
    expect(imported.importing).toBe(2)
    expect(await pendingExists(target)).toBe(true)
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
