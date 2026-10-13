// MIG-ONECLICK-01：一键迁移工具（同一文件两侧运行）单测——工具节点。
// 覆盖：①模式自检测（detectOneClickMode：父目录 runtime\node.exe＝v1.2.7 导出侧 /
//   父目录 K 系 Electron exe＝v1.3.x 导入侧 / 无标记 fail-closed）；
// ②MIG-ONECLICK-EXPORT-SIDE：训练历史迁移包与录像合并包都生成于工具自身文件夹内
//   （prepareOneClickHistory / saveUploadedBundle，用户拍板「生成在迁移工具文件夹中」）；
// ③MIG-ONECLICK-IMPORT-SIDE 工具节点：数据目录解析镜像桌面优先级（resolveImportTargets，
//   全程无需用户输入路径）、产物自发现（pickOneClickArtifacts）、停服门禁（decideImportGate）、
//   暂存（stageOneClickImport：manifest 最后落盘＝完成标记，中途失败不产标记，幂等重跑替换）。
// 真实边界（harness §4.2）：detectOneClickMode/stageOneClickImport 走真实文件系统临时目录；
// 训练历史导出走真实 buildHistoryPackage（合法 v1.2.7 库形状，与 desktop/test 同形状）。
import { describe, expect, it } from 'vitest'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import tool from '../../tools/migrate-v127/dist/migrate-v127/export-v127.cjs'
import oneclick from '../../tools/migrate-v127/dist/migrate-v127/oneclick.cjs'

const { prepareOneClickHistory, saveUploadedBundle } = tool as Record<string, never> as {
  prepareOneClickHistory: (dbPath: string, outDir: string) => Promise<{ ok: boolean, folder?: string, error?: string, manifest?: { counts?: Record<string, number> } }>
  saveUploadedBundle: (outDir: string, jsonText: string, now?: Date) => Promise<{ ok: boolean, skipped?: boolean, file?: string, error?: string, itemCount?: number }>
}
const detectOneClickMode = (oneclick as Record<string, never>).detectOneClickMode as (parentDir: string) => Promise<{ mode: 'export' } | { mode: 'import', exePath: string } | { mode: 'unknown', reason: string }>
const resolveImportTargets = (oneclick as Record<string, never>).resolveImportTargets as (
  env: NodeJS.ProcessEnv, installDir: string, homeDir: string,
) => Promise<{ dataDir: string, databasePath: string, dataDirSource: string }>
const pickOneClickArtifacts = (oneclick as Record<string, never>).pickOneClickArtifacts as (toolDir: string) => Promise<{ historyDir: string | null, recordingsFile: string | null }>
const decideImportGate = (oneclick as Record<string, never>).decideImportGate as (
  stateRead: { state?: { port: number, pid: number | null } | null, problem?: string },
  probes: { pidAlive(pid: number): boolean, probe(port: number): Promise<{ responded: boolean }> },
) => Promise<{ ok: boolean, reason?: string }>
const stageOneClickImport = (oneclick as Record<string, never>).stageOneClickImport as (
  input: { toolDir: string, dataDir: string, artifacts: { historyDir: string | null, recordingsFile: string | null }, now?: Date },
  deps?: { copyFile?(src: string, dest: string): Promise<void> },
) => Promise<{ ok: boolean, stagingDir?: string, manifest?: { history: { manifest: string } | null, recordings: { file: string, importer: string } | null }, error?: string }>
const STAGING_DIR_NAME = (oneclick as Record<string, never>).STAGING_DIR_NAME as string
const MANIFEST_FILE = (oneclick as Record<string, never>).MANIFEST_FILE as string

