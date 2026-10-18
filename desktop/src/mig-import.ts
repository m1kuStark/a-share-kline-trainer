// MIG-EXT-01 v1.2.7 训练历史迁移导入（Electron 主进程侧；依赖注入，vitest 可测——
// 先例 archive-recording.ts / update-ipc.ts）。用户拍板（2026-10-11）：v1.2.7 训练历史与
// 录像都经迁移工具显式迁入，v1.3.0 不自动吸收任何 v1.2.7 数据（无自动检测、无静默合并）。
//
// 链路：迁移工具（tools/migrate-v127）导出「训练历史迁移-<时间戳>/」（trainer.sqlite
// 自包含副本＋迁移清单.json，中文文件名＋ASCII 键——P4 拍板风格）→ 本模块三段式：
//   1. parseHistoryManifest/inspectHistoryPackage：清单契约解析＋包体检（sha256 与清单
//      一致、库 schema 为合法 v1.2.7 形状、清单计数与包内实际计数一致）。
//   2. stageHistoryImport（设置页「从 v1.2.7 迁移」触发）：包体检＋目标库可读性检查→
//      包内库拷到临时名→server migrateDatabase 升级为 v1.3.0 schema→rename 为
//      <库>.v127-history-pending（原子，中断不留残留、不动现有库）；同时只读预查
//      幂等键命中数（向用户呈现将跳过多少局）。
//   3. applyPendingHistoryAtBoot（下次启动、内嵌服务开库前）：目标库不存在＝pending
//      直接 rename 就位；存在（空或非空）＝MIG-MERGE-01 统一合并导入——VACUUM INTO
//      整库备份→单事务逐局 INSERT（幂等键 code+created_at 跳过已存在局、ID 重分配、
//      子表引用重映射、recording_namespace 永不改动），失败 ROLLBACK 目标零损伤、
//      pending 保留可重试。合并式导入使「先训练后迁移 / 先迁移后训练 / 先导录像后迁
//      历史」顺序无关（用户拍板 2026-10-13：迁移顺序不应影响迁移成功率）。
// schema 契约（必备表＋关键列）与 tools/migrate-v127/src/export-tool.cjs 互为镜像，
// 两侧各有测试锁定（改一侧必须同步另一侧）。
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../../server/dist/db.js'

export const MIGRATION_CHANNEL = 'desktop-migration:invoke'
/** 暂存后待启动应用的迁移库名（<目标库路径>+后缀）；非 pending 正文，勿当数据文件解析 */
export const PENDING_HISTORY_SUFFIX = '.v127-history-pending'
/** 导入中临时文件名片段（拷贝→升级成功后 rename 为 pending；失败即清理） */
const INCOMING_SUFFIX = '.mig-incoming'
const MANIFEST_FORMAT = 'trainer-history-migration'
const MANIFEST_VERSION = 1
/** 合并幂等业务键中 code 与 created_at 的分隔符（两列均 TEXT NOT NULL，不含 NUL） */
const KEY_SEPARATOR = '\u0000'
/** node:sqlite 绑定值域（行原值经此归一：undefined→null，其余原样） */
type SqlValue = null | number | bigint | string | Uint8Array
function toSqlValue(value: unknown): SqlValue {
  return value === null || value === undefined ? null : value as SqlValue
}
/** 合并导入涉及的训练内容表（trainings 之外的子表；settings/stocks 等配置缓存不并入） */
const CHILD_TABLES = ['trades', 'orders', 'equity_curve', 'position_events', 'drawings', 'trade_notes'] as const

// ===== v1.2.7 合法训练库契约（镜像 export-tool.cjs；表清单含 settings/cache_meta 作为训练器库身份标记） =====
const REQUIRED_TABLES = ['trainings', 'trades', 'orders', 'equity_curve', 'position_events', 'drawings', 'trade_notes', 'settings', 'cache_meta'] as const
const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  trainings: ['id', 'tier', 'code', 'name', 'market', 'adjust_mode', 'start_date', 'planned_end', 'status', 'initial_cash', 'created_at'],
  trades: ['id', 'training_id', 'seq', 'trade_date', 'side', 'price', 'shares', 'amount', 'fee', 'cash_after', 'shares_after', 'cost_after'],
  orders: ['id', 'training_id', 'side', 'order_type', 'trigger_price_raw', 'shares', 'status', 'created_date', 'created_at'],
  equity_curve: ['training_id', 'date', 'equity'],
  position_events: ['training_id', 'seq', 'date', 'kind', 'shares_delta', 'cash_delta'],
  drawings: ['training_id', 'payload'],
  trade_notes: ['training_id', 'trade_seq', 'note'],
}
/** 计数契约键→表名（清单 counts 用 camelCase 键；与导出侧 HISTORY_COUNT_SOURCES 镜像） */
const COUNT_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['trainings', 'trainings'],
  ['trades', 'trades'],
  ['orders', 'orders'],
  ['equityCurve', 'equity_curve'],
  ['positionEvents', 'position_events'],
  ['drawings', 'drawings'],
  ['tradeNotes', 'trade_notes'],
]
/** 目标库"是否已有训练历史"只看 7 张内容表；settings/cache_meta/stocks 等配置缓存行不算历史 */
const CONTENT_TABLES = ['trainings', 'trades', 'orders', 'equity_curve', 'position_events', 'drawings', 'trade_notes'] as const

