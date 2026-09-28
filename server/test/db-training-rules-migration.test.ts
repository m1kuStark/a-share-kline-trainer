import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase } from '../src/db.js'

// TRAIN-01：训练规则迁移——新增列与旧训练回填同一事务；幂等；失败整体回滚；
// 旧流水逐字段不变。全部使用内存库/临时文件库，不接触个人训练库。

function createOldSchemaDatabase(): DatabaseSync {
  // 模拟 TRAIN-01 之前的旧库：trainings 无 rules_json，含一条 forward 与一条 raw 运行中训练
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
      cost_after REAL NOT NULL
    );
    CREATE TABLE position_events (
      training_id INTEGER NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL,
      kind TEXT NOT NULL, shares_delta REAL NOT NULL, cash_delta REAL NOT NULL, cost_delta REAL,
      PRIMARY KEY (training_id, seq)
    );
  `)
  database.prepare("INSERT INTO settings (key, value) VALUES ('fees_enabled', '1')").run()
  database.prepare("INSERT INTO settings (key, value) VALUES ('t1_enabled', '0')").run()
  database.prepare("INSERT INTO settings (key, value) VALUES ('unrelated', 'keep')").run()
  database.prepare(`
    INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, blind,
      adjust_mode, initial_cash, created_at, current_date, current_close)
    VALUES ('1M', '600000', '旧forward', 'sh', '2025-01-02', '2025-02-02', 'running', 0,
      'forward', 1000000, '2025-01-01T00:00:00.000Z', '2025-01-10', 12.5)
  `).run()
  database.prepare(`
    INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, blind,
      adjust_mode, initial_cash, created_at, current_date, current_close)
    VALUES ('3M', '000001', '旧raw', 'sz', '2025-01-02', '2025-04-02', 'running', 0,
      'raw', 500000, '2025-01-01T00:00:00.000Z', '2025-01-20', 9.8)
  `).run()
  database.prepare(`
    INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after)
    VALUES (1, 1, '2025-01-02', 'buy', 12, 1000, 12000, 0, 988000, 1000, 12000)
  `).run()
  database.prepare(`
    INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta, cost_delta)
    VALUES (1, 1, '2025-01-10', 'corporate_action', 100, 240, NULL)
  `).run()
  return database
}

/** 旧列逐字段快照（不含新增列），用于断言旧行不变 */
function legacyRows(database: DatabaseSync): unknown {
  return {
    trainings: database.prepare(`
      SELECT id, tier, code, name, market, start_date, planned_end, status, blind,
        adjust_mode, initial_cash, created_at, current_date, current_close,
        settle_date, early_settle, note
      FROM trainings ORDER BY id
    `).all(),
    trades: database.prepare('SELECT * FROM trades ORDER BY id').all(),
    position_events: database.prepare('SELECT * FROM position_events ORDER BY training_id, seq').all(),
    settings: database.prepare('SELECT * FROM settings ORDER BY key').all(),
  }
}

function rulesOf(database: DatabaseSync, id: number): Record<string, unknown> {
  const row = database.prepare('SELECT rules_json FROM trainings WHERE id = ?').get(id) as unknown as { rules_json: string }
  return JSON.parse(row.rules_json) as Record<string, unknown>
}

describe('TRAINING-RULES：旧库迁移', () => {
  it('新增列与回填一次完成：旧行冻结迁移时点观察值（forward=cash-shares-v1，raw=legacy-raw-unverified），旧流水逐字段不变', () => {
    const database = createOldSchemaDatabase()
    try {
      const before = legacyRows(database)
      migrateDatabase(database)
      // 列存在且旧行全部回填
      const columns = (database.prepare('PRAGMA table_info(trainings)').all() as unknown as Array<{ name: string }>).map(entry => entry.name)
      expect(columns).toContain('rules_json')
      expect(database.prepare('SELECT COUNT(*) AS n FROM trainings WHERE rules_json IS NULL').get()).toEqual({ n: 0 })

      const forward = rulesOf(database, 1)
      expect(forward).toMatchObject({
        version: 1, feesEnabled: true, tPlusOne: false,
        commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100,
        execution: 'same-day-raw-close', weightBasis: 'total-equity',
        corporateActionPolicy: 'cash-shares-v1', origin: 'legacy-migration',
      })
      const raw = rulesOf(database, 2)
      expect(raw).toMatchObject({
        version: 1, feesEnabled: true, tPlusOne: false, origin: 'legacy-migration',
        corporateActionPolicy: 'legacy-raw-unverified',
      })
      // 同一次迁移的 capturedAt 为同一迁移时点
      expect(forward.capturedAt).toBe(raw.capturedAt)

      // 旧流水逐字段不变
      expect(legacyRows(database)).toEqual(before)
    } finally {
      database.close()
    }
  })

  it('反复迁移不改已冻结值（幂等）', () => {
    const database = createOldSchemaDatabase()
    try {
      migrateDatabase(database)
      const firstForward = rulesOf(database, 1)
      const firstRaw = rulesOf(database, 2)
      // 迁移后设置变化：已冻结规则不得漂移
      database.prepare("UPDATE settings SET value = '0' WHERE key = 'fees_enabled'").run()
      database.prepare("UPDATE settings SET value = '1' WHERE key = 't1_enabled'").run()
      migrateDatabase(database)
      migrateDatabase(database)
      expect(rulesOf(database, 1)).toEqual(firstForward)
      expect(rulesOf(database, 2)).toEqual(firstRaw)
    } finally {
      database.close()
    }
  })

  it('迁移事务失败整体回滚：列与回填都不落库，旧行不变', () => {
    const database = createOldSchemaDatabase()
    try {
      const before = legacyRows(database)
      // 临时触发器制造失败：只在本测试库存在，不向生产增加故障注入
      database.exec(`
        CREATE TRIGGER block_rules_backfill BEFORE UPDATE ON trainings
        BEGIN
          SELECT RAISE(ABORT, 'blocked by test trigger');
        END;
      `)
      expect(() => migrateDatabase(database)).toThrow(/blocked by test trigger/)
      // 回滚后：列不存在（DDL 一并回滚），旧行原样
      const columns = (database.prepare('PRAGMA table_info(trainings)').all() as unknown as Array<{ name: string }>).map(entry => entry.name)
      expect(columns).not.toContain('rules_json')
      expect(legacyRows(database)).toEqual(before)
      // 移除触发器后迁移成功
      database.exec('DROP TRIGGER block_rules_backfill')
      migrateDatabase(database)
      expect(rulesOf(database, 1).origin).toBe('legacy-migration')
    } finally {
      database.close()
    }
  })

  it('首次迁移完成后：后续启动不再把 NULL/损坏快照按当前默认重冻（返修 F2）', () => {
    const database = createOldSchemaDatabase()
    try {
      migrateDatabase(database)
      const frozenForward = rulesOf(database, 1)
      const frozenRaw = rulesOf(database, 2)
      // 首次迁移后新增训练（origin=created），随后快照损坏为 NULL
      const createdRules = JSON.stringify({
        version: 1, feesEnabled: false, tPlusOne: true,
        commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100,
        execution: 'same-day-raw-close', weightBasis: 'total-equity',
        corporateActionPolicy: 'cash-shares-v1',
        capturedAt: '2026-09-28T10:00:00.000Z', origin: 'created',
      })
      database.prepare(`
        INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, blind,
          adjust_mode, initial_cash, created_at, current_date, current_close, rules_json)
        VALUES ('1M', '600000', '新局', 'sh', '2025-01-02', '2025-02-02', 'running', 0,
          'forward', 1000000, '2025-01-01T00:00:00.000Z', '2025-01-02', 10, ?)
      `).run(createdRules)
      database.prepare('UPDATE trainings SET rules_json = NULL WHERE id = 3').run()
      // 重启前损坏快照必须不可读（409 语义由 engine 层保证，这里验证解析层）
      expect(database.prepare('SELECT rules_json FROM trainings WHERE id = 3').get()).toEqual({ rules_json: null })
      // 修改默认后再跑启动迁移：不得把损坏 NULL 行按新默认重冻、不得改写已冻结旧行
      database.prepare("UPDATE settings SET value = '0' WHERE key = 'fees_enabled'").run()
      database.prepare("UPDATE settings SET value = '1' WHERE key = 't1_enabled'").run()
      migrateDatabase(database)
      migrateDatabase(database)
      expect(rulesOf(database, 1)).toEqual(frozenForward)
      expect(rulesOf(database, 2)).toEqual(frozenRaw)
      expect(database.prepare('SELECT rules_json FROM trainings WHERE id = 3').get()).toEqual({ rules_json: null })
    } finally {
      database.close()
    }
  })

  it('重启（关闭后重开文件库）再迁移：默认与本局快照不变', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rules-migration-'))
    const databasePath = join(root, 'trainer.sqlite')
    try {
      {
        const database = new DatabaseSync(databasePath)
        database.exec(`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE trainings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, code TEXT NOT NULL,
            name TEXT NOT NULL, market TEXT NOT NULL DEFAULT 'sh', start_date TEXT NOT NULL,
            planned_end TEXT NOT NULL, status TEXT NOT NULL, blind INTEGER NOT NULL DEFAULT 0,
            adjust_mode TEXT NOT NULL DEFAULT 'forward', initial_cash REAL NOT NULL,
            created_at TEXT NOT NULL, current_date TEXT, current_close REAL,
            settle_date TEXT, early_settle INTEGER NOT NULL DEFAULT 0, note TEXT
          );
          INSERT INTO settings (key, value) VALUES ('fees_enabled', '0');
          INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, blind,
            adjust_mode, initial_cash, created_at, current_date, current_close)
          VALUES ('1M', '600000', '重启前', 'sh', '2025-01-02', '2025-02-02', 'running', 0,
            'forward', 1000000, '2025-01-01T00:00:00.000Z', '2025-01-10', 12.5);
        `)
        database.close()
      }
      {
        const database = new DatabaseSync(databasePath)
        migrateDatabase(database)
        const before = rulesOf(database, 1)
        database.close()
        const reopened = new DatabaseSync(databasePath)
        migrateDatabase(reopened)
        expect(rulesOf(reopened, 1)).toEqual(before)
        reopened.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
