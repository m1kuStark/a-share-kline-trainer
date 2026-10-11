// MIG-EXT-01：v1.2.7 训练历史（SQLite）迁移导出单测（工具侧）。
// 覆盖：历史迁移包产出契约（文件夹+trainer.sqlite+迁移清单.json，中文文件名+ASCII 键）、
// WAL 折叠为自包含单文件、损坏/缺表/缺关键列 fail-closed 拒绝、清单 sha256 与文件一致、
// 历史摘要计数、导出页模板含训练历史区块（源契约）。
// 真实样本形状对齐 C:\Users\...\kline-trainer-v1.2.7-windows-x64\data\trainer.sqlite
// （trainings/trades/orders/equity_curve/drawings/trade_notes/position_events 表已验）。
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import tool from '../../tools/migrate-v127/dist/migrate-v127/export-v127.cjs'
import { migrateDatabase } from '../src/db'

const { buildHistoryPackage, readHistorySummary } = tool as {
  buildHistoryPackage: (databasePath: string, packageRoot: string, now?: Date) => Promise<
    | { ok: true, folder: string, files: Array<{ file: string, bytes: number }>, manifest: Record<string, unknown> }
    | { ok: false, error: string }>
  readHistorySummary: (dbPath: string) => Promise<
    | { ok: true, sqliteBytes: number, counts: Record<string, number> }
    | { ok: false, error: string }>
}

