// MIG-ONECLICK-IMPORT-SIDE（应用侧 boot 消费）：一键工具暂存到 <dataDir>/migrate-v127-import/
// 的迁移数据由桌面主进程在启动时自动消费——历史走既有 stageHistoryImport→pending→
// applyPendingHistoryAtBoot 管线归位（对齐 MIG-MERGE 语义）；录像经 webContents
// executeJavaScript 注入工具自带的导入器脚本写入渲染端 IndexedDB（主进程无法直写）。
// 真实边界（harness §4.2）：暂存由 tools dist 的真实 stageOneClickImport 产出（生产者→
// 消费者同链）；历史包由真实 buildHistoryPackage 产出；注入脚本在 node:vm 中真实执行
// （非桩回显）证明载荷往返；断言用 node:sqlite/真实文件系统。
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import vm from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import buildTool from '../../tools/migrate-v127/dist/migrate-v127/export-v127.cjs'
import oneclickTool from '../../tools/migrate-v127/dist/migrate-v127/oneclick.cjs'
import {
  applyPendingHistoryAtBoot,
  buildRecordingImportScript,
  consumeOneClickHistoryStaging,
  ONECLICK_MANIFEST_FILE,
  ONECLICK_STAGING_DIR,
  parseOneClickManifest,
  PENDING_HISTORY_SUFFIX,
  runOneClickRecordingImport,
} from '../src/mig-import'

const buildHistoryPackage = (buildTool as { buildHistoryPackage: (dbPath: string, root: string) => Promise<{ ok: boolean, folder?: string }> }).buildHistoryPackage
const stageOneClickImport = (oneclickTool as Record<string, never>).stageOneClickImport as (
  input: { toolDir: string, dataDir: string, artifacts: { historyDir: string | null, recordingsFile: string | null }, now?: Date },
) => Promise<{ ok: boolean, stagingDir?: string, error?: string }>