export interface HistoryCounts {
  trainings: number
  trades: number
  orders: number
  equityCurve: number
  positionEvents: number
  drawings: number
  tradeNotes: number
}

export interface HistoryManifest {
  format: string
  version: number
  exportedAt: string
  sourceApp?: string
  sqliteFile: string
  sqliteBytes: number
  sqliteSha256: string
  counts: HistoryCounts
}

export interface MigrationFsDeps {
  stat(path: string): Promise<{ size: number }>
  readFileBytes(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array, options?: { flag?: string }): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  rm(path: string): Promise<void>
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const defaultMigrationFs: MigrationFsDeps = {
  stat: async path => stat(path),
  readFileBytes: async path => new Uint8Array(await readFile(path)),
  writeFile: async (path, data, options) => { await writeFile(path, data, options) },
  rename: async (oldPath, newPath) => { await rename(oldPath, newPath) },
  rm: async path => { await rm(path, { force: true }) },
}

// ===== 清单解析 =====

/** 迁移清单契约解析：format/version/校验和形状/sqliteFile 防路径穿越/计数七键 */
export function parseHistoryManifest(raw: unknown): { ok: true, manifest: HistoryManifest } | { ok: false, error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '迁移清单内容不是合法的 JSON 对象。' }
  }
  const value = raw as Record<string, unknown>
  if (value.format !== MANIFEST_FORMAT) {
    return { ok: false, error: `迁移清单格式不对（format 应为 ${MANIFEST_FORMAT}）：这可能不是 v1.2.7 训练历史迁移包导出的清单。` }
  }
  if (value.version !== MANIFEST_VERSION) {
    return { ok: false, error: `迁移清单版本不支持（version=${String(value.version)}，本应用只支持 ${MANIFEST_VERSION}）：请把训练器更新到最新版后重试。` }
  }
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length === 0) {
    return { ok: false, error: '迁移清单缺少导出时间（exportedAt）。' }
  }
  const sqliteFile = value.sqliteFile
  if (typeof sqliteFile !== 'string' || sqliteFile.length === 0
    || sqliteFile.includes('/') || sqliteFile.includes('\\') || sqliteFile === '.' || sqliteFile === '..'
    || /[\u0000-\u001f]/.test(sqliteFile)) {
    return { ok: false, error: '迁移清单中的训练库文件名（sqliteFile）不合法：只接受不含路径的裸文件名。' }
  }
  if (typeof value.sqliteBytes !== 'number' || !Number.isFinite(value.sqliteBytes) || value.sqliteBytes <= 0) {
    return { ok: false, error: '迁移清单缺少有效的训练库大小（sqliteBytes）。' }
  }
  if (typeof value.sqliteSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sqliteSha256)) {
    return { ok: false, error: '迁移清单中的校验和（sqliteSha256）不是合法的 SHA-256 值。' }
  }
  const rawCounts = value.counts
  if (rawCounts === null || typeof rawCounts !== 'object' || Array.isArray(rawCounts)) {
    return { ok: false, error: '迁移清单缺少计数（counts）部分。' }
  }
  const counts = {} as Record<string, number>
  for (const [key] of COUNT_TABLES) {
    const entry = (rawCounts as Record<string, unknown>)[key]
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) {
      return { ok: false, error: `迁移清单计数缺少合法的 ${key} 项。` }
    }
    counts[key] = entry
  }
  return {
    ok: true,
    manifest: {
      format: value.format,
      version: value.version,
      exportedAt: value.exportedAt,
      sourceApp: typeof value.sourceApp === 'string' ? value.sourceApp : undefined,
      sqliteFile,
      sqliteBytes: value.sqliteBytes,
      sqliteSha256: value.sqliteSha256.toLowerCase(),
      counts: counts as unknown as HistoryCounts,
    },
  }
}

// ===== 包体检 =====

/** v1.2.7 合法训练库校验（桌面侧镜像；缺失项一次性全部列出，方便用户定位） */
export function validateHistorySchema(database: DatabaseSync): { ok: true } | { ok: false, error: string } {
  const tables = new Set(
    (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name),
  )
  const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table))
  const problems: string[] = []
  if (missingTables.length > 0) problems.push(`缺少必备表 ${missingTables.join('、')}`)
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tables.has(table)) continue
    const present = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name))
    const missing = columns.filter(column => !present.has(column))
    if (missing.length > 0) problems.push(`表 ${table} 缺少关键列 ${missing.join('、')}`)
  }
  if (problems.length > 0) {
    return { ok: false, error: `这不是有效的 v1.2.7 训练历史库（${problems.join('；')}），已拒绝导入。` }
  }
  return { ok: true }
}

