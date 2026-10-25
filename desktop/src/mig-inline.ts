import { createServer, type Server } from 'node:http'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  ONECLICK_MANIFEST_FILE,
  ONECLICK_STAGING_DIR,
  applyPendingHistoryAtBoot,
  consumeOneClickHistoryStaging,
  runOneClickRecordingImport,
  validateHistorySchema,
  type OneClickManifest,
} from './mig-import.js'

// MIG-INLINE-01 v1.2.7 迁移内置向导——主进程三段（Electron 侧；依赖注入面收窄，vitest 可测）。
// 用户 2026-10-25 拍板：外置工具内置到 v1.3.2；三项确认＝录像浏览器一键折衷／首启弹一次
// ＋设置页常驻入口／同号重发。矩阵 migration-inline。
//
// 复用边界（不重造已验证管线）：
//   - 历史合并：构造 OneClick 暂存形态（<dataDir>/migrate-v127-import/）后转调
//     consumeOneClickHistoryStaging＋applyPendingHistoryAtBoot——MIG-MERGE-01 冻结语义
//     （幂等键跳过/ns 永不改动/导入前备份/失败零损伤）原样生效，本模块只做「路径→暂存」。
//   - 录像回流：旧 origin 端口伺服导出页＋POST /upload-bundle 暂存（runOneClickRecordingImport
//     的注入消费链不变——向导运行中由 main.ts 对当前窗口立即注入）。
// 只读铁律（外置工具安全口径沿用）：旧目录任何文件绝不修改删除；inspect/迁移一律先复制
// db＋-wal＋-shm 到临时目录再打开（源库零写入、WAL 自动折叠）。
// 端口纪律：旧 origin 端口必须精确（IndexedDB 按源绑定）——被占用人话拒绝，绝不静默换端口。

/** v1.2.7 安装目录的只读体检结果（向导第 1 步呈现） */
export interface LegacyInspectResult {
  ok: boolean
  /** ok=false 时的人话原因（含可行动指引），ok=true 时缺省 */
  error?: string
  /** 探测到的 v1.2.7 数据目录（绝对路径） */
  dataDir?: string
  /** 数据目录探测来源（呈现用） */
  dataDirSource?: 'package-data' | 'config'
  dbPath?: string
  trainings?: number
  trades?: number
  /** 旧库 recording_namespace（录像归属；null＝未设置） */
  recordingNamespace?: string | null
  /** 旧 origin 端口（录像 IndexedDB 绑定；trainer-state.json > 8787） */
  originPort: number
  portSource?: string
}

export interface InlineHistoryResult {
  ok: boolean
  error?: string
  imported?: number
  skipped?: number
}

export interface LegacyExportServerHandle {
  ok: boolean
  error?: string
  url?: string
  close(): Promise<void>
}

export interface LegacyExportServerInput {
  dataDir: string
  port: number
  pageHtml: string
  /** 录像导入器脚本文本（tools/migrate-v127 的 import-recordings.js 内容；主进程从包内资源读，测试注入） */
  importerText: string
}

/** 内置录像迁移运行态（向导轮询呈现） */
export interface InlineRecordingState {
  phase: 'idle' | 'serving' | 'uploaded' | 'imported' | 'skipped' | 'failed'
  itemCount?: number
  summary?: { imported?: number, skipped?: number, failed?: number }
  error?: string
}

const inlineRecordingState: InlineRecordingState = { phase: 'idle' }

export function getInlineRecordingState(): InlineRecordingState {
  return { ...inlineRecordingState }
}

const LEGACY_DB_FILE = 'trainer.sqlite'
const LEGACY_STATE_FILE = 'trainer-state.json'
const DEFAULT_ORIGIN_PORT = 8787
const STAGING_HISTORY_DIR = 'history'
const STAGING_HISTORY_MANIFEST = '迁移清单.json'
const HISTORY_SQLITE_FILE = 'trainer.sqlite'
const HISTORY_MANIFEST_FORMAT = 'trainer-history-migration'
const HISTORY_MANIFEST_VERSION = 1
const ONECLICK_FORMAT = 'trainer-oneclick-import'
const ONECLICK_VERSION = 1

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch { return false }
}

