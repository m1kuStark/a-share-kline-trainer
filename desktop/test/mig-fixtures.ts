import { DatabaseSync } from 'node:sqlite'

// MIG-INLINE-01 共享测试夹具：合法 v1.2.7 最小形状库。
// 形状与 mig-import.test.ts 的 buildLegalV127Db / server/test/migration-tool-history.test.ts
// 同构（schema 契约下界；每局业务键 (code, created_at) 互异——合并幂等键依赖）。
// 独立成文件而非 import 既有测试内部函数：测试文件互相 import 非仓库惯例。

export function buildLegalV127Db(dbPath: string, trainings = 2): void {
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