function readCounts(database: DatabaseSync): HistoryCounts {
  const counts = {} as Record<string, number>
  for (const [key, table] of COUNT_TABLES) {
    counts[key] = (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  }
  return counts as unknown as HistoryCounts
}

export type InspectOutcome =
  | { ok: true, counts: HistoryCounts, sqlitePath: string, manifest: HistoryManifest }
  | { ok: false, error: string }

/** 包体检：清单可解析＋包内 trainer.sqlite 与清单逐字节校验一致＋schema 合法＋计数一致 */
export async function inspectHistoryPackage(manifestPath: string): Promise<InspectOutcome> {
  let rawText: string
  try {
    rawText = await readFile(manifestPath, 'utf8')
  } catch (error) {
    return { ok: false, error: `无法读取迁移清单文件：${reason(error)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return { ok: false, error: `迁移清单不是合法的 JSON 文件：${reason(error)}` }
  }
  const manifestResult = parseHistoryManifest(parsed)
  if (!manifestResult.ok) return { ok: false, error: manifestResult.error }
  const manifest = manifestResult.manifest
  const sqlitePath = join(dirname(manifestPath), manifest.sqliteFile)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(sqlitePath))
  } catch {
    return { ok: false, error: `找不到迁移包内的训练库文件（${manifest.sqliteFile}）：请选择完整迁移文件夹中的 迁移清单.json，不要移动或单独复制其中的文件。` }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== manifest.sqliteBytes || sha256 !== manifest.sqliteSha256) {
    return { ok: false, error: '迁移包校验失败：包内 trainer.sqlite 与清单校验和不一致（文件可能被修改或复制不完整），请重新导出迁移包。' }
  }
  let database: DatabaseSync
  try {
    database = new DatabaseSync(sqlitePath, { readOnly: true })
  } catch (error) {
    return { ok: false, error: `训练库无法读取（可能已损坏）：${reason(error)}` }
  }
  try {
    const schema = validateHistorySchema(database)
    if (!schema.ok) return { ok: false, error: schema.error }
    const counts = readCounts(database)
    for (const [key] of COUNT_TABLES) {
      const expected = (manifest.counts as unknown as Record<string, number>)[key]
      const actual = (counts as unknown as Record<string, number>)[key]
      if (expected !== actual) {
        return { ok: false, error: `迁移清单计数与包内实际数据不一致（${key}：清单 ${expected} / 实际 ${actual}）：请重新导出迁移包。` }
      }
    }
    return { ok: true, counts, sqlitePath, manifest }
  } catch (error) {
    return { ok: false, error: `训练库无法读取（可能已损坏）：${reason(error)}` }
  } finally {
    try { database.close() } catch { /* 打开失败的连接关闭再抛只会掩盖原始错误 */ }
  }
}

// ===== 目标库可读性判定（fail-closed：判不了就拒绝） =====

type TargetEmptiness =
  | { kind: 'absent' }
  | { kind: 'empty' }
  | { kind: 'non-empty', trainings: number }
  | { kind: 'unreadable', error: string }

/** 只读检查目标库状态（MIG-MERGE-01 后空/非空都走合并，此处主要识别 absent 与 unreadable） */
function readTargetEmptiness(targetPath: string): TargetEmptiness {
  try {
    statSync(targetPath)
  } catch {
    return { kind: 'absent' }
  }
  let database: DatabaseSync
  try {
    database = new DatabaseSync(targetPath, { readOnly: true })
  } catch (error) {
    return { kind: 'unreadable', error: reason(error) }
  }
  try {
    const tables = new Set(
      (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name),
    )
    let rowsFound = 0
    let trainings = 0
    for (const table of CONTENT_TABLES) {
      if (!tables.has(table)) continue // 未建表＝该表必然零行（未初始化的库）
      const count = (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
      if (count > 0) {
        rowsFound = count
        if (table === 'trainings') { trainings = count; break }
      }
    }
    if (rowsFound > 0) return { kind: 'non-empty', trainings: trainings || rowsFound }
    return { kind: 'empty' }
  } catch (error) {
    return { kind: 'unreadable', error: reason(error) }
  } finally {
    try { database.close() } catch { /* 同上 */ }
  }
}

async function fileExists(fs: MigrationFsDeps, path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/** pending 就位/删除后清掉其可能残留的 WAL sidecar（正常关闭会被 SQLite 回收，此处兜底防数据目录落垃圾） */
async function removePendingSidecars(fs: MigrationFsDeps, pending: string): Promise<void> {
  await fs.rm(`${pending}-wal`).catch(() => { /* 不存在即已清理 */ })
  await fs.rm(`${pending}-shm`).catch(() => { /* 同上 */ })
}

// ===== 导入暂存（设置页触发） =====

export type StageOutcome =
  | { ok: true, requiresRestart: true, trainings: number, counts: HistoryCounts, skipped: number, importing: number }
  | { ok: false, error: string }

/** 读库内全部训练的幂等业务键集合（code＋created_at） */
function readTrainingKeys(databasePath: string, readOnly: boolean): Set<string> {
  const database = readOnly
    ? new DatabaseSync(databasePath, { readOnly: true })
    : new DatabaseSync(databasePath)
  try {
    const rows = database.prepare('SELECT code, created_at FROM trainings').all() as Array<{ code: string, created_at: string }>
    return new Set(rows.map(row => `${row.code}${KEY_SEPARATOR}${row.created_at}`))
  } finally {
    database.close()
  }
}

/** 只读预查：包内多少局按幂等键已存在于目标（呈现用估计值；boot 合并以事务内活查为准） */
function countSkippedTrainings(packageSqlitePath: string, targetPath: string): number {
  const packageKeys = readTrainingKeys(packageSqlitePath, true)
  const targetKeys = readTrainingKeys(targetPath, true)
  let skipped = 0
  for (const key of packageKeys) {
    if (targetKeys.has(key)) skipped += 1
  }
  return skipped
}

/**
 * 把迁移包暂存为待合并库（不动现有库）：包体检全过＋目标库可读 → 包内库拷到
 * <目标库>.mig-incoming → server migrateDatabase 升级为 v1.3.0 schema → rename 为
 * <目标库>.v127-history-pending（下次启动合并应用；目标空/非空均可，MIG-MERGE-01）。
 * 同时只读预查幂等键命中数 skipped（向用户呈现将跳过多少局）。任何一步失败：清理
 * 临时文件、现有库与已有 pending 之外的任何状态零改动（可安全重试）。
 */
export async function stageHistoryImport(
  manifestPath: string,
  targetPath: string,
  deps: { fs?: Partial<MigrationFsDeps> } = {},
): Promise<StageOutcome> {
  const fs: MigrationFsDeps = { ...defaultMigrationFs, ...deps.fs }
  const inspection = await inspectHistoryPackage(manifestPath)
  if (!inspection.ok) return { ok: false, error: inspection.error }
  const emptiness = readTargetEmptiness(targetPath)
  if (emptiness.kind === 'unreadable') {
    return { ok: false, error: `无法确认当前训练库状态（${emptiness.error}），已取消导入；请先正常启动一次训练器后重试。` }
  }
  let skipped = 0
  if (emptiness.kind !== 'absent') {
    skipped = countSkippedTrainings(inspection.sqlitePath, targetPath)
  }
  const pending = `${targetPath}${PENDING_HISTORY_SUFFIX}`
  const incoming = `${targetPath}${INCOMING_SUFFIX}`
  try {
    const bytes = await fs.readFileBytes(inspection.sqlitePath)
    await fs.writeFile(incoming, bytes, { flag: 'wx' })
    try {
      const database = new DatabaseSync(incoming)
      try {
        migrateDatabase(database)
      } finally {
        database.close()
      }
    } catch (error) {
      return { ok: false, error: `训练历史库升级到 v1.3.0 结构失败（未做任何改动，可重试）：${reason(error)}` }
    }
    if (await fileExists(fs, pending)) await fs.rm(pending) // 旧 pending（上次导入未应用）被本次导入取代
    await fs.rename(incoming, pending)
    return {
      ok: true,
      requiresRestart: true,
      trainings: inspection.counts.trainings,
      counts: inspection.counts,
      skipped,
      importing: Math.max(0, inspection.counts.trainings - skipped),
    }
  } catch (error) {
    return { ok: false, error: `导入训练历史失败（未改动现有数据，可重试）：${reason(error)}` }
  } finally {
    await fs.rm(incoming).catch(() => { /* 未创建/已 rename 走向都视为已清理 */ })
  }
}

// ===== 合并导入（MIG-MERGE-01：boot 应用，目标存在时空/非空统一走合并） =====

export type ApplyOutcome =
  | { applied: true, imported: number, skipped: number }
  | { applied: false, reason: 'none' | 'target-unreadable' | 'merge-failed', error?: string }

function backupStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 备份路径唯一化：同秒内多次合并（重试/幂等重导）时序号后缀区分，绝不覆盖旧备份 */
function uniqueBackupPath(targetPath: string): string {
  const base = `${targetPath}.pre-migration-${backupStamp()}`
  let candidate = `${base}.bak`
  let sequence = 2
  while (existsSync(candidate)) {
    candidate = `${base}-${sequence}.bak`
    sequence += 1
  }
  return candidate
}

interface PendingSnapshot {
  /** 按旧 id 升序的全部导入局（row 含全部列原值） */
  trainings: Array<{ oldId: number, code: string, createdAt: string, row: Record<string, unknown> }>
  /** 子表行按所属局旧 id 分组 */
  children: Map<string, Map<number, Array<Record<string, unknown>>>>
  cacheMeta: Array<{ key: string, value: string }>
  /** pending 侧各表列名（与目标取交集后 INSERT，schema 偏差优雅降级） */
  columns: Map<string, string[]>
}

function tableColumnsOf(database: DatabaseSync, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
}

/** 全量读出 pending（读写打开：pending 经 WAL 迁移可能有 sidecar，readOnly 恢复有风险） */
function readPendingSnapshot(pendingPath: string): PendingSnapshot {
  const database = new DatabaseSync(pendingPath)
  try {
    const columns = new Map<string, string[]>([['trainings', tableColumnsOf(database, 'trainings')]])
    const trainings = (database.prepare('SELECT * FROM trainings ORDER BY id').all() as Array<Record<string, unknown>>)
      .map(row => ({ oldId: Number(row.id), code: String(row.code), createdAt: String(row.created_at), row }))
    const children = new Map<string, Map<number, Array<Record<string, unknown>>>>()
    for (const table of CHILD_TABLES) {
      columns.set(table, tableColumnsOf(database, table))
      const byTraining = new Map<number, Array<Record<string, unknown>>>()
      if (columns.get(table)?.includes('training_id')) {
        for (const row of database.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>) {
          const trainingId = Number(row.training_id)
          const list = byTraining.get(trainingId)
          if (list) list.push(row)
          else byTraining.set(trainingId, [row])
        }
      }
      children.set(table, byTraining)
    }
    const cacheMeta = database.prepare('SELECT key, value FROM cache_meta').all() as Array<{ key: string, value: string }>
    return { trainings, children, cacheMeta, columns }
  } finally {
    database.close()
  }
}

/** 列交集 INSERT 一行子表（training_id 重映射为新局 id；返回自增新 id） */
function insertChildRow(
  target: DatabaseSync,
  table: string,
  pendingColumns: string[],
  targetColumns: ReadonlySet<string>,
  row: Record<string, unknown>,
  newTrainingId: number,
  options: { omit?: readonly string[], overrides?: Record<string, SqlValue> },
): number {
  const columns = pendingColumns.filter(column =>
    column !== 'id' && column !== 'training_id'
    && !(options.omit?.includes(column))
    && targetColumns.has(column))
  const names = ['training_id', ...columns]
  const values: SqlValue[] = [newTrainingId]
  for (const column of columns) {
    values.push(options.overrides && column in options.overrides ? options.overrides[column] : toSqlValue(row[column]))
  }
  const result = target
    .prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...values)
  return Number(result.lastInsertRowid)
}

/**
 * 合并导入 pending 到目标库（单事务）：
 * 1. VACUUM INTO 整库备份（事务外、一致快照含 WAL 内容；失败即中止）；
 * 2. BEGIN IMMEDIATE 后逐局处理——幂等键（code＋created_at）事务内活查，命中跳过
 *    整棵子树；未命中按列交集 INSERT trainings（id 重分配），子表引用同步重映射：
 *    orders 先插（filled_trade_id 置 NULL）→ trades 插入（order_id 经映射重写）→
 *    回填 orders.filled_trade_id，两段式闭合 order↔trade 交叉引用；映射缺失的
 *    非空引用置 NULL（绝不指向错误的复用 id）；
 * 3. cache_meta：recording_namespace 无条件跳过（既有录像命名空间永不改动），
 *    其余键仅目标缺失时带入（ON CONFLICT DO NOTHING）；
 * 4. 任一步失败 ROLLBACK——目标库保持导入前状态（既有新数据零损伤）。
 */
function mergePendingIntoTarget(targetPath: string, pendingPath: string): { imported: number, skipped: number } {
  const snapshot = readPendingSnapshot(pendingPath)
  const target = new DatabaseSync(targetPath)
  try {
    const targetColumns = new Map<string, Set<string>>()
    for (const table of ['trainings', ...CHILD_TABLES]) {
      targetColumns.set(table, new Set(tableColumnsOf(target, table)))
    }
    if ((targetColumns.get('trainings')?.size ?? 0) === 0) {
      throw new Error('目标库缺少 trainings 表（结构异常），请先正常启动一次训练器后重试。')
    }
    const backup = uniqueBackupPath(targetPath)
    target.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)
    target.exec('BEGIN IMMEDIATE')
    try {
      let imported = 0
      let skipped = 0
      const duplicateProbe = target.prepare('SELECT 1 FROM trainings WHERE code = ? AND created_at = ? LIMIT 1')
      const fillOrderLink = target.prepare('UPDATE orders SET filled_trade_id = ? WHERE id = ?')
      for (const training of snapshot.trainings) {
        if (duplicateProbe.get(training.code, training.createdAt)) {
          skipped += 1
          continue
        }
        const trainingColumns = (snapshot.columns.get('trainings') ?? [])
          .filter(column => column !== 'id' && targetColumns.get('trainings')?.has(column))
        const insertResult = target
          .prepare(`INSERT INTO trainings (${trainingColumns.join(', ')}) VALUES (${trainingColumns.map(() => '?').join(', ')})`)
          .run(...trainingColumns.map(column => toSqlValue(training.row[column])))
        const newTrainingId = Number(insertResult.lastInsertRowid)
        imported += 1
        // orders 先插：filled_trade_id 暂置 NULL，成交关联在 trades 插入后回填
        const orderIdMap = new Map<number, number>()
        const orderRows = snapshot.children.get('orders')?.get(training.oldId) ?? []
        for (const orderRow of orderRows) {
          const newOrderId = insertChildRow(target, 'orders', snapshot.columns.get('orders') ?? [], targetColumns.get('orders') ?? new Set(), orderRow, newTrainingId, { omit: ['filled_trade_id'] })
          orderIdMap.set(Number(orderRow.id), newOrderId)
        }
        // trades：order_id 经 orderIdMap 重映射（映射缺失的非空引用置 NULL）
        const tradeIdMap = new Map<number, number>()
        for (const tradeRow of snapshot.children.get('trades')?.get(training.oldId) ?? []) {
          const orderReference = tradeRow.order_id == null
            ? null
            : orderIdMap.get(Number(tradeRow.order_id)) ?? null
          const newTradeId = insertChildRow(target, 'trades', snapshot.columns.get('trades') ?? [], targetColumns.get('trades') ?? new Set(), tradeRow, newTrainingId, { overrides: { order_id: orderReference } })
          tradeIdMap.set(Number(tradeRow.id), newTradeId)
        }
        for (const orderRow of orderRows) {
          if (orderRow.filled_trade_id == null) continue
          const mappedTradeId = tradeIdMap.get(Number(orderRow.filled_trade_id))
          const mappedOrderId = orderIdMap.get(Number(orderRow.id))
          if (mappedTradeId !== undefined && mappedOrderId !== undefined) {
            fillOrderLink.run(mappedTradeId, mappedOrderId)
          }
        }
        for (const table of ['equity_curve', 'position_events', 'drawings', 'trade_notes'] as const) {
          for (const row of snapshot.children.get(table)?.get(training.oldId) ?? []) {
            insertChildRow(target, table, snapshot.columns.get(table) ?? [], targetColumns.get(table) ?? new Set(), row, newTrainingId, {})
          }
        }
      }
      const metaInsert = target.prepare('INSERT INTO cache_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
      for (const entry of snapshot.cacheMeta) {
        if (entry.key === 'recording_namespace') continue
        metaInsert.run(entry.key, entry.value)
      }
      target.exec('COMMIT')
      return { imported, skipped }
    } catch (error) {
      try { target.exec('ROLLBACK') } catch { /* 回滚失败仍有导入前 .bak 兜底；pending 保留 */ }
      throw error
    }
  } finally {
    target.close()
  }
}

/**
 * 应用待导入历史库（MIG-MERGE-01 统一合并）：无 pending＝no-op；目标库不存在＝pending
 * rename 直接就位（无任何 v1.3.0 数据可保）；目标存在（空或非空）＝合并导入（备份先行、
 * 单事务、幂等跳过、ns 保留）。合并成功后删除 pending；失败目标零损伤、pending 保留，
 * 下次启动自动重试（重试幂等：已导入局按业务键全部跳过）。
 */
export async function applyPendingHistoryAtBoot(targetPath: string, deps: { fs?: Partial<MigrationFsDeps> } = {}): Promise<ApplyOutcome> {
  const fs: MigrationFsDeps = { ...defaultMigrationFs, ...deps.fs }
  const pending = `${targetPath}${PENDING_HISTORY_SUFFIX}`
  if (!await fileExists(fs, pending)) return { applied: false, reason: 'none' }
  if (!await fileExists(fs, targetPath)) {
    let imported = 0
    try {
      const database = new DatabaseSync(pending)
      try {
        imported = (database.prepare('SELECT COUNT(*) AS count FROM trainings').get() as { count: number }).count
      } finally {
        database.close()
      }
    } catch { /* 计数失败不阻断就位 */ }
    try {
      await fs.rename(pending, targetPath)
      await removePendingSidecars(fs, pending)
      return { applied: true, imported, skipped: 0 }
    } catch (error) {
      return { applied: false, reason: 'merge-failed', error: `应用待导入训练历史失败（下次启动自动重试）：${reason(error)}` }
    }
  }
  const emptiness = readTargetEmptiness(targetPath)
  if (emptiness.kind === 'unreadable') {
    return { applied: false, reason: 'target-unreadable', error: `无法确认现有训练库状态，保留待导入历史（下次启动重试）：${emptiness.error}` }
  }
  try {
    const merged = mergePendingIntoTarget(targetPath, pending)
    await fs.rm(pending)
    await removePendingSidecars(fs, pending)
    return { applied: true, imported: merged.imported, skipped: merged.skipped }
  } catch (error) {
    return { applied: false, reason: 'merge-failed', error: `合并导入训练历史失败（目标库已恢复导入前状态，下次启动自动重试）：${reason(error)}` }
  }
}

// ===== MIG-ONECLICK-01 一键迁移 boot 消费 =====
// 一键工具（tools/migrate-v127「一键迁移.cmd」导入侧）把迁移产物暂存到
// <dataDir>/migrate-v127-import/（manifest.json 最后落盘＝完成标记）。主进程消费：
//   - 历史：consumeOneClickHistoryStaging（内嵌服务开库前）→ 复用 stageHistoryImport
//     产 .v127-history-pending → 紧随其后的 applyPendingHistoryAtBoot 合并归位
//     （备份先行＋单事务＋幂等跳过＋ns 保留，MIG-MERGE-01 既有语义零改动）；
//   - 录像：渲染端 IndexedDB 无法从主进程直写 → 窗口加载完成后经 executeJavaScript
//     注入暂存的导入器脚本（工具自带，与新版页面「导入录制」同链的仓库正源打包），
//     成功后清理暂存；失败保留、下次启动自动重试（重复导入幂等，重试安全）。

export const ONECLICK_STAGING_DIR = 'migrate-v127-import'
export const ONECLICK_MANIFEST_FILE = 'manifest.json'
const ONECLICK_MANIFEST_FORMAT = 'trainer-oneclick-import'
const ONECLICK_MANIFEST_VERSION = 1

export interface OneClickStagedHistory {
  /** 暂存目录内迁移清单的相对路径（如 history/迁移清单.json；已防穿越校验） */
  manifest: string
  consumedAt?: string
}

export interface OneClickStagedRecordings {
  file: string
  importer: string
  consumedAt?: string
}

export interface OneClickManifest {
  format: string
  version: number
  stagedAt: string
  history: OneClickStagedHistory | null
  recordings: OneClickStagedRecordings | null
}

/** 暂存目录内相对路径校验：非空、非绝对、不含盘符、无 ./.. 段（防任意路径注入） */
function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\0')) return false
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(normalized)) return false
  return normalized.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** 一键迁移暂存清单契约解析（format/version/stagedAt＋history/recordings 可空条目＋防穿越路径） */
export function parseOneClickManifest(raw: unknown): { ok: true, manifest: OneClickManifest } | { ok: false, error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '一键迁移暂存清单不是合法的 JSON 对象。' }
  }
  const value = raw as Record<string, unknown>
  if (value.format !== ONECLICK_MANIFEST_FORMAT) {
    return { ok: false, error: `一键迁移暂存清单格式不对（format 应为 ${ONECLICK_MANIFEST_FORMAT}），已忽略。` }
  }
  if (value.version !== ONECLICK_MANIFEST_VERSION) {
    return { ok: false, error: `一键迁移暂存清单版本不支持（version=${String(value.version)}）：请更新训练器后重试。` }
  }
  if (typeof value.stagedAt !== 'string' || value.stagedAt.length === 0) {
    return { ok: false, error: '一键迁移暂存清单缺少 stagedAt。' }
  }
  let history: OneClickStagedHistory | null = null
  if (value.history !== null && value.history !== undefined) {
    if (typeof value.history !== 'object' || Array.isArray(value.history)) {
      return { ok: false, error: '一键迁移暂存清单 history 条目不合法。' }
    }
    const fields = value.history as Record<string, unknown>
    if (!isSafeRelativePath(fields.manifest)) {
      return { ok: false, error: '一键迁移暂存清单 history.manifest 路径不合法（只接受暂存目录内的相对路径）。' }
    }
    if (fields.consumedAt !== undefined && typeof fields.consumedAt !== 'string') {
      return { ok: false, error: '一键迁移暂存清单 history.consumedAt 不合法。' }
    }
    history = { manifest: fields.manifest, ...(typeof fields.consumedAt === 'string' ? { consumedAt: fields.consumedAt } : {}) }
  }
  let recordings: OneClickStagedRecordings | null = null
  if (value.recordings !== null && value.recordings !== undefined) {
    if (typeof value.recordings !== 'object' || Array.isArray(value.recordings)) {
      return { ok: false, error: '一键迁移暂存清单 recordings 条目不合法。' }
    }
    const fields = value.recordings as Record<string, unknown>
    if (!isSafeRelativePath(fields.file) || !isSafeRelativePath(fields.importer)) {
      return { ok: false, error: '一键迁移暂存清单 recordings 路径不合法（只接受暂存目录内的相对路径）。' }
    }
    if (fields.consumedAt !== undefined && typeof fields.consumedAt !== 'string') {
      return { ok: false, error: '一键迁移暂存清单 recordings.consumedAt 不合法。' }
    }
    recordings = {
      file: fields.file,
      importer: fields.importer,
      ...(typeof fields.consumedAt === 'string' ? { consumedAt: fields.consumedAt } : {}),
    }
  }
  return { ok: true, manifest: { format: value.format, version: value.version, stagedAt: value.stagedAt, history, recordings } }
}

export type OneClickHistoryConsume =
  | { ran: false, ok?: undefined }
  | { ran: true, ok: true, staged: StageOutcome }
  | { ran: true, ok: false, error: string }

/**
 * 启动早期消费一键暂存的训练历史：manifest 在且 history 未消费 → 复用
 * stageHistoryImport（包体检＋schema 升级＋pending 就位，任何失败零损伤）并把
 * history.consumedAt 写回清单。无暂存/已消费/清单异常均不阻断启动；
 * 失败保留暂存，下次启动自动重试。
 */
export async function consumeOneClickHistoryStaging(
  dataDir: string,
  databasePath: string,
  deps: { fs?: Partial<MigrationFsDeps> } = {},
): Promise<OneClickHistoryConsume> {
  const stagingDir = join(dataDir, ONECLICK_STAGING_DIR)
  const manifestPath = join(stagingDir, ONECLICK_MANIFEST_FILE)
  let rawText: string
  try {
    rawText = await readFile(manifestPath, 'utf8')
  } catch {
    return { ran: false } // 无一键暂存＝常规启动
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return { ran: true, ok: false, error: `一键迁移暂存清单无法解析（暂存保留，下次启动重试）：${reason(error)}` }
  }
  const manifestResult = parseOneClickManifest(parsed)
  if (!manifestResult.ok) return { ran: true, ok: false, error: manifestResult.error }
  const manifest = manifestResult.manifest
  if (!manifest.history || manifest.history.consumedAt) return { ran: false }
  const staged = await stageHistoryImport(join(stagingDir, manifest.history.manifest), databasePath, deps)
  if (!staged.ok) return { ran: true, ok: false, error: staged.error }
  const next = JSON.parse(JSON.stringify(manifest)) as OneClickManifest
  next.history = { ...next.history!, consumedAt: new Date().toISOString() }
  try {
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch (error) {
    return { ran: true, ok: false, error: `训练历史已暂存为待合并（下次启动自动应用），但更新一键迁移清单失败：${reason(error)}` }
  }
  return { ran: true, ok: true, staged }
}

/**
 * 组装录像导入注入脚本：执行暂存的导入器 IIFE（定义 window.__v127OneClickImport）后，
 * 以 JS 字符串字面量原样传入合并包文本，结果 JSON 字符串化返回（异常也结构化，
 * 绝不向主进程抛出）。executeJavaScript 会自动 await 返回的 Promise。
 */
export function buildRecordingImportScript(importerText: string, bundleText: string): string {
  return `(async () => {
  try {
    ${importerText}
    const outcome = await window.__v127OneClickImport(${JSON.stringify(bundleText)})
    return JSON.stringify(outcome)
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})()`
}

export interface OneClickRecordingDeps {
  readFileText?(path: string): Promise<string>
  writeFile?(path: string, text: string): Promise<void>
  removeFile?(path: string): Promise<void>
}

export type OneClickRecordingOutcome =
  | { ran: false, ok?: undefined }
  | { ran: true, ok: true, summary: { imported?: number, skipped?: number, failed?: number } }
  | { ran: true, ok: false, error: string }

/**
 * 窗口加载完成后消费一键暂存的录像合并包：读取导入器＋合并包 → 注入渲染端执行 →
 * 成功＝清单标记 recordings.consumedAt 并删除两个暂存文件（先标记后删文件：中断最坏
 * 情形是文件残留但已标记，重跑工具整体重建暂存即可；重复导入本身幂等）。失败＝
 * 暂存原样保留，下次启动自动重试。无暂存/已消费＝no-op（不触碰页面）。
 */
export async function runOneClickRecordingImport(
  input: { dataDir: string, executeJavaScript(code: string): Promise<unknown> },
  deps: OneClickRecordingDeps = {},
): Promise<OneClickRecordingOutcome> {
  const readText = deps.readFileText ?? (async path => readFile(path, 'utf8'))
  const writeText = deps.writeFile ?? (async (path, text) => { await writeFile(path, text, 'utf8') })
  const removeFile = deps.removeFile ?? (async path => { await rm(path, { force: true }) })
  const stagingDir = join(input.dataDir, ONECLICK_STAGING_DIR)
  const manifestPath = join(stagingDir, ONECLICK_MANIFEST_FILE)
  let rawText: string
  try {
    rawText = await readText(manifestPath)
  } catch {
    return { ran: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    return { ran: true, ok: false, error: `一键迁移暂存清单无法解析（下次启动重试）：${reason(error)}` }
  }
  const manifestResult = parseOneClickManifest(parsed)
  if (!manifestResult.ok) return { ran: true, ok: false, error: manifestResult.error }
  const manifest = manifestResult.manifest
  if (!manifest.recordings || manifest.recordings.consumedAt) return { ran: false }
  let importerText: string
  let bundleText: string
  try {
    importerText = await readText(join(stagingDir, manifest.recordings.importer))
    bundleText = await readText(join(stagingDir, manifest.recordings.file))
  } catch (error) {
    return { ran: true, ok: false, error: `读取录像迁移暂存失败（下次启动重试）：${reason(error)}` }
  }
  let raw: unknown
  try {
    raw = await input.executeJavaScript(buildRecordingImportScript(importerText, bundleText))
  } catch (error) {
    return { ran: true, ok: false, error: `录像导入执行失败（下次启动重试）：${reason(error)}` }
  }
  let result: { ok?: unknown, imported?: number, skipped?: number, failed?: number, error?: unknown }
  try {
    result = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as typeof result
  } catch (error) {
    return { ran: true, ok: false, error: `录像导入结果无法解析（下次启动重试）：${reason(error)}` }
  }
  if (!result || result.ok !== true) {
    return { ran: true, ok: false, error: result && typeof result.error === 'string' && result.error ? result.error : '录像导入失败（页面未提供原因）' }
  }
  const next = JSON.parse(JSON.stringify(manifest)) as OneClickManifest
  next.recordings = { ...next.recordings!, consumedAt: new Date().toISOString() }
  try {
    await writeText(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  } catch (error) {
    return { ran: true, ok: false, error: `录像已导入，但更新一键迁移清单失败（下次启动可能重复执行，重复条目会自动跳过）：${reason(error)}` }
  }
  await removeFile(join(stagingDir, manifest.recordings.file)).catch(() => { /* 已标记已消费；残留文件不再被执行 */ })
  await removeFile(join(stagingDir, manifest.recordings.importer)).catch(() => { /* 同上 */ })
  return { ran: true, ok: true, summary: { imported: result.imported, skipped: result.skipped, failed: result.failed } }
}

// ===== IPC（通道面：method 路由 pick/inspect/import；错误结构化返回，绝不向渲染端抛异常） =====

export interface MigrationIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
  }
  /** GUI 文件选择（返回迁移清单.json 绝对路径；取消＝null） */
  pickManifestFile(): Promise<string | null>
  /** 生效训练库路径（config.databasePath）；null＝未就绪（dev 窗口/启动早期） */
  databasePath(): string | null
  logger: { warn(...args: unknown[]): void, error(...args: unknown[]): void }
}

export function registerMigrationIpc(deps: MigrationIpcDeps): void {
  deps.ipcMain.handle(MIGRATION_CHANNEL, async (_event, request) => {
    try {
      const parsed = (request ?? null) as { method?: unknown, manifestPath?: unknown } | null
      const method = parsed?.method
      if (method === 'pick') {
        const picked = await deps.pickManifestFile()
        if (!picked) return { ok: false, error: '已取消选择迁移清单文件。' }
        return { ok: true, manifestPath: picked }
      }
      if (method !== 'inspect' && method !== 'import') {
        return { ok: false, error: `未知的迁移操作：${String(method)}` }
      }
      const manifestPath = typeof parsed?.manifestPath === 'string' ? parsed.manifestPath : ''
      const target = deps.databasePath()
      if (!target) {
        return { ok: false, error: '数据目录未就绪（应用启动中或开发窗口模式），请稍后重试。' }
      }
      if (!manifestPath) return { ok: false, error: '缺少迁移清单文件路径，请先选择迁移包中的 迁移清单.json。' }
      if (method === 'inspect') return await inspectHistoryPackage(manifestPath)
      return await stageHistoryImport(manifestPath, target)
    } catch (error) {
      deps.logger.warn('[desktop] migration ipc failed:', error)
      return { ok: false, error: reason(error) }
    }
  })
}