/** 复制 db＋-wal＋-shm 到临时目录并打开（源库零写入；WAL 在副本上自动折叠） */
async function openLegacyCopy(dbPath: string, purpose: string): Promise<{ dir: string, db: DatabaseSync }> {
  const dir = join(tmpdir(), `miginline-${purpose}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  await mkdir(dir, { recursive: true })
  const copy = join(dir, 'trainer.sqlite')
  await copyFile(dbPath, copy)
  for (const suffix of ['-wal', '-shm']) {
    if (await pathExists(dbPath + suffix)) await copyFile(dbPath + suffix, copy + suffix).catch(() => {})
  }
  return { dir, db: new DatabaseSync(copy, { readOnly: true }) }
}

/** v1.2.7 安装路径只读体检：数据目录两级探测（包根/data > trainer.config.json dataDir）＋
 *  schema 形状校验＋局数摘要＋旧 origin 端口解析。任何失败只返回人话原因，不改文件。 */
export async function inspectLegacyRoot(root: string): Promise<LegacyInspectResult> {
  const fail = (error: string): LegacyInspectResult => ({ ok: false, error, originPort: DEFAULT_ORIGIN_PORT })
  // 数据目录：包根/data（主形态）
  let dataDir = join(root, 'data')
  let dataDirSource: 'package-data' | 'config' = 'package-data'
  if (!(await pathExists(join(dataDir, LEGACY_DB_FILE)))) {
    // trainer.config.json dataDir 指向（自定义形态）
    let configDir: string | null = null
    try {
      const raw = JSON.parse(await readFile(join(root, 'trainer.config.json'), 'utf8')) as { dataDir?: unknown }
      if (typeof raw.dataDir === 'string' && raw.dataDir.trim() !== '') configDir = raw.dataDir.trim()
    } catch { /* 无配置或损坏＝按包根形态处理 */ }
    if (configDir !== null && await pathExists(join(configDir, LEGACY_DB_FILE))) {
      dataDir = configDir
      dataDirSource = 'config'
    } else {
      return fail(`所选目录里找不到 v1.2.7 的训练数据（期望位置：<目录>\\data\\${LEGACY_DB_FILE}${configDir === null ? '' : '，或 trainer.config.json 指定的数据目录'}）。请确认选择的是 v1.2.7 的安装根目录（含 Start.cmd 的那一层）。`)
    }
  }
  const dbPath = join(dataDir, LEGACY_DB_FILE)
  // 只读副本体检（源库零写入）
  let dir = ''
  let db: DatabaseSync
  try {
    const opened = await openLegacyCopy(dbPath, 'inspect')
    dir = opened.dir; db = opened.db
  } catch (error) {
    return fail(`训练库无法读取（可能已损坏）：${reasonOf(error)}`)
  }
  try {
    const shape = validateHistorySchema(db)
    if (!shape.ok) return fail(`该目录的训练库不是 v1.2.7 形状（${shape.error}）。请选择 v1.2.7 的安装根目录。`)
    const trainings = (db.prepare('SELECT COUNT(*) c FROM trainings').get() as { c: number }).c
    const trades = (db.prepare('SELECT COUNT(*) c FROM trades').get() as { c: number }).c
    let recordingNamespace: string | null = null
    try {
      const row = db.prepare("SELECT value FROM cache_meta WHERE key = 'recording_namespace'").get() as { value: string } | undefined
      recordingNamespace = row?.value ?? null
    } catch { recordingNamespace = null }
    db.close()
    // 旧 origin 端口：trainer-state.json > 8787（换端口＝读不到录像，绝不猜测成功）
    let originPort = DEFAULT_ORIGIN_PORT
    let portSource = `默认 ${DEFAULT_ORIGIN_PORT}（未找到 ${LEGACY_STATE_FILE}）`
    try {
      const state = JSON.parse(await readFile(join(dataDir, LEGACY_STATE_FILE), 'utf8')) as { port?: unknown }
      if (typeof state.port === 'number' && state.port >= 1 && state.port <= 65535) {
        originPort = state.port
        portSource = `${LEGACY_STATE_FILE}（旧训练器实际使用端口）`
      }
    } catch { /* 缺省/损坏按默认端口并如实标注 */ }
    await rm(dir, { recursive: true, force: true })
    return { ok: true, dataDir, dataDirSource, dbPath, trainings, trades, recordingNamespace, originPort, portSource }
  } catch (error) {
    try { db.close() } catch { /* 已关 */ }
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return fail(`读取训练数据时出错：${reasonOf(error)}`)
  }
}

/** 读取既有 OneClick 暂存清单（不存在/损坏＝全新形态；保留 recordings 条目与其消费态） */
async function readExistingManifest(stagingDir: string): Promise<Partial<OneClickManifest>> {
  try {
    const raw = JSON.parse(await readFile(join(stagingDir, ONECLICK_MANIFEST_FILE), 'utf8')) as OneClickManifest
    if (raw?.format === ONECLICK_FORMAT && typeof raw === 'object') return raw
  } catch { /* 全新形态 */ }
  return {}
}

/** 训练历史内置迁移：体检→老库副本组 OneClick 暂存（重置 history 条目使重跑可消费）→
 *  consume（产 pending）→ apply（合并：幂等跳过/ns 保留/备份先行/失败零损伤）。
 *  运行中调用前提＝内嵌服务空闲（无进行中的训练）；向导场景成立。 */
export async function migrateHistoryInline(input: {
  legacyRoot: string
  dataDir: string
  databasePath: string
}): Promise<InlineHistoryResult> {
  const inspect = await inspectLegacyRoot(input.legacyRoot)
  if (!inspect.ok || !inspect.dbPath) return { ok: false, error: inspect.error }

  const stagingDir = join(input.dataDir, ONECLICK_STAGING_DIR)
  const historyDir = join(stagingDir, STAGING_HISTORY_DIR)
  await mkdir(historyDir, { recursive: true })
  // 老库三件套副本入暂存（源库零写入；WAL 在副本上折叠）
  const sqliteTarget = join(historyDir, HISTORY_SQLITE_FILE)
  await copyFile(inspect.dbPath, sqliteTarget)
  for (const suffix of ['-wal', '-shm']) {
    if (await pathExists(inspect.dbPath + suffix)) await copyFile(inspect.dbPath + suffix, sqliteTarget + suffix).catch(() => {})
  }
  const bytes = new Uint8Array(await readFile(sqliteTarget))
  const historyManifest = {
    format: HISTORY_MANIFEST_FORMAT,
    version: HISTORY_MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    sourceApp: 'a-share-kline-trainer v1.2.7（内置迁移）',
    sqliteFile: HISTORY_SQLITE_FILE,
    sqliteBytes: bytes.byteLength,
    sqliteSha256: createHash('sha256').update(bytes).digest('hex'),
    counts: {
      trainings: inspect.trainings ?? 0,
      trades: inspect.trades ?? 0,
      orders: 0,
      equityCurve: 0,
      positionEvents: 0,
      drawings: 0,
      tradeNotes: 0,
    },
  }
  await writeFile(join(historyDir, STAGING_HISTORY_MANIFEST), `${JSON.stringify(historyManifest, null, 2)}\n`, 'utf8')
  // OneClick 清单：history 条目每次重置（consumedAt 清空＝可再次消费，幂等由合并键兜底）；
  // recordings 条目原样保留（录像暂存不被历史迁移覆盖）
  const existing = await readExistingManifest(stagingDir)
  const manifest = {
    format: ONECLICK_FORMAT,
    version: ONECLICK_VERSION,
    stagedAt: new Date().toISOString(),
    history: { manifest: `${STAGING_HISTORY_DIR}/${STAGING_HISTORY_MANIFEST}` },
    recordings: existing.recordings ?? null,
  }
  await writeFile(join(stagingDir, ONECLICK_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const consumed = await consumeOneClickHistoryStaging(input.dataDir, input.databasePath)
  if (consumed.ran && !consumed.ok) return { ok: false, error: consumed.error }
  if (!consumed.ran) return { ok: false, error: '暂存未被消费（清单状态异常），请重试迁移。' }
  const applied = await applyPendingHistoryAtBoot(input.databasePath)
  if (applied.applied) return { ok: true, imported: applied.imported, skipped: applied.skipped }
  if (applied.reason === 'none') return { ok: false, error: '训练历史已暂存但未能合并应用（未产生待应用库）；请重试迁移。' }
  return { ok: false, error: `训练历史合并失败（已自动保留待应用库，可重试；原数据已备份）：${applied.error ?? applied.reason}` }
}

/** 录像导出回流伺服：旧 origin 端口伺服导出页；POST /upload-bundle 收
 *  {bundle, importer} 暂存进 OneClick recordings 条目（main.ts 对当前窗口立即注入导入）。
 *  端口被占＝人话拒绝（旧训练器可能还在运行），绝不静默换端口。 */
export async function startLegacyRecordingExportServer(input: LegacyExportServerInput): Promise<LegacyExportServerHandle> {
  const stagingDir = join(input.dataDir, ONECLICK_STAGING_DIR)
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(input.pageHtml)
      return
    }
    if (req.method === 'POST' && url === '/upload-bundle') {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 256 * 1024 * 1024) req.destroy() })
      req.on('end', () => {
        void (async () => {
          try {
            // oneclick 导出页原生契约（与 export-tool.cjs /upload-bundle 同形态）：
            // {json: "<bundle JSON>"}＝自动上传；{skipped: true}＝浏览器内无旧录像
            const payload = JSON.parse(body) as { json?: unknown, skipped?: unknown }
            if (payload.skipped === true) {
              inlineRecordingState.phase = 'skipped'
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: true, skipped: true }))
              return
            }
            if (typeof payload.json !== 'string') {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: '缺少录像合并包内容（json 字段）。' }))
              return
            }
            await mkdir(stagingDir, { recursive: true })
            const stamp = new Date()
            const pad = (v: number): string => String(v).padStart(2, '0')
            const name = `训练录像库-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.trainer-recordings.json`
            await writeFile(join(stagingDir, name), payload.json, 'utf8')
            const importerName = 'import-recordings.js'
            await writeFile(join(stagingDir, importerName), input.importerText, 'utf8')
            const existing = await readExistingManifest(stagingDir)
            const manifest = {
              format: ONECLICK_FORMAT,
              version: ONECLICK_VERSION,
              stagedAt: new Date().toISOString(),
              history: existing.history ?? null,
              recordings: { file: name, importer: importerName },
            }
            await writeFile(join(stagingDir, ONECLICK_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
            let itemCount = 0
            try { itemCount = (JSON.parse(payload.json) as { items?: unknown[] }).items?.length ?? 0 } catch { itemCount = 0 }
            inlineRecordingState.phase = 'uploaded'
            inlineRecordingState.itemCount = itemCount
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, file: name, itemCount }))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: reasonOf(error) }))
          }
        })()
      })
      return
    }
    if (req.method === 'POST' && url === '/shutdown') {
      res.writeHead(200); res.end('ok')
      setTimeout(() => { server.close() }, 200)
      return
    }
    res.writeHead(404); res.end('not found')
  })
  const bound = await new Promise<{ ok: true } | { ok: false, error: string }>(resolve => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve({ ok: false, error: `端口 ${input.port} 被占用——旧训练器可能还在运行，请先完全退出 v1.2.7（含后台 node 进程）后重试；录像迁移必须使用旧训练器当时的端口（浏览器数据按地址绑定）。` })
      } else {
        resolve({ ok: false, error: `无法在端口 ${input.port} 启动导出服务：${reasonOf(error)}` })
      }
    })
    server.listen(input.port, '127.0.0.1', () => resolve({ ok: true }))
  })
  if (!bound.ok) {
    try { server.close() } catch { /* 未监听 */ }
    return { ok: false, error: bound.error, close: async () => {} }
  }
  inlineRecordingState.phase = 'serving'
  return {
    ok: true,
    url: `http://127.0.0.1:${input.port}/`,
    close: () => new Promise<void>(res => server.close(() => res())),
  }
}



