// 历史版本保护库（DATA-03）：独立于主训练库的侧车 SQLite（模块自有 schema，不改 db.ts）。
// 职责：
// 1) 市场版本 lineage——每次刷新整批发布后记录一个市场版本（迁移时首版即基线，逐文件内容指纹），
//    追加同时改写历史在内容证据下不再漏报为新增（前缀哈希判别，见 fingerprint.ts）。
// 2) 文件指纹层——每路径最近一次记录的 {rows, sha256}，供下一次扫描叠加为内容校验基线。
// 3) 保留版存储——按需保留个股 .day 原始字节与权息事件，提供可读取的旧版（读侧永不回退现势文件）。
// 单写者约束：市场版本只允许由刷新协调器在整批发布成功后调用 recordMarketVersion 写入；
// 其余方法全部只读。存储位置由调用方给定（生产派生自 TRAINER_DB 同目录 history-versions/）。

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ScanBaseline, ScanOutcome, ScannedFileState } from '../source.js'
import { classifyContentChange } from './fingerprint.js'

const SCHEMA_VERSION = 1

/** 单个日线文件最近一次记录的指纹（present=false＝该路径已从市场消失，指纹保留供再现时校验） */
export interface FileFingerprint {
  path: string
  size: number
  mtimeMs: number
  rows: number
  maxDate: string | null
  sha256: string | null
  present: boolean
}

export type MarketVersionFileStatus = 'baseline' | 'added' | 'appended' | 'rewritten' | 'removed' | 'unverified'

export interface MarketVersionSummary {
  id: string
  batchId: string
  createdAt: string
  sourceMaxDate: string | null
  /** true＝迁移时基线（保护库建立后记录的第一个市场版本） */
  baseline: boolean
  totalStocks: number
  /** 与刷新日志同口径的元数据差异计数（added/removed/revised） */
  added: number
  removed: number
  revised: number
  /** 内容证据证实为纯追加的文件数（added 中历史未被改写的部分） */
  appended: number
  /** 内容证据证实历史被改写/截断的文件数（含从 added 重分类的漏报修复） */
  rewritten: number
  /** 内容逐字节未变的文件数 */
  unchanged: number
}

export interface MarketVersionFileEntry {
  status: MarketVersionFileStatus
  path: string
  size: number | null
  mtimeMs: number | null
  rows: number | null
  maxDate: string | null
  sha256: string | null
}

export interface RetainedVersionRow {
  id: string
  market: string
  code: string
  createdAt: string
  rows: number
  sha256: string
  dayBytes: Uint8Array
  eventsJson: string
}

export interface RecordMarketVersionInput {
  /** DATA-01 整批发布的批次标识（与 cache_meta 三键一致） */
  batchId: string
  finishedAt: string
  outcome: ScanOutcome
}

interface VersionRowRaw {
  id: string
  batch_id: string
  created_at: string
  source_max_date: string | null
  baseline: number
  total_stocks: number
  added: number
  removed: number
  revised: number
  appended: number
  rewritten: number
  unchanged: number
}

interface VersionFileRowRaw {
  status: string
  path: string
  size: number | null
  mtime_ms: number | null
  rows: number | null
  max_date: string | null
  sha256: string | null
}

interface FingerprintRowRaw {
  path: string
  size: number
  mtime_ms: number
  rows: number
  max_date: string | null
  sha256: string | null
  present: number
}

interface RetainedRowRaw {
  id: string
  market: string
  code: string
  created_at: string
  rows: number
  sha256: string
  day_bytes: Uint8Array
  events_json: string
}

function retainedRowToDomain(row: RetainedRowRaw): RetainedVersionRow {
  return {
    id: row.id,
    market: row.market,
    code: row.code,
    createdAt: row.created_at,
    rows: row.rows,
    sha256: row.sha256,
    dayBytes: row.day_bytes,
    eventsJson: row.events_json,
  }
}

export class HistoryStore {
  private constructor(private readonly database: DatabaseSync) {}

