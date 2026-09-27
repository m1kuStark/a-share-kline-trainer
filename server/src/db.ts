import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { legacyMigrationRules, serializeTrainingRules } from './train/rules.js'

export function openDatabase(filePath: string): DatabaseSync {
  return new DatabaseSync(filePath)
}

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stocks (
      code TEXT PRIMARY KEY, market TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'A', bars INTEGER NOT NULL DEFAULT 0,
      mtime TEXT NOT NULL, last_date TEXT
    );
    CREATE TABLE IF NOT EXISTS adj_factors (
      market TEXT NOT NULL, code TEXT NOT NULL, date TEXT NOT NULL,
      dividend REAL NOT NULL, rights_price REAL NOT NULL,
      bonus_shares REAL NOT NULL, rights_shares REAL NOT NULL,
      m REAL NOT NULL, c REAL NOT NULL,
      PRIMARY KEY (market, code, date)
    );
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, code TEXT NOT NULL,
      name TEXT NOT NULL, market TEXT NOT NULL DEFAULT 'sh', start_date TEXT NOT NULL,
      planned_end TEXT NOT NULL, status TEXT NOT NULL, blind INTEGER NOT NULL DEFAULT 0,
      adjust_mode TEXT NOT NULL DEFAULT 'forward', initial_cash REAL NOT NULL,
      created_at TEXT NOT NULL, current_date TEXT, current_close REAL,
      settle_date TEXT, early_settle INTEGER NOT NULL DEFAULT 0, note TEXT
    );
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
      seq INTEGER NOT NULL, trade_date TEXT NOT NULL, side TEXT NOT NULL,
      price REAL NOT NULL, shares INTEGER NOT NULL, amount REAL NOT NULL,
      fee REAL NOT NULL, cash_after REAL NOT NULL, shares_after INTEGER NOT NULL,
      cost_after REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS equity_curve (
      training_id INTEGER NOT NULL, date TEXT NOT NULL, equity REAL NOT NULL,
      PRIMARY KEY (training_id, date)
    );
    CREATE TABLE IF NOT EXISTS position_events (
      training_id INTEGER NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL,
      kind TEXT NOT NULL, shares_delta REAL NOT NULL, cash_delta REAL NOT NULL, cost_delta REAL,
      PRIMARY KEY (training_id, seq)
    );
    CREATE TABLE IF NOT EXISTS drawings (
      training_id INTEGER PRIMARY KEY REFERENCES trainings(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_file_state (
      path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms REAL NOT NULL,
      max_date TEXT, rows INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS data_refresh_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, finished_at TEXT NOT NULL, outcome TEXT NOT NULL,
      added INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0, revised INTEGER NOT NULL DEFAULT 0,
      source_kind TEXT NOT NULL, source_max_date TEXT, message TEXT NOT NULL DEFAULT ''
    );
  `)
  addColumnIfMissing(database, 'trainings', 'market', "TEXT NOT NULL DEFAULT 'sh'")
  addColumnIfMissing(database, 'trainings', 'current_date', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'current_close', 'REAL')
  addColumnIfMissing(database, 'trainings', 'settle_date', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'early_settle', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'trainings', 'note', 'TEXT')
  // NULL distinguishes legacy events from an explicitly booked zero acquisition cost.
  addColumnIfMissing(database, 'position_events', 'cost_delta', 'REAL')
  // TRAIN-02 范围元数据冻结列：旧记录保持 range_version=0 / range_mode='tier'，不重建表、不清理旧训练。
  addColumnIfMissing(database, 'trainings', 'range_version', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'trainings', 'range_mode', "TEXT NOT NULL DEFAULT 'tier'")
  addColumnIfMissing(database, 'trainings', 'requested_start', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'requested_end', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'range_start', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'range_end', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'range_bar_count', 'INTEGER')
  addColumnIfMissing(database, 'trainings', 'range_source_fingerprint', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'range_notes', 'TEXT')
  // Early drawing tables have no save timestamp; keep it unknown until the next write.
  addColumnIfMissing(database, 'drawings', 'updated_at', "TEXT NOT NULL DEFAULT ''")
  // TRAIN-01：新增列与旧训练规则回填在同一个迁移事务中完成（DDL 在 SQLite 内可回滚）；
  // journal_mode 等 PRAGMA 留在事务之外。
  migrateTrainingRules(database)
}

/** TRAIN-01 规则快照迁移：trainings.rules_json（版本化不可变 JSON）。
 * 旧行一次性冻结"迁移时点实际观察到的" fees/T+1 与既有固定参数（origin=legacy-migration）；
 * 反复迁移不改已冻结值（只回填 NULL 行）。失败整体回滚，不留半迁移状态。 */
function migrateTrainingRules(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(trainings)').all() as unknown as Array<{ name: string }>
  const hasColumn = columns.some(entry => entry.name === 'rules_json')
  database.exec('BEGIN IMMEDIATE')
  try {
    if (!hasColumn) database.exec('ALTER TABLE trainings ADD COLUMN rules_json TEXT')
    backfillTrainingRules(database)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/** 为 rules_json 为 NULL 的训练行按当前设置一次性冻结规则；幂等，可单独用于夹具补齐。 */
export function backfillTrainingRules(database: DatabaseSync): void {
  const pending = database.prepare('SELECT COUNT(*) AS count FROM trainings WHERE rules_json IS NULL').get() as unknown as { count: number }
  if (pending.count === 0) return
  const capturedAt = new Date().toISOString()
  const rows = database.prepare('SELECT id, adjust_mode FROM trainings WHERE rules_json IS NULL').all() as unknown as Array<{ id: number; adjust_mode: string }>
  const update = database.prepare('UPDATE trainings SET rules_json = ? WHERE id = ?')
  for (const row of rows) {
    update.run(serializeTrainingRules(legacyMigrationRules(database, row.adjust_mode, capturedAt)), row.id)
  }
}

function addColumnIfMissing(database: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
  if (columns.some(entry => entry.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export async function ensureDatabaseDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
}