// ===== IPC 路由（MIG-INLINE-01）：经 registerMigrationIpc 的 extraRoutes 注入，不新开通道 =====

export interface InlineMigrationIpcDeps {
  /** 生效数据目录（config.dataDir；null＝启动早期） */
  dataDir(): string | null
  /** 生效训练库路径（config.databasePath） */
  databasePath(): string | null
  /** 读包内导出页 HTML（打包后 resources／开发 build-resources） */
  readPageHtml(): Promise<string>
  /** 读包内录像导入器脚本文本 */
  readImporterText(): Promise<string>
  /** 在系统默认浏览器打开 URL */
  openExternal(url: string): Promise<void>
  /** 对主窗口渲染端执行 JS（录像注入） */
  executeJavaScript(code: string): Promise<unknown>
  /** 原生目录选择（真机缺陷修复 2026-10-25：向导「选择文件夹…」曾误接旧外置工具的
   *  迁移清单.json 文件选择器，用户点开即见系统「找不到文件」提示——必须是 openDirectory） */
  pickDirectory(): Promise<{ ok: true, root: string } | { ok: false, canceled?: boolean, error?: string }>
  logger: { log(...args: unknown[]): void, error(...args: unknown[]): void }
}

let exportHandle: { close(): Promise<void> } | null = null
let injectedThisRound = false

