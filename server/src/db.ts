import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
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
      cost_after REAL NOT NULL, trade_phase TEXT NOT NULL DEFAULT 'close',
      execution_type TEXT NOT NULL DEFAULT 'market', reason TEXT, order_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
      side TEXT NOT NULL, order_type TEXT NOT NULL, trigger_price_raw REAL NOT NULL,
      shares INTEGER NOT NULL, status TEXT NOT NULL, created_date TEXT NOT NULL,
      created_phase TEXT NOT NULL, expires_date TEXT, reason TEXT,
      filled_date TEXT, filled_phase TEXT, filled_trade_id INTEGER,
      status_reason TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trade_notes (
      training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
      trade_seq INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (training_id, trade_seq)
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
  addColumnIfMissing(database, 'trainings', 'current_phase', "TEXT NOT NULL DEFAULT 'close'")
  addColumnIfMissing(database, 'trainings', 'clock_mode', "TEXT NOT NULL DEFAULT 'close_only'")
  addColumnIfMissing(database, 'trainings', 'current_open', 'REAL')
  addColumnIfMissing(database, 'trainings', 'orders_enabled', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'trades', 'trade_phase', "TEXT NOT NULL DEFAULT 'close'")
  addColumnIfMissing(database, 'trades', 'execution_type', "TEXT NOT NULL DEFAULT 'market'")
  addColumnIfMissing(database, 'trades', 'reason', 'TEXT')
  addColumnIfMissing(database, 'trades', 'order_id', 'INTEGER')
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
  // 行业归属在训练创建时冻结；旧训练保持 NULL，行业排行会如实显示未分类。
  addColumnIfMissing(database, 'trainings', 'industry_id', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'industry_name', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'industry_source_sha256', 'TEXT')
  // Early drawing tables have no save timestamp; keep it unknown until the next write.
  addColumnIfMissing(database, 'drawings', 'updated_at', "TEXT NOT NULL DEFAULT ''")
  // V1.2.5 条件单触发方向（'up'＝等待价格上触触发价、'down'＝下触）：按挂单时触发价与阶段价的
  // 相对位置冻结。旧行保持 NULL＝按旧经典矩阵（side×order_type）推导，行为不变。
  addColumnIfMissing(database, 'orders', 'trigger_direction', 'TEXT')
  // M7-01 随机训练模式：维度与隐藏时间的会话级常量偏移（天）。旧训练/经典训练保持 NULL。
  addColumnIfMissing(database, 'trainings', 'random_mode', 'TEXT')
  addColumnIfMissing(database, 'trainings', 'random_time_offset_days', 'INTEGER')
  // TRAIN-01：新增列与旧训练规则回填在同一个迁移事务中完成（DDL 在 SQLite 内可回滚）；
  // journal_mode 等 PRAGMA 留在事务之外。
  migrateTrainingRules(database)
}

/** Stable per-database browser recording namespace; contains no local path. */
export function ensureRecordingNamespace(database: DatabaseSync): string {
  const row = database.prepare("SELECT value FROM cache_meta WHERE key = 'recording_namespace'").get() as unknown as { value?: string } | undefined
  if (row?.value && /^[a-f0-9-]{36}$/i.test(row.value)) return row.value
  const namespace = randomUUID()
  database.prepare("INSERT INTO cache_meta (key, value) VALUES ('recording_namespace', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(namespace)
  return namespace
}

/** TRAIN-01 规则快照迁移：trainings.rules_json（版本化不可变 JSON）。
 * 旧行一次性冻结"迁移时点实际观察到的" fees/T+1 与既有固定参数（origin=legacy-migration）。
 * 返修 F2：首次迁移以 cache_meta 标记识别，同事务写入；此后启动不再按 rules_json IS NULL
 * 回填——已迁移库中新出现的 NULL/损坏快照保持 NULL（读取侧 409），不得静默重冻成旧局。
 * 失败整体回滚（含标记），不留半迁移状态。 */
function migrateTrainingRules(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(trainings)').all() as unknown as Array<{ name: string }>
  const hasColumn = columns.some(entry => entry.name === 'rules_json')
  database.exec('BEGIN IMMEDIATE')
  try {
    if (!hasColumn) {
      // 真正的首次旧库迁移：加列 + 旧行一次性冻结 + 写标记（同事务，失败全回滚）
      database.exec('ALTER TABLE trainings ADD COLUMN rules_json TEXT')
      const capturedAt = backfillTrainingRules(database)
      database.prepare("INSERT INTO cache_meta (key, value) VALUES ('train_rules_migration', ?)").run(capturedAt)
    } else {
      const marker = database.prepare("SELECT value FROM cache_meta WHERE key = 'train_rules_migration'").get() as unknown as { value: string } | undefined
      if (!marker) {
        // 列已存在但无标记＝迁移早已完成（含旧候选 lineage），只补标记；
        // 此后出现的 NULL/损坏快照保持 NULL（读取 409），不得按当前默认重冻。
        database.prepare("INSERT INTO cache_meta (key, value) VALUES ('train_rules_migration', ?)").run(new Date().toISOString())
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/** 为 rules_json 为 NULL 的训练行按当前设置一次性冻结规则；返回本次冻结时点。
 * 迁移路径仅在首次（无标记）时调用；测试夹具可显式调用为新插入行补齐快照。 */
export function backfillTrainingRules(database: DatabaseSync): string {
  const pending = database.prepare('SELECT COUNT(*) AS count FROM trainings WHERE rules_json IS NULL').get() as unknown as { count: number }
  const capturedAt = new Date().toISOString()
  if (pending.count === 0) return capturedAt
  const rows = database.prepare('SELECT id, adjust_mode FROM trainings WHERE rules_json IS NULL').all() as unknown as Array<{ id: number; adjust_mode: string }>
  const update = database.prepare('UPDATE trainings SET rules_json = ? WHERE id = ?')
  for (const row of rows) {
    update.run(serializeTrainingRules(legacyMigrationRules(database, row.adjust_mode, capturedAt)), row.id)
  }
  return capturedAt
}

function addColumnIfMissing(database: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
  if (columns.some(entry => entry.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export async function ensureDatabaseDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
}