let seq = 0
async function freshDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `oneclick-${prefix}-${Date.now()}-${seq += 1}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 合法 v1.2.7 最小形状库（与 desktop/test/mig-import.test.ts buildLegalV127Db 同契约） */
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
    db.prepare("INSERT INTO trainings (tier, code, name, market, adjust_mode, start_date, planned_end, status, initial_cash, created_at) VALUES (?,'600000',?,'sh','forward','2026-01-01','2026-06-30','active',1000000,?)")
      .run('t1', `标的${index}`, `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`)
  }
  db.close()
}

function bundleText(itemCount = 2): string {
  return JSON.stringify({ format: 'trainer-recordings-bundle', version: 1, exportedAt: '2026-10-13T00:00:00.000Z', items: Array.from({ length: itemCount }, (_, i) => ({ sessionId: `s-${i}` })) })
}

// ===== 模式自检测 =====

describe('一键迁移工具·模式自检测（detectOneClickMode）', () => {
  it('父目录含 runtime node exe 判为 v1.2.7 导出侧', async () => {
    const parent = await freshDir('detect-export')
    await mkdir(join(parent, 'runtime'), { recursive: true })
    await writeFile(join(parent, 'runtime', 'node.exe'), '', 'utf8')
    await expect(detectOneClickMode(parent)).resolves.toEqual({ mode: 'export' })
  })

  it('父目录含 K 系 Electron exe 判为 v1.3.x 导入侧并给出 exe 路径', async () => {
    const parent = await freshDir('detect-import')
    await writeFile(join(parent, 'K线训练器.exe'), '', 'utf8')
    await writeFile(join(parent, 'Uninstall K线训练器.exe'), '', 'utf8')
    const outcome = await detectOneClickMode(parent)
    expect(outcome.mode).toBe('import')
    if (outcome.mode === 'import') expect(outcome.exePath).toBe(join(parent, 'K线训练器.exe'))
  })

  it('无 v1.2.7 与 v1.3.x 标记时报错不猜（含人话指引）', async () => {
    const parent = await freshDir('detect-none')
    await writeFile(join(parent, 'Uninstall K线训练器.exe'), '', 'utf8')
    const outcome = await detectOneClickMode(parent)
    expect(outcome.mode).toBe('unknown')
    if (outcome.mode === 'unknown') expect(outcome.reason).toContain('migrate-v127')
  })
})

// ===== 导出侧：产物生成于工具文件夹 =====

describe('MIG-ONECLICK-EXPORT-SIDE（一键导出到工具文件夹）', () => {
  it('prepareOneClickHistory 把训练历史迁移包生成于工具文件夹内并回读清单计数', async () => {
    const work = await freshDir('export-hist')
    const dbPath = join(work, 'trainer.sqlite')
    buildLegalV127Db(dbPath, 3)
    const toolDir = join(work, 'migrate-v127')
    await mkdir(toolDir, { recursive: true })
    const outcome = await prepareOneClickHistory(dbPath, toolDir)
    expect(outcome.ok).toBe(true)
    expect(outcome.folder && outcome.folder.startsWith(toolDir)).toBe(true)
    const manifest = JSON.parse(await readFile(join(outcome.folder!, '迁移清单.json'), 'utf8')) as { counts: { trainings: number } }
    expect(manifest.counts.trainings).toBe(3)
    expect(outcome.manifest?.counts?.trainings).toBe(3)
  })

  it('saveUploadedBundle 把合法录像合并包写入工具文件夹且命名带时间戳', async () => {
    const toolDir = await freshDir('export-bundle')
    const outcome = await saveUploadedBundle(toolDir, bundleText(2), new Date(2026, 9, 13, 8, 30, 5))
    expect(outcome.ok).toBe(true)
    expect(outcome.skipped).not.toBe(true)
    expect(outcome.itemCount).toBe(2)
    expect(outcome.file && outcome.file.startsWith(toolDir)).toBe(true)
    expect(outcome.file && /训练录像库-\d{8}-\d{6}\.trainer-recordings\.json$/.test(outcome.file)).toBe(true)
    await expect(readFile(outcome.file!, 'utf8')).resolves.toContain('trainer-recordings-bundle')
  })

  it('saveUploadedBundle 拒绝非合并包载荷且不落任何文件', async () => {
    const toolDir = await freshDir('export-bundle-bad')
    const bad = await saveUploadedBundle(toolDir, JSON.stringify({ hello: 'world' }))
    expect(bad.ok).toBe(false)
    expect(bad.error).toBeTruthy()
    // 带 items 但 format 字段错误：必须被 format 校验独立拒绝（而非靠 items 兜底）
    const wrongFormat = await saveUploadedBundle(toolDir, JSON.stringify({ format: 'evil-bundle', version: 1, exportedAt: '2026-10-13T00:00:00.000Z', items: [{ sessionId: 's-1' }] }))
    expect(wrongFormat.ok).toBe(false)
    expect(String(wrongFormat.error)).toContain('trainer-recordings-bundle')
    await expect(readdir(toolDir)).resolves.toEqual([])
  })

  it('saveUploadedBundle 空录像列表按 skip 完成不产文件', async () => {
    const toolDir = await freshDir('export-bundle-empty')
    const outcome = await saveUploadedBundle(toolDir, bundleText(0))
    expect(outcome.ok).toBe(true)
    expect(outcome.skipped).toBe(true)
    await expect(readdir(toolDir)).resolves.toEqual([])
  })
})

// ===== 导入侧：工具节点 =====

describe('MIG-ONECLICK-IMPORT-SIDE（一键导入侧·工具节点）', () => {
  it('resolveImportTargets 按 env 显式、trainer.config.json、采用记录、默认主目录优先级解析（无需用户输入）', async () => {
    const install = await freshDir('tgt-install')
    const home = await freshDir('tgt-home')
    const custom = await freshDir('tgt-custom')
    const adopted = await freshDir('tgt-adopted')

    // ① 无任何配置：唯一默认 legacy-home
    const fallback = await resolveImportTargets({}, install, home)
    expect(fallback.dataDir).toBe(join(home, '.a-share-kline-trainer'))
    expect(fallback.databasePath).toBe(join(home, '.a-share-kline-trainer', 'trainer.sqlite'))

    // ② 采用记录（adopted 且库在）：优先于默认
    await writeFile(join(adopted, 'trainer.sqlite'), '', 'utf8')
    await writeFile(join(install, 'desktop-data-choice.json'), JSON.stringify({ version: 1, mode: 'adopted', dataDir: adopted, decidedAt: '2026-10-01T00:00:00.000Z' }), 'utf8')
    const byRecord = await resolveImportTargets({}, install, home)
    expect(byRecord.dataDir).toBe(adopted)

    // ③ trainer.config.json 显式 dataDir：优先于采用记录
    await writeFile(join(install, 'trainer.config.json'), JSON.stringify({ dataDir: custom }), 'utf8')
    const byConfig = await resolveImportTargets({}, install, home)
    expect(byConfig.dataDir).toBe(custom)

    // ④ env 显式：最优先；TRAINER_DB 另置库
    const envDir = await freshDir('tgt-env')
    const envDb = join(envDir, 'other.sqlite')
    const byEnv = await resolveImportTargets({ TRAINER_DATA_DIR: envDir, TRAINER_DB: envDb }, install, home)
    expect(byEnv.dataDir).toBe(envDir)
    expect(byEnv.databasePath).toBe(envDb)
  })

  it('pickOneClickArtifacts 取工具文件夹内最新的历史迁移文件夹与录像合并包', async () => {
    const toolDir = await freshDir('pick')
    const oldDir = join(toolDir, '训练历史迁移-20260101-010101')
    const newDir = join(toolDir, '训练历史迁移-20260102-010101')
    for (const dir of [oldDir, newDir]) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'trainer.sqlite'), 'db', 'utf8')
      await writeFile(join(dir, '迁移清单.json'), '{}', 'utf8')
    }
    await writeFile(join(toolDir, '训练录像库-20260101-010101.trainer-recordings.json'), 'a', 'utf8')
    await writeFile(join(toolDir, '训练录像库-20260102-010101.trainer-recordings.json'), 'b', 'utf8')
    const picked = await pickOneClickArtifacts(toolDir)
    expect(picked.historyDir).toBe(newDir)
    expect(picked.recordingsFile).toBe(join(toolDir, '训练录像库-20260102-010101.trainer-recordings.json'))
  })

  it('decideImportGate 训练器运行中（pid 存活或端口有应答）一律拒绝暂存', async () => {
    const state = { state: { port: 8787, pid: 4242 } }
    const refused = await decideImportGate(state, { pidAlive: () => true, probe: async () => ({ responded: false }) })
    expect(refused.ok).toBe(false)
    expect(refused.reason).toContain('退出')
    const answered = await decideImportGate(state, { pidAlive: () => false, probe: async () => ({ responded: true }) })
    expect(answered.ok).toBe(false)
    expect(answered.reason).toContain('退出')
  })

  it('decideImportGate 无运行记录或已退出时放行', async () => {
    const none = await decideImportGate({ problem: 'state file missing' }, { pidAlive: () => true, probe: async () => ({ responded: true }) })
    expect(none.ok).toBe(true)
    const exited = await decideImportGate({ state: { port: 8787, pid: 4242 } }, { pidAlive: () => false, probe: async () => ({ responded: false }) })
    expect(exited.ok).toBe(true)
  })

  it('stageOneClickImport 把录像包、导入器脚本与历史包暂存到数据目录并最后写 manifest', async () => {
    const work = await freshDir('stage')
    const toolDir = join(work, 'migrate-v127')
    const dataDir = join(work, 'data')
    const historyDir = join(toolDir, '训练历史迁移-20260101-010101')
    await mkdir(historyDir, { recursive: true })
    await writeFile(join(historyDir, 'trainer.sqlite'), 'SQLITE-BYTES', 'utf8')
    await writeFile(join(historyDir, '迁移清单.json'), '{}', 'utf8')
    const bundleFile = join(toolDir, '训练录像库-20260101-010101.trainer-recordings.json')
    await writeFile(bundleFile, bundleText(), 'utf8')
    await writeFile(join(toolDir, 'import-recordings.js'), '// importer', 'utf8')

    const staged = await stageOneClickImport({ toolDir, dataDir, artifacts: { historyDir, recordingsFile: bundleFile } })
    expect(staged.ok).toBe(true)
    const stagingDir = join(dataDir, STAGING_DIR_NAME)
    expect(staged.stagingDir).toBe(stagingDir)
    await expect(readFile(join(stagingDir, 'recordings.trainer-recordings.json'), 'utf8')).resolves.toContain('trainer-recordings-bundle')
    await expect(readFile(join(stagingDir, 'import-recordings.js'), 'utf8')).resolves.toBe('// importer')
    await expect(readFile(join(stagingDir, 'history', 'trainer.sqlite'), 'utf8')).resolves.toBe('SQLITE-BYTES')
    await expect(readFile(join(stagingDir, 'history', '迁移清单.json'), 'utf8')).resolves.toBe('{}')
    const manifest = JSON.parse(await readFile(join(stagingDir, MANIFEST_FILE), 'utf8'))
    expect(manifest.format).toBe('trainer-oneclick-import')
    expect(manifest.history).toEqual({ manifest: 'history/迁移清单.json' })
    expect(manifest.recordings).toEqual({ file: 'recordings.trainer-recordings.json', importer: 'import-recordings.js' })
  })

  it('stageOneClickImport 中途失败不写 manifest（fail-closed 完成标记）', async () => {
    const work = await freshDir('stage-fail')
    const toolDir = join(work, 'migrate-v127')
    const dataDir = join(work, 'data')
    const historyDir = join(toolDir, '训练历史迁移-20260101-010101')
    await mkdir(historyDir, { recursive: true })
    await writeFile(join(historyDir, 'trainer.sqlite'), 'x', 'utf8')
    await writeFile(join(historyDir, '迁移清单.json'), '{}', 'utf8')
    const bundleFile = join(toolDir, '训练录像库-20260101-010101.trainer-recordings.json')
    await writeFile(bundleFile, bundleText(), 'utf8')
    await writeFile(join(toolDir, 'import-recordings.js'), '// importer', 'utf8')

    const outcome = await stageOneClickImport(
      { toolDir, dataDir, artifacts: { historyDir, recordingsFile: bundleFile } },
      { copyFile: async (src, dest) => { if (dest.includes('history')) throw new Error('disk full'); await copyFile(src, dest) } },
    )
    expect(outcome.ok).toBe(false)
    expect(existsSync(join(dataDir, STAGING_DIR_NAME, MANIFEST_FILE))).toBe(false)
  })

  it('stageOneClickImport 重复运行替换旧暂存（幂等且无残渣）', async () => {
    const work = await freshDir('stage-again')
    const toolDir = join(work, 'migrate-v127')
    const dataDir = join(work, 'data')
    const historyDir = join(toolDir, '训练历史迁移-20260101-010101')
    await mkdir(historyDir, { recursive: true })
    await writeFile(join(historyDir, 'trainer.sqlite'), 'db', 'utf8')
    await writeFile(join(historyDir, '迁移清单.json'), '{}', 'utf8')
    const bundleFile = join(toolDir, '训练录像库-20260101-010101.trainer-recordings.json')
    await writeFile(bundleFile, 'first', 'utf8')
    await writeFile(join(toolDir, 'import-recordings.js'), '// importer', 'utf8')
    await stageOneClickImport({ toolDir, dataDir, artifacts: { historyDir, recordingsFile: bundleFile } })
    expect(existsSync(join(dataDir, STAGING_DIR_NAME, 'history', 'trainer.sqlite'))).toBe(true)

    // 第二次导出后只剩录像（无历史）：重跑暂存必须整体替换，不残留旧 history
    await rm(historyDir, { recursive: true, force: true })
    await writeFile(bundleFile, 'second', 'utf8')
    const second = await stageOneClickImport({ toolDir, dataDir, artifacts: { historyDir: null, recordingsFile: bundleFile } })
    expect(second.ok).toBe(true)
    expect(existsSync(join(dataDir, STAGING_DIR_NAME, 'history'))).toBe(false)
    await expect(readFile(join(dataDir, STAGING_DIR_NAME, 'recordings.trainer-recordings.json'), 'utf8')).resolves.toBe('second')
    const manifest = JSON.parse(await readFile(join(dataDir, STAGING_DIR_NAME, MANIFEST_FILE), 'utf8'))
    expect(manifest.history).toBeNull()
    expect(manifest.recordings).not.toBeNull()
  })
})