function resetRecordingState(): void {
  inlineRecordingState.phase = 'idle'
  inlineRecordingState.itemCount = undefined
  inlineRecordingState.summary = undefined
  inlineRecordingState.error = undefined
  injectedThisRound = false
}

/** 内置向导六方法路由；返回 null＝方法不属本域（落回 mig-import 原路由） */
export function inlineMigrationRoutes(deps: InlineMigrationIpcDeps) {
  return async (method: unknown, parsed: { root?: unknown } | null): Promise<unknown | null> => {
    if (method === 'inline-pick-root') {
      return await deps.pickDirectory()
    }
    if (method === 'inline-inspect') {
      const root = typeof parsed?.root === 'string' ? parsed.root : ''
      if (!root) return { ok: false, error: '缺少 v1.2.7 安装路径。' }
      return await inspectLegacyRoot(root)
    }
    if (method === 'inline-migrate-history') {
      const root = typeof parsed?.root === 'string' ? parsed.root : ''
      const dataDir = deps.dataDir()
      const databasePath = deps.databasePath()
      if (!root) return { ok: false, error: '缺少 v1.2.7 安装路径。' }
      if (!dataDir || !databasePath) return { ok: false, error: '数据目录未就绪（应用启动中），请稍后重试。' }
      return await migrateHistoryInline({ legacyRoot: root, dataDir, databasePath })
    }
    if (method === 'inline-export-start') {
      if (exportHandle) return { ok: false, error: '录像导出服务已在运行。' }
      const dataDir = deps.dataDir()
      if (!dataDir) return { ok: false, error: '数据目录未就绪（应用启动中），请稍后重试。' }
      const root = typeof parsed?.root === 'string' ? parsed.root : ''
      const inspect = await inspectLegacyRoot(root)
      if (!inspect.ok || !inspect.recordingNamespace) {
        return { ok: false, error: inspect.ok ? '旧数据目录未找到录像命名空间（旧库无录像记录），可直接跳过录像迁移。' : inspect.error }
      }
      const [pageHtml, importerText] = await Promise.all([deps.readPageHtml(), deps.readImporterText()])
      // 页面 info 注入（oneclick 自动模式：打开即扫描上传）＋历史按钮禁用（历史已由向导自动完成）
      const info = {
        port: inspect.originPort,
        namespace: inspect.recordingNamespace,
        namespaceSource: 'sqlite-cache-meta' as const,
        dataDir: null,
        databasePath: null,
        mode: 'oneclick' as const,
        historyExport: { ok: true, folder: '训练历史已在训练器内自动完成迁移' },
      }
      const inject = `<script>window.__V127_INFO__=${JSON.stringify(info)};window.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('history-export-btn');if(b){b.disabled=true;b.textContent='训练历史已自动迁移完成'}});</script>`
      const html = pageHtml.includes('</head>') ? pageHtml.replace('</head>', `${inject}</head>`) : `${inject}${pageHtml}`
      resetRecordingState()
      const handle = await startLegacyRecordingExportServer({ dataDir, port: inspect.originPort, pageHtml: html, importerText })
      if (!handle.ok) return { ok: false, error: handle.error }
      exportHandle = handle
      try {
        await deps.openExternal(handle.url ?? '')
      } catch (error) {
        deps.logger.error('[desktop] 内置迁移：打开浏览器失败（服务已起，请手动访问返回的地址）:', error)
      }
      return { ok: true, url: handle.url }
    }
    if (method === 'inline-export-status') {
      // uploaded 态懒触发一次录像注入导入（幂等由 manifest consumedAt 门控＋导入端业务幂等兜底）
      if (inlineRecordingState.phase === 'uploaded' && !injectedThisRound) {
        injectedThisRound = true
        const dataDir = deps.dataDir()
        if (dataDir) {
          const outcome = await runOneClickRecordingImport({
            dataDir,
            executeJavaScript: code => deps.executeJavaScript(code),
          }).catch(error => ({ ran: true, ok: false, error: reasonOf(error) }))
          if (outcome.ran && outcome.ok) {
            inlineRecordingState.phase = 'imported'
            inlineRecordingState.summary = 'summary' in outcome ? outcome.summary : undefined
            deps.logger.log('[desktop] 内置迁移：录像导入完成', 'summary' in outcome ? outcome.summary : '')
          } else if (outcome.ran) {
            inlineRecordingState.phase = 'failed'
            inlineRecordingState.error = outcome.error
            deps.logger.error('[desktop] 内置迁移：录像导入失败:', outcome.error)
          }
        }
      }
      return { ok: true, state: getInlineRecordingState() }
    }
    if (method === 'inline-export-stop') {
      if (exportHandle) {
        await exportHandle.close().catch(() => {})
        exportHandle = null
      }
      return { ok: true }
    }
    return null
  }
}