let fixtureSeq = 0
async function freshDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `migext01-${prefix}-${Date.now()}-${fixtureSeq += 1}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 合法 v1.2.7 形状的最小库：9 张必备表＋关键列（宽容多余列的口径下最小即可），含 2 训练 + 明细行 */
function buildLegalV127Db(dbPath: string, rows: { trainings?: number } = {}): void {
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
  const trainings = rows.trainings ?? 2
  for (let index = 1; index <= trainings; index += 1) {
    db.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600000','浦发银行','sh','forward','2026-01-0' + ?, '2026-06-30','active',1000000,'2026-01-01T00:00:00.000Z')").run(index)
  }
  db.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after) VALUES (1,1,'2026-01-05','buy',10.0,100,1000,5,998995,100,1000)").run()
  db.prepare("INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after) VALUES (1,2,'2026-01-06','sell',10.5,100,1050,5.53,1000039.47,0,0)").run()
  db.prepare("INSERT INTO orders (training_id, side, order_type, trigger_price_raw, shares, status, created_date, created_at) VALUES (1,'buy','limit',10.2,100,'filled','2026-01-05','2026-01-05T14:00:00.000Z')").run()
  for (const [index, date] of ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'].entries()) {
    db.prepare('INSERT INTO equity_curve (training_id, date, equity) VALUES (1, ?, ?)').run(date, 1_000_000 + index)
  }
  db.prepare("INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta) VALUES (1,1,'2026-01-05','trade-buy',100,-1005)").run()
  db.prepare("INSERT INTO drawings (training_id, payload) VALUES (1, '{}')").run()
  db.prepare("INSERT INTO trade_notes (training_id, trade_seq, note, updated_at) VALUES (1,1,'首笔','2026-01-05T15:00:00.000Z')").run()
  db.close()
}

describe('工具侧历史包导出（export-tool.cjs）', () => {
  it('buildHistoryPackage: 合法 v1.2.7 库产出迁移包（trainer.sqlite＋迁移清单.json，清单契约与计数）', async () => {
    const root = await freshDir('legal')
    const dbPath = join(root, 'trainer.sqlite')
    buildLegalV127Db(dbPath)
    const out = await buildHistoryPackage(dbPath, root, new Date(2026, 9, 12, 8, 30, 0))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.folder).toBe(join(root, '训练历史迁移-20261012-083000'))
    const names = (await readdir(out.folder)).sort()
    expect(names).toEqual(['trainer.sqlite', '迁移清单.json'])
    const manifest = JSON.parse(await readFile(join(out.folder, '迁移清单.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.format).toBe('trainer-history-migration')
    expect(manifest.version).toBe(1)
    expect(manifest.sqliteFile).toBe('trainer.sqlite')
    expect(typeof manifest.exportedAt).toBe('string')
    const counts = manifest.counts as Record<string, number>
    expect(counts).toEqual({ trainings: 2, trades: 2, orders: 1, equityCurve: 4, positionEvents: 1, drawings: 1, tradeNotes: 1 })
    // 包内库可独立打开读出训练行（自包含：无 -wal/-shm 依赖）
    const packaged = new DatabaseSync(join(out.folder, 'trainer.sqlite'), { readOnly: true })
    const trainings = packaged.prepare('SELECT id, code, initial_cash FROM trainings ORDER BY id').all() as Array<{ id: number, code: string, initial_cash: number }>
    expect(trainings).toHaveLength(2)
    expect(trainings[0]).toMatchObject({ id: 1, code: '600000', initial_cash: 1_000_000 })
    packaged.close()
    await rm(root, { recursive: true, force: true })
  })

  it('buildHistoryPackage: WAL 未合并库被折叠为自包含单文件（包内读数完整）', async () => {
    const root = await freshDir('wal')
    const dbPath = join(root, 'trainer.sqlite')
    buildLegalV127Db(dbPath)
    // 以 WAL 模式补写一行训练且保持连接打开：-wal 携带未合并数据（模拟 v1.2.7 停服前状态）
    const live = new DatabaseSync(dbPath)
    live.exec('PRAGMA journal_mode = WAL')
    live.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES ('t1','600001','测试','sh','forward','2026-02-01','2026-06-30','active',1000000,'2026-02-01T00:00:00.000Z')").run()
    const walPath = `${dbPath}-wal`
    expect(await stat(walPath).then(s => s.size > 0, () => false)).toBe(true)
    const out = await buildHistoryPackage(dbPath, root, new Date(2026, 9, 12, 8, 31, 0))
    live.close()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect((out.manifest.counts as Record<string, number>).trainings).toBe(3)
    const packaged = new DatabaseSync(join(out.folder, 'trainer.sqlite'), { readOnly: true })
    expect((packaged.prepare('SELECT COUNT(*) AS c FROM trainings').get() as { c: number }).c).toBe(3)
    packaged.close()
    await rm(root, { recursive: true, force: true })
  })

  it('buildHistoryPackage: 损坏 sqlite 文件返回结构化失败（不抛出、不产出文件夹）', async () => {
    const root = await freshDir('corrupt')
    const dbPath = join(root, 'trainer.sqlite')
    await writeFile(dbPath, Buffer.from('this is definitely not a sqlite database file ..........'), 'utf8')
    const out = await buildHistoryPackage(dbPath, root)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('训练库')
    const entries = (await readdir(root)).filter(name => name.startsWith('训练历史迁移'))
    expect(entries).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('buildHistoryPackage: 缺 trainings 表返回结构化失败', async () => {
    const root = await freshDir('missing-table')
    const dbPath = join(root, 'trainer.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.close()
    const out = await buildHistoryPackage(dbPath, root)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('trainings')
    await rm(root, { recursive: true, force: true })
  })

  it('buildHistoryPackage: trainings 缺关键列 initial_cash 返回结构化失败', async () => {
    const root = await freshDir('missing-col')
    const dbPath = join(root, 'trainer.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE trainings (id INTEGER PRIMARY KEY, tier TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, market TEXT, adjust_mode TEXT, start_date TEXT NOT NULL, planned_end TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE trades (id INTEGER PRIMARY KEY, training_id INTEGER NOT NULL, seq INTEGER NOT NULL, trade_date TEXT NOT NULL, side TEXT NOT NULL, price REAL NOT NULL, shares INTEGER NOT NULL, amount REAL NOT NULL, fee REAL NOT NULL, cash_after REAL NOT NULL, shares_after INTEGER NOT NULL, cost_after REAL NOT NULL);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, training_id INTEGER NOT NULL, side TEXT NOT NULL, order_type TEXT NOT NULL, trigger_price_raw REAL NOT NULL, shares INTEGER NOT NULL, status TEXT NOT NULL, created_date TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE equity_curve (training_id INTEGER NOT NULL, date TEXT NOT NULL, equity REAL NOT NULL);
      CREATE TABLE position_events (training_id INTEGER NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, shares_delta REAL NOT NULL, cash_delta REAL NOT NULL);
      CREATE TABLE drawings (training_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE trade_notes (training_id INTEGER NOT NULL, trade_seq INTEGER NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL);
    `)
    db.close()
    const out = await buildHistoryPackage(dbPath, root)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('initial_cash')
    await rm(root, { recursive: true, force: true })
  })

  it('buildHistoryPackage: 清单 sha256 与包内 trainer.sqlite 逐字节一致', async () => {
    const root = await freshDir('sha')
    const dbPath = join(root, 'trainer.sqlite')
    buildLegalV127Db(dbPath, { trainings: 1 })
    const out = await buildHistoryPackage(dbPath, root)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const bytes = await readFile(join(out.folder, 'trainer.sqlite'))
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(out.manifest.sqliteSha256).toBe(digest)
    expect(out.manifest.sqliteBytes).toBe(bytes.byteLength)
    await rm(root, { recursive: true, force: true })
  })

  it('buildHistoryPackage: 同一秒重复导出自动加序号不覆盖', async () => {
    const root = await freshDir('dup')
    const dbPath = join(root, 'trainer.sqlite')
    buildLegalV127Db(dbPath)
    const now = new Date(2026, 9, 12, 8, 32, 0)
    const first = await buildHistoryPackage(dbPath, root, now)
    const second = await buildHistoryPackage(dbPath, root, now)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.folder).not.toBe(first.folder)
    expect(second.folder).toBe(join(root, '训练历史迁移-20261012-083200-1'))
    await rm(root, { recursive: true, force: true })
  })

  it('readHistorySummary: 历史摘要计数与库内容一致', async () => {
    const root = await freshDir('summary')
    const dbPath = join(root, 'trainer.sqlite')
    buildLegalV127Db(dbPath)
    const summary = await readHistorySummary(dbPath)
    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.counts).toEqual({ trainings: 2, trades: 2, orders: 1, equityCurve: 4, positionEvents: 1, drawings: 1, tradeNotes: 1 })
    expect(summary.sqliteBytes).toBe((await stat(dbPath)).size)
    await rm(root, { recursive: true, force: true })
  })

  it('readHistorySummary: 缺库文件返回结构化失败（原因含路径）', async () => {
    const root = await freshDir('summary-missing')
    const summary = await readHistorySummary(join(root, 'trainer.sqlite'))
    expect(summary.ok).toBe(false)
    if (summary.ok) return
    expect(summary.error).toContain('trainer.sqlite')
    await rm(root, { recursive: true, force: true })
  })
})

