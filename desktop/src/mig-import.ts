// MIG-EXT-01 v1.2.7 训练历史迁移导入（Electron 主进程侧；依赖注入，vitest 可测——
// 先例 archive-recording.ts / update-ipc.ts）。用户拍板（2026-10-11）：v1.2.7 训练历史与
// 录像都经迁移工具显式迁入，v1.3.0 不自动吸收任何 v1.2.7 数据（无自动检测、无静默合并）。
//
// 链路：迁移工具（tools/migrate-v127）导出「训练历史迁移-<时间戳>/」（trainer.sqlite
// 自包含副本＋迁移清单.json，中文文件名＋ASCII 键——P4 拍板风格）→ 本模块三段式：
//   1. parseHistoryManifest/inspectHistoryPackage：清单契约解析＋包体检（sha256 与清单
//      一致、库 schema 为合法 v1.2.7 形状、清单计数与包内实际计数一致）。
//   2. stageHistoryImport（设置页「从 v1.2.7 迁移」触发）：fail-closed——目标库非空
//      （7 张内容表任一有行）即人话拒绝合并；空库才采用：包内库拷到临时名→server
//      migrateDatabase 升级为 v1.3.0 schema→rename 为 <库>.v127-history-pending（原子，
//      中断不留残留、不动现有库）。
//   3. applyPendingHistoryAtBoot（下次启动、内嵌服务开库前）：pending 就位且目标库仍为
//      空→原库 rename 备份（pre-migration-<时间戳>.bak）→pending 换入；换库失败回滚
//      恢复原库、pending 保留可重试；目标已变非空→暂缓保留 pending。
// schema 契约（必备表＋关键列）与 tools/migrate-v127/src/export-tool.cjs 互为镜像，
// 两侧各有测试锁定（改一侧必须同步另一侧）。
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
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

// ===== 目标库空态判定（fail-closed：判不了就拒绝） =====

type TargetEmptiness =
  | { kind: 'absent' }
  | { kind: 'empty' }
  | { kind: 'non-empty', trainings: number }
  | { kind: 'unreadable', error: string }

/** 只读判定目标库是否已有训练历史：不存在＝absent；7 张内容表全部零行（或表未建）＝空；开不了库＝判不了 */
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

// ===== 导入暂存（设置页触发） =====

export type StageOutcome =
  | { ok: true, requiresRestart: true, trainings: number, counts: HistoryCounts }
  | { ok: false, error: string }

/**
 * 把迁移包暂存为待应用库（不动现有库）：包体检全过＋目标库为空 → 包内库拷到
 * <目标库>.mig-incoming → server migrateDatabase 升级为 v1.3.0 schema → rename 为
 * <目标库>.v127-history-pending（下次启动应用）。任何一步失败：清理临时文件、
 * 现有库与已有 pending 之外的任何状态零改动（可安全重试）。
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
  if (emptiness.kind === 'non-empty') {
    return {
      ok: false,
      error: `当前训练库已有训练历史（${emptiness.trainings} 条训练记录），为避免两份历史合并出错，本功能只支持导入到空训练库；`
        + '如需改用 v1.2.7 历史，请先在「数据目录」分栏切换到新的空目录并重启，再重新导入。',
    }
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
    return { ok: true, requiresRestart: true, trainings: inspection.counts.trainings, counts: inspection.counts }
  } catch (error) {
    return { ok: false, error: `导入训练历史失败（未改动现有数据，可重试）：${reason(error)}` }
  } finally {
    await fs.rm(incoming).catch(() => { /* 未创建/已 rename 走向都视为已清理 */ })
  }
}

// ===== 启动应用（下次启动、内嵌服务开库前调用） =====

export type ApplyOutcome =
  | { applied: true }
  | { applied: false, reason: 'none' | 'target-not-empty' | 'target-unreadable' | 'swap-failed', error?: string }

function backupStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * 应用待导入历史库（原子换库）：无 pending＝no-op；目标库不存在＝pending 直接就位；
 * 目标库为空＝原库 rename 备份（.pre-migration-<时间戳>.bak）→pending 换入，换入失败
 * 回滚恢复原库（pending 保留，下次启动重试）；目标库非空＝暂缓保留 pending（绝不合并）。
 */
export async function applyPendingHistoryAtBoot(targetPath: string, deps: { fs?: Partial<MigrationFsDeps> } = {}): Promise<ApplyOutcome> {
  const fs: MigrationFsDeps = { ...defaultMigrationFs, ...deps.fs }
  const pending = `${targetPath}${PENDING_HISTORY_SUFFIX}`
  if (!await fileExists(fs, pending)) return { applied: false, reason: 'none' }
  if (!await fileExists(fs, targetPath)) {
    try {
      await fs.rename(pending, targetPath)
      return { applied: true }
    } catch (error) {
      return { applied: false, reason: 'swap-failed', error: `应用待导入训练历史失败（下次启动自动重试）：${reason(error)}` }
    }
  }
  const emptiness = readTargetEmptiness(targetPath)
  if (emptiness.kind === 'unreadable') {
    return { applied: false, reason: 'target-unreadable', error: `无法确认现有训练库状态，保留待导入历史（下次启动重试）：${emptiness.error}` }
  }
  if (emptiness.kind === 'non-empty') {
    return { applied: false, reason: 'target-not-empty' }
  }
  const backup = `${targetPath}.pre-migration-${backupStamp()}.bak`
  try {
    await fs.rename(targetPath, backup)
  } catch (error) {
    return { applied: false, reason: 'swap-failed', error: `备份现有训练库失败（未做任何改动，下次启动重试）：${reason(error)}` }
  }
  try {
    await fs.rename(pending, targetPath)
    return { applied: true }
  } catch (error) {
    const swapError = reason(error)
    try {
      await fs.rename(backup, targetPath) // 回滚：恢复原库
    } catch (restoreError) {
      return { applied: false, reason: 'swap-failed', error: `换入迁移历史失败且回滚失败（原库备份保留在 ${backup}）：${swapError} / ${reason(restoreError)}` }
    }
    return { applied: false, reason: 'swap-failed', error: `换入迁移历史失败（已恢复原库，下次启动自动重试）：${swapError}` }
  }
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