let seq = 0
async function freshDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `oneclick-desktop-${prefix}-${Date.now()}-${seq += 1}`)
  await mkdir(dir, { recursive: true })
  return dir
}

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
    CREATE TABLE trade_notes (training_id INTEGER NOT NULL, trade_seq INTEGER NOT NULL, note TEXT NOT NULL, PRIMARY KEY (training_id, trade_seq));
  `)
  for (let index = 1; index <= trainings; index += 1) {
    db.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES (?,'60000" + String(index) + "',?,'sh','forward','2026-01-01','2026-06-30','active',1000000,?)")
      .run('t1', `标的${index}`, `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`)
  }
  db.close()
}

/** 真实生产者链：合法库→buildHistoryPackage→工具暂存（与真机一键导入完全同链） */
async function stageRealImport(dataDir: string, trainings = 2): Promise<{ stagingDir: string, bundleFile: string }> {
  const toolDir = join(dataDir, 'tool')
  await mkdir(toolDir, { recursive: true })
  const dbPath = join(toolDir, 'old-trainer.sqlite')
  buildLegalV127Db(dbPath, trainings)
  const packed = await buildHistoryPackage(dbPath, toolDir)
  if (!packed.ok || !packed.folder) throw new Error(`buildHistoryPackage failed: ${JSON.stringify(packed)}`)
  const bundleFile = join(toolDir, '训练录像库-20260101-010101.trainer-recordings.json')
  await writeFile(bundleFile, JSON.stringify({ format: 'trainer-recordings-bundle', version: 1, exportedAt: '2026-10-13T00:00:00.000Z', items: [{ sessionId: 's-1' }] }), 'utf8')
  await writeFile(join(toolDir, 'import-recordings.js'), '// importer placeholder', 'utf8')
  const staged = await stageOneClickImport({ toolDir, dataDir, artifacts: { historyDir: packed.folder, recordingsFile: bundleFile } })
  if (!staged.ok) throw new Error(`stageOneClickImport failed: ${JSON.stringify(staged)}`)
  return { stagingDir: staged.stagingDir!, bundleFile }
}

function readManifest(stagingDir: string): Promise<any> {
  return readFile(join(stagingDir, ONECLICK_MANIFEST_FILE), 'utf8').then(JSON.parse)
}

// ===== 清单契约 =====

describe('MIG-ONECLICK-IMPORT-SIDE（boot 消费·清单契约）', () => {
  it('parseOneClickManifest 合法清单通过且路径穿越（.. 与绝对路径）拒绝', () => {
    const base = { format: 'trainer-oneclick-import', version: 1, stagedAt: '2026-10-13T00:00:00.000Z' }
    const legal = parseOneClickManifest({ ...base, history: { manifest: 'history/迁移清单.json' }, recordings: { file: 'recordings.trainer-recordings.json', importer: 'import-recordings.js' } })
    expect(legal.ok).toBe(true)
    expect(parseOneClickManifest({ ...base, history: null, recordings: null }).ok).toBe(true)
    expect(parseOneClickManifest({ ...base, format: 'other' }).ok).toBe(false)
    expect(parseOneClickManifest({ ...base, history: { manifest: '../trainer.sqlite' } }).ok).toBe(false)
    expect(parseOneClickManifest({ ...base, history: { manifest: 'C:\\abs\\evil.json' } }).ok).toBe(false)
    expect(parseOneClickManifest({ ...base, recordings: { file: '../../evil.json', importer: 'x.js' } }).ok).toBe(false)
  })
})

// ===== 历史归位 =====

describe('MIG-ONECLICK-IMPORT-SIDE（boot 消费·历史归位）', () => {
  it('无暂存 manifest 时 no-op 且目标库零触碰', async () => {
    const dataDir = await freshDir('noop')
    const targetPath = join(dataDir, 'trainer.sqlite')
    const outcome = await consumeOneClickHistoryStaging(dataDir, targetPath)
    expect(outcome.ran).toBe(false)
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(join(dataDir, ONECLICK_STAGING_DIR))).toBe(false)
  })

  it('工具真实暂存经 consumeOneClickHistoryStaging 产出 pending 并由 applyPendingHistoryAtBoot 合并归位', async () => {
    const dataDir = await freshDir('chain')
    const targetPath = join(dataDir, 'trainer.sqlite')
    const { stagingDir } = await stageRealImport(dataDir, 3)

    const consumed = await consumeOneClickHistoryStaging(dataDir, targetPath)
    expect(consumed.ran).toBe(true)
    if (!consumed.ok) throw new Error(String(consumed.error))
    expect(existsSync(`${targetPath}${PENDING_HISTORY_SUFFIX}`)).toBe(true)
    const manifest = await readManifest(stagingDir)
    expect(typeof manifest.history.consumedAt).toBe('string')

    // boot 合并应用（目标不存在＝pending 就位）→ 训练可读
    const applied = await applyPendingHistoryAtBoot(targetPath)
    expect(applied.applied).toBe(true)
    const db = new DatabaseSync(targetPath, { readOnly: true })
    try {
      expect((db.prepare('SELECT COUNT(*) AS count FROM trainings').get() as { count: number }).count).toBe(3)
    } finally { db.close() }
  })

  it('历史包被篡改时 consume 返回结构化失败、暂存保留可重试且目标库零损伤', async () => {
    const dataDir = await freshDir('tamper')
    const targetPath = join(dataDir, 'trainer.sqlite')
    const { stagingDir } = await stageRealImport(dataDir, 1)
    await writeFile(join(stagingDir, 'history', 'trainer.sqlite'), 'tampered-bytes', { flag: 'a' })

    const consumed = await consumeOneClickHistoryStaging(dataDir, targetPath)
    expect(consumed.ran).toBe(true)
    expect(consumed.ok).toBe(false)
    expect(String(consumed.error)).toContain('校验')
    expect(existsSync(`${targetPath}${PENDING_HISTORY_SUFFIX}`)).toBe(false)
    expect(existsSync(join(stagingDir, ONECLICK_MANIFEST_FILE))).toBe(true)
    const manifest = await readManifest(stagingDir)
    expect(manifest.history.consumedAt).toBeUndefined()
    // 目标库零损伤：pending 应用为 no-op
    const applied = await applyPendingHistoryAtBoot(targetPath)
    expect(applied.applied).toBe(false)
    expect(existsSync(targetPath)).toBe(false)
  })
})

// ===== 录像注入 =====

describe('MIG-ONECLICK-IMPORT-SIDE（boot 消费·录像注入）', () => {
  const importerStub = 'window.__v127OneClickImport = async function (bundleText) { return { ok: true, imported: 1, skipped: 0, failed: 0, received: bundleText } }'
  const bundlePayload = 'BUNDLE-训练录像-载荷{"format":"trainer-recordings-bundle"}'

  it('buildRecordingImportScript 组装的脚本可在 vm 中执行并原样送达合并包载荷', async () => {
    const script = buildRecordingImportScript(importerStub, bundlePayload)
    const context = vm.createContext({ window: {} })
    const raw = await vm.runInContext(script, context)
    const parsed = JSON.parse(String(raw))
    expect(parsed.ok).toBe(true)
    expect(parsed.received).toBe(bundlePayload)
  })

  it('buildRecordingImportScript 对导入器抛错返回结构化失败（不向主进程抛异常）', async () => {
    const script = buildRecordingImportScript('window.__v127OneClickImport = async function () { throw new Error("boom") }', bundlePayload)
    const raw = await vm.runInContext(script, vm.createContext({ window: {} }))
    expect(JSON.parse(String(raw)).ok).toBe(false)
  })

  it('runOneClickRecordingImport 成功后清理录像暂存并在 manifest 标记已消费', async () => {
    const dataDir = await freshDir('rec-ok')
    const stagingDir = join(dataDir, ONECLICK_STAGING_DIR)
    await mkdir(stagingDir, { recursive: true })
    await writeFile(join(stagingDir, 'recordings.trainer-recordings.json'), bundlePayload, 'utf8')
    await writeFile(join(stagingDir, 'import-recordings.js'), importerStub, 'utf8')
    await writeFile(join(stagingDir, ONECLICK_MANIFEST_FILE), JSON.stringify({
      format: 'trainer-oneclick-import', version: 1, stagedAt: '2026-10-13T00:00:00.000Z',
      history: null, recordings: { file: 'recordings.trainer-recordings.json', importer: 'import-recordings.js' },
    }), 'utf8')

    const outcome = await runOneClickRecordingImport({
      dataDir,
      // 真实执行注入脚本（vm + window 桩）＝经消费者真实机制，而非回显我方拼的字符串
      executeJavaScript: async code => vm.runInContext(code, vm.createContext({ window: {} })),
    })
    expect(outcome.ran).toBe(true)
    if (!outcome.ok) throw new Error(String(outcome.error))
    expect(existsSync(join(stagingDir, 'recordings.trainer-recordings.json'))).toBe(false)
    expect(existsSync(join(stagingDir, 'import-recordings.js'))).toBe(false)
    const manifest = await readManifest(stagingDir)
    expect(typeof manifest.recordings.consumedAt).toBe('string')
  })

  it('runOneClickRecordingImport 页面失败时保留暂存供下次启动重试', async () => {
    const dataDir = await freshDir('rec-fail')
    const stagingDir = join(dataDir, ONECLICK_STAGING_DIR)
    await mkdir(stagingDir, { recursive: true })
    await writeFile(join(stagingDir, 'recordings.trainer-recordings.json'), bundlePayload, 'utf8')
    await writeFile(join(stagingDir, 'import-recordings.js'), importerStub, 'utf8')
    await writeFile(join(stagingDir, ONECLICK_MANIFEST_FILE), JSON.stringify({
      format: 'trainer-oneclick-import', version: 1, stagedAt: '2026-10-13T00:00:00.000Z',
      history: null, recordings: { file: 'recordings.trainer-recordings.json', importer: 'import-recordings.js' },
    }), 'utf8')

    const outcome = await runOneClickRecordingImport({
      dataDir,
      executeJavaScript: async () => JSON.stringify({ ok: false, error: 'IndexedDB 打开失败' }),
    })
    expect(outcome.ran).toBe(true)
    expect(outcome.ok).toBe(false)
    expect(String(outcome.error)).toContain('IndexedDB')
    expect(existsSync(join(stagingDir, 'recordings.trainer-recordings.json'))).toBe(true)
    const manifest = await readManifest(stagingDir)
    expect(manifest.recordings.consumedAt).toBeUndefined()
  })

  it('runOneClickRecordingImport 无 manifest 或已消费时 no-op', async () => {
    const empty = await freshDir('rec-noop')
    expect((await runOneClickRecordingImport({ dataDir: empty, executeJavaScript: async () => '' })).ran).toBe(false)

    const dataDir = await freshDir('rec-done')
    const stagingDir = join(dataDir, ONECLICK_STAGING_DIR)
    await mkdir(stagingDir, { recursive: true })
    await writeFile(join(stagingDir, ONECLICK_MANIFEST_FILE), JSON.stringify({
      format: 'trainer-oneclick-import', version: 1, stagedAt: '2026-10-13T00:00:00.000Z',
      history: null,
      recordings: { file: 'recordings.trainer-recordings.json', importer: 'import-recordings.js', consumedAt: '2026-10-13T01:00:00.000Z' },
    }), 'utf8')
    let executed = false
    const outcome = await runOneClickRecordingImport({ dataDir, executeJavaScript: async () => { executed = true; return '' } })
    expect(outcome.ran).toBe(false)
    expect(executed).toBe(false)
  })
})