  /** 打开（必要时创建）侧车库；schema 版本不识别时明确报错，绝不猜着读旧库 */
  static async open(directory: string): Promise<HistoryStore> {
    await mkdir(directory, { recursive: true })
    const database = new DatabaseSync(join(directory, 'history.sqlite'))
    database.exec('PRAGMA journal_mode = WAL')
    const version = Number(database.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version > SCHEMA_VERSION) {
      database.close()
      throw new Error(`历史版本保护库 schema 版本为 ${version}，高于当前支持的 ${SCHEMA_VERSION}；请升级程序后再试`)
    }
    if (version < SCHEMA_VERSION) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS market_versions (
          id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, created_at TEXT NOT NULL,
          source_max_date TEXT, baseline INTEGER NOT NULL,
          total_stocks INTEGER NOT NULL, added INTEGER NOT NULL, removed INTEGER NOT NULL,
          revised INTEGER NOT NULL, appended INTEGER NOT NULL, rewritten INTEGER NOT NULL,
          unchanged INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS version_files (
          version_id TEXT NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL,
          size INTEGER, mtime_ms REAL, rows INTEGER, max_date TEXT, sha256 TEXT,
          PRIMARY KEY (version_id, path)
        );
        CREATE TABLE IF NOT EXISTS file_fingerprints (
          path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms REAL NOT NULL,
          rows INTEGER NOT NULL, max_date TEXT, sha256 TEXT, present INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS retained_versions (
          id TEXT PRIMARY KEY, market TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL,
          rows INTEGER NOT NULL, sha256 TEXT NOT NULL, day_bytes BLOB NOT NULL, events_json TEXT NOT NULL
        );
        PRAGMA user_version = ${SCHEMA_VERSION};
      `)
    }
    return new HistoryStore(database)
  }

  close(): void {
    this.database.close()
  }

  /** 单写者入口：整批发布成功后记录市场版本（单事务：版本行＋逐文件行＋指纹层一起生效或整体回滚）。 */
  recordMarketVersion(input: RecordMarketVersionInput): MarketVersionSummary {
    const fingerprints = this.loadFingerprints()
    const baseline = fingerprints.size === 0
    const currentPaths = new Set(input.outcome.files.map(file => file.path))
    const rows: Array<MarketVersionFileEntry> = []
    const fingerprintWrites: Array<{ file: ScannedFileState | null; removed: boolean; path?: string }> = []
    let appended = 0
    let rewritten = 0
    let unchanged = 0
    let removed = 0
    let added = 0

    for (const file of input.outcome.files) {
      const previous = fingerprints.get(file.path) ?? null
      if (!previous) {
        added += 1
        rows.push({ status: baseline ? 'baseline' : 'added', ...metadataOf(file) })
        fingerprintWrites.push({ file, removed: false })
        continue
      }
      const change = classifyContentChange(
        { rows: previous.rows, sha256: previous.sha256 },
        { rows: file.rows, sha256: file.sha256, prefixSha256: file.prefixSha256 },
      )
      if (change === 'identical') {
        unchanged += 1
        continue
      }
      if (change === 'appended') {
        appended += 1
        rows.push({ status: 'appended', ...metadataOf(file) })
      } else if (change === 'rewritten' || change === 'shrunk') {
        rewritten += 1
        rows.push({ status: 'rewritten', ...metadataOf(file) })
      } else {
        rows.push({ status: 'unverified', ...metadataOf(file) })
      }
      fingerprintWrites.push({ file, removed: false })
    }
    for (const fingerprint of fingerprints.values()) {
      if (!fingerprint.present || currentPaths.has(fingerprint.path)) continue
      removed += 1
      rows.push({ status: 'removed', path: fingerprint.path, size: null, mtimeMs: null, rows: null, maxDate: null, sha256: null })
      fingerprintWrites.push({ file: null, removed: true, path: fingerprint.path })
    }

    const summary: MarketVersionSummary = {
      id: input.batchId,
      batchId: input.batchId,
      createdAt: input.finishedAt,
      sourceMaxDate: input.outcome.sourceMaxDate,
      baseline,
      totalStocks: input.outcome.totalStocks,
      added: input.outcome.added,
      removed: input.outcome.removed,
      revised: input.outcome.revised,
      appended,
      rewritten,
      unchanged,
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO market_versions (
          id, batch_id, created_at, source_max_date, baseline,
          total_stocks, added, removed, revised, appended, rewritten, unchanged
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        summary.id, summary.batchId, summary.createdAt, summary.sourceMaxDate, summary.baseline ? 1 : 0,
        summary.totalStocks, summary.added, summary.removed, summary.revised,
        summary.appended, summary.rewritten, summary.unchanged,
      )
      const insertFile = this.database.prepare(`
        INSERT INTO version_files (version_id, path, status, size, mtime_ms, rows, max_date, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const upsertFingerprint = this.database.prepare(`
        INSERT INTO file_fingerprints (path, size, mtime_ms, rows, max_date, sha256, present)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          size = excluded.size, mtime_ms = excluded.mtime_ms, rows = excluded.rows,
          max_date = excluded.max_date, sha256 = excluded.sha256, present = excluded.present
      `)
      for (const row of rows) {
        insertFile.run(input.batchId, row.path, row.status, row.size, row.mtimeMs, row.rows, row.maxDate, row.sha256)
      }
      for (const write of fingerprintWrites) {
        if (write.removed) {
          // 移除路径：保留旧指纹（供文件再现时改写校验），仅标记 present=0
          this.database.prepare('UPDATE file_fingerprints SET present = 0 WHERE path = ?').run(write.path!)
          continue
        }
        const file = write.file!
        upsertFingerprint.run(file.path, file.size, file.mtimeMs, file.rows, file.maxDate, file.sha256 ?? null, 1)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return summary
  }

  /** 供下一次扫描叠加的内容指纹基线（含已移除路径，供再现文件做改写校验）。 */
  latestFingerprints(): Map<string, FileFingerprint> {
    return this.loadFingerprints()
  }

  listMarketVersions(): MarketVersionSummary[] {
    const rows = this.database.prepare(`
      SELECT id, batch_id, created_at, source_max_date, baseline,
             total_stocks, added, removed, revised, appended, rewritten, unchanged
      FROM market_versions ORDER BY rowid
    `).all() as unknown as VersionRowRaw[]
    return rows.map(rowToSummary)
  }

  getMarketVersion(id: string): { summary: MarketVersionSummary; files: MarketVersionFileEntry[] } | null {
    const raw = this.database.prepare(`
      SELECT id, batch_id, created_at, source_max_date, baseline,
             total_stocks, added, removed, revised, appended, rewritten, unchanged
      FROM market_versions WHERE id = ?
    `).get(id) as unknown as VersionRowRaw | undefined
    if (!raw) return null
    const files = this.database.prepare(`
      SELECT status, path, size, mtime_ms, rows, max_date, sha256
      FROM version_files WHERE version_id = ? ORDER BY path
    `).all(id) as unknown as VersionFileRowRaw[]
    return {
      summary: rowToSummary(raw),
      files: files.map(row => ({
        status: row.status as MarketVersionFileStatus,
        path: row.path,
        size: row.size,
        mtimeMs: row.mtime_ms,
        rows: row.rows,
        maxDate: row.max_date,
        sha256: row.sha256,
      })),
    }
  }

  insertRetainedVersion(row: Omit<RetainedVersionRow, 'dayBytes'> & { dayBytes: Uint8Array }): void {
    this.database.prepare(`
      INSERT INTO retained_versions (id, market, code, created_at, rows, sha256, day_bytes, events_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.market, row.code, row.createdAt, row.rows, row.sha256, row.dayBytes, row.eventsJson)
  }

  getRetainedVersion(id: string): RetainedVersionRow | null {
    const row = this.database.prepare(`
      SELECT id, market, code, created_at, rows, sha256, day_bytes, events_json
      FROM retained_versions WHERE id = ?
    `).get(id) as unknown as RetainedRowRaw | undefined
    return row ? retainedRowToDomain(row) : null
  }

  listRetainedVersions(market?: string, code?: string): Array<Omit<RetainedVersionRow, 'dayBytes'>> {
    const rows = this.database.prepare(`
      SELECT id, market, code, created_at, rows, sha256, events_json
      FROM retained_versions ORDER BY rowid
    `).all() as unknown as Array<RetainedRowRaw & { day_bytes?: Uint8Array }>
    return rows
      .filter(row => (market === undefined || row.market === market) && (code === undefined || row.code === code))
      .map(({ id, market: rowMarket, code: rowCode, created_at, rows: rowCount, sha256, events_json }) => ({
        id, market: rowMarket, code: rowCode, createdAt: created_at, rows: rowCount, sha256, eventsJson: events_json,
      }))
  }

  private loadFingerprints(): Map<string, FileFingerprint> {
    const rows = this.database.prepare(`
      SELECT path, size, mtime_ms, rows, max_date, sha256, present FROM file_fingerprints
    `).all() as unknown as FingerprintRowRaw[]
    const map = new Map<string, FileFingerprint>()
    for (const row of rows) {
      map.set(row.path, {
        path: row.path,
        size: row.size,
        mtimeMs: row.mtime_ms,
        rows: row.rows,
        maxDate: row.max_date,
        sha256: row.sha256,
        present: row.present === 1,
      })
    }
    return map
  }
}

function metadataOf(file: ScannedFileState): Omit<MarketVersionFileEntry, 'status'> {
  return {
    path: file.path,
    size: file.size,
    mtimeMs: file.mtimeMs,
    rows: file.rows,
    maxDate: file.maxDate,
    sha256: file.sha256 ?? null,
  }
}

function rowToSummary(row: VersionRowRaw): MarketVersionSummary {
  return {
    id: row.id,
    batchId: row.batch_id,
    createdAt: row.created_at,
    sourceMaxDate: row.source_max_date,
    baseline: row.baseline === 1,
    totalStocks: row.total_stocks,
    added: row.added,
    removed: row.removed,
    revised: row.revised,
    appended: row.appended,
    rewritten: row.rewritten,
    unchanged: row.unchanged,
  }
}

/**
 * 把保护库内容指纹叠加到主库扫描基线上（纯函数）：
 * 只叠加主库基线中仍存在的路径（指纹只补 sha256，元数据以主库为准）。
 * 已移除路径的旧指纹保留在保护库中，供文件再现时做改写校验，但不进入扫描差异（避免幽灵 removed）。
 */
export function mergeScanBaselineWithFingerprints(base: ScanBaseline, fingerprints: Map<string, FileFingerprint>): ScanBaseline {
  const merged: ScanBaseline = new Map()
  for (const [path, entry] of base) merged.set(path, { ...entry })
  for (const [path, fingerprint] of fingerprints) {
    const entry = merged.get(path)
    if (entry) merged.set(path, { ...entry, sha256: fingerprint.sha256 })
  }
  return merged
}