describe('工具侧历史包与 v1.3.0 迁移链衔接', () => {
  it('buildHistoryPackage: 产物经 server migrateDatabase 升级后 trainings 可读（v1.2.7→v1.3.0 schema 升级链）', async () => {
    const root = await freshDir('upgrade')
    const dbPath = join(root, 'trainer.sqlite')
    buildLegalV127Db(dbPath, { trainings: 3 })
    const out = await buildHistoryPackage(dbPath, root)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const upgradedPath = join(root, 'upgraded.sqlite')
    await readFile(join(out.folder, 'trainer.sqlite')).then(bytes => import('node:fs/promises').then(fs => fs.writeFile(upgradedPath, bytes)))
    const upgraded = new DatabaseSync(upgradedPath)
    migrateDatabase(upgraded)
    const rows = upgraded.prepare('SELECT id FROM trainings ORDER BY id').all() as Array<{ id: number }>
    expect(rows).toHaveLength(3)
    const columns = (upgraded.prepare('PRAGMA table_info(trainings)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).toContain('random_mode')
    expect(columns).toContain('rules_json')
    upgraded.close()
    await rm(root, { recursive: true, force: true })
  })
})

describe('导出页训练历史分节（源契约）', () => {
  it('页面模板含训练历史区块与导出按钮，工具路由含 pack-history', async () => {
    const { readFile } = await import('node:fs/promises')
    const template = await readFile('tools/migrate-v127/src/page-template.html', 'utf8')
    expect(template).toContain('id="history"')
    expect(template).toContain('id="history-export-btn"')
    const cjs = await readFile('tools/migrate-v127/dist/migrate-v127/export-v127.cjs', 'utf8')
    expect(cjs).toContain('/pack-history')
  })
})
