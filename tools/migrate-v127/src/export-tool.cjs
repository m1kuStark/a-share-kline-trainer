'use strict'
/**
 * MIG-01 v1.2.7 训练录像迁移导出工具（Node 侧）。
 *
 * 用包内 runtime\node.exe 运行（零第三方依赖，CommonJS）。职责：
 *   1. 定位旧训练器数据目录（--data-dir > trainer.config.json dataDir > <包根>/data > ~/.a-share-kline-trainer）
 *      与旧 origin 端口（--port > trainer-state.json > trainer.config.json port > 8787）；
 *   2. 从训练库（trainer.sqlite）cache_meta 只读读取录像命名空间——先复制到临时目录再打开，
 *      源库零写入（真实数据安全铁律）；
 *   3. 校验旧服务已退出（状态文件 PID + /api/health 探针，fail-closed）；
 *   4. 在旧 origin 端口上伺服一次性导出页（同源才能读旧 IndexedDB），自动打开默认浏览器；
 *   5. 可选把 SQLite 三件套复制到 <包根>/迁移导出-<时间戳>/（默认升级场景不需要，新 exe 原地采用）。
 *
 * 绝不：修改/删除旧目录既有文件；静默改用其他端口（端口被占＝失败报错，引导控制台兜底脚本）。
 * 页面 HTML 由 tools/migrate-v127/build.mjs 构建时注入（占位符 __V127_PAGE_HTML__）。
 */

const http = require('node:http')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { copyFile, mkdir, readFile, rm, stat } = require('node:fs/promises')

const TOOL_ID = 'migrate-v127'
const STATE_FILE = 'trainer-state.json'
const DB_FILE = 'trainer.sqlite'
const LEGACY_HOME_DIR_NAME = '.a-share-kline-trainer'
const EXPORT_FOLDER_PREFIX = '迁移导出-'
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const NAMESPACE_PATTERN = /^[a-f0-9-]{36}$/i

// 构建期注入（tools/migrate-v127/build.mjs）；模板态保持占位字符串，仅影响未构建直接运行的 / 页面
const PAGE_TEMPLATE = "__V127_PAGE_HTML__"
const PAGE_INFO_TOKEN = '/*__V127_INFO__*/null'

// ===== 参数 =====

function parseArgs(argv) {
  const parsed = { openBrowser: true }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const value = name => {
      if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
      if (arg !== `--${name}`) return undefined
      index += 1
      if (index >= argv.length) throw new Error(`缺少参数值 / missing value for ${arg}`)
      return argv[index]
    }
    const packageRoot = value('package-root')
    if (packageRoot !== undefined) { parsed.packageRoot = packageRoot; continue }
    const dataDir = value('data-dir')
    if (dataDir !== undefined) { parsed.dataDir = dataDir; continue }
    const db = value('db')
    if (db !== undefined) { parsed.db = db; continue }
    const port = value('port')
    if (port !== undefined) {
      const numeric = Number(port)
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) throw new Error(`--port 必须是 1..65535 的整数，收到 ${port}`)
      parsed.port = numeric
      continue
    }
    if (arg === '--no-open') { parsed.openBrowser = false; continue }
    if (arg === '--help' || arg === '-h') { parsed.help = true; continue }
    throw new Error(`未知参数 / unknown argument: ${arg}`)
  }
  return parsed
}

function usage() {
  return [
    '用法 / Usage: export-v127.cjs [--package-root PATH] [--data-dir PATH] [--db PATH] [--port N] [--no-open]',
    '',
    '  --package-root PATH  v1.2.7 包根目录（默认：本工具文件夹的上一级）',
    '  --data-dir PATH      旧训练器数据目录（默认按 trainer.config.json / <包根>/data / ~/.a-share-kline-trainer 探测）',
    '  --db PATH            训练库 trainer.sqlite 路径（默认 <数据目录>/trainer.sqlite）',
    '  --port N             旧训练器 origin 端口（默认读 trainer-state.json，缺失时 8787）',
    '  --no-open            不自动打开浏览器',
  ].join('\n')
}

// ===== trainer.config.json 子集解析（镜像 launcher resolveConfig 的 dataDir/databasePath/port 语义） =====

function parseTrainerConfig(raw, root) {
  if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('trainer.config.json must contain a JSON object')
  }
  const fields = (raw ?? {})
  const text = key => (typeof fields[key] === 'string' ? fields[key].trim() : '')
  const dataDirRaw = text('dataDir')
  const databasePathRaw = text('databasePath')
  if (databasePathRaw && !path.isAbsolute(databasePathRaw)) {
    throw new Error(`trainer.config.json databasePath must be an absolute path: ${databasePathRaw}`)
  }
  const portExplicit = fields.port !== undefined && fields.port !== null && !(typeof fields.port === 'string' && fields.port.trim() === '')
  let port = 8787
  if (portExplicit) {
    const numeric = typeof fields.port === 'string' && fields.port.trim() !== '' ? Number(fields.port) : fields.port
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
      throw new Error(`trainer.config.json port must be an integer in 1..65535, got: ${JSON.stringify(fields.port ?? null)}`)
    }
    port = numeric
  }
  return {
    port,
    portExplicit,
    dataDir: dataDirRaw ? path.resolve(root, dataDirRaw) : null,
    dataDirExplicit: dataDirRaw !== '',
    databasePath: databasePathRaw ? path.resolve(databasePathRaw) : null,
    databasePathExplicit: databasePathRaw !== '',
  }
}

// ===== trainer-state.json 身份校验（镜像 launcher assertStateIdentity 的宽容版） =====

function readStateIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { problem: 'state is not an object' }
  if (value.appId !== 'a-share-kline-trainer') return { problem: `state file belongs to another app: ${JSON.stringify(value.appId)}` }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return { problem: 'state port is invalid' }
  if (value.baseURL !== `http://127.0.0.1:${value.port}`) return { problem: 'state baseURL does not match the port' }
  return { state: { port: value.port, pid: Number.isInteger(value.pid) && value.pid >= 1 ? value.pid : null } }
}

// ===== 数据目录 / 端口解析（纯决策，单测覆盖） =====

function pickDataDir(candidates) {
  const withState = candidates.find(entry => entry.hasState)
  if (withState) return { dir: withState.path, source: withState.source }
  const withDb = candidates.find(entry => entry.hasDb)
  if (withDb) return { dir: withDb.path, source: withDb.source }
  return { dir: candidates[0].path, source: `${candidates[0].source}（未发现训练库文件，将使用默认）` }
}

function resolvePort({ argPort, statePort, configPort, configPortExplicit }) {
  if (argPort) return { port: argPort, source: '命令行 --port' }
  if (statePort) return { port: statePort, source: 'trainer-state.json（旧训练器记录的实际端口）' }
  if (configPortExplicit && configPort) return { port: configPort, source: 'trainer.config.json 显式 port' }
  return { port: 8787, source: '默认 8787（未找到状态文件与显式配置）', warning: '未能在数据目录读到 trainer-state.json，回退默认端口 8787。若旧训练器实际用过其他端口（页面曾有端口提示），请关闭本工具后先用 --port 指定实际端口重试，否则页面将读不到旧录像。' }
}

// ===== 探针 / 进程 =====

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error && error.code === 'EPERM')
  }
}

function probeHealth(port, { timeoutMs = 1200 } = {}) {
  const url = `http://127.0.0.1:${port}/api/health`
  return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    .then(async response => {
      let json = null
      if (response.status === 200) {
        try { json = await response.json() } catch { json = null }
      }
      return { responded: true, refused: false, status: response.status, json }
    })
    .catch(error => {
      const cause = error && error.cause && error.cause.code
      return { responded: false, refused: cause === 'ECONNREFUSED', reason: `${(error && error.message) || error}` }
    })
}

function isTrainerHealth(value) {
  // 与 launcher isTrainerHealth 的差异：runId 允许 null（独立运行的服务 runId 为空）。
  // 本工具只用它判断「端口上是不是一个训练器服务」来给拒绝提示定性，两种情形都拒绝。
  return Boolean(value && typeof value === 'object'
    && value.status === 'ok'
    && (typeof value.runId === 'string' || value.runId === null || value.runId === undefined)
    && Number.isInteger(value.pid))
}

// ===== 命名空间（复制到临时目录后用 node:sqlite 只读源库语义读取） =====

async function fileExists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

async function readNamespaceFromSqlite(dbPath, dataDirForDiagnostics) {
  if (!await fileExists(dbPath)) {
    let listing = '(目录不存在)'
    try {
      const { readdir } = require('node:fs/promises')
      listing = (await readdir(dataDirForDiagnostics || require('node:path').dirname(dbPath))).join(', ') || '(空目录)'
    } catch (error) {
      listing = `(无法列出目录：${error && error.code ? error.code : error && error.message})`
    }
    return { namespace: null, reason: `未找到训练库文件：${dbPath}（数据目录内容：${listing}）` }
  }
  let sqlite
  try {
    sqlite = require('node:sqlite')
  } catch {
    return { namespace: null, reason: '当前 Node 运行时不支持 node:sqlite，无法读取训练库（导出页会列出发现的录像库供手动确认）' }
  }
  const tempDir = path.join(os.tmpdir(), `v127-ns-${crypto.randomUUID()}`)
  await mkdir(tempDir, { recursive: true })
  try {
    const base = path.join(tempDir, DB_FILE)
    await copyFile(dbPath, base)
    for (const suffix of ['-wal', '-shm']) {
      if (await fileExists(`${dbPath}${suffix}`)) await copyFile(`${dbPath}${suffix}`, `${base}${suffix}`)
    }
    const database = new sqlite.DatabaseSync(base)
    try {
      const row = database.prepare("SELECT value FROM cache_meta WHERE key = 'recording_namespace'").get()
      const value = row && row.value
      if (typeof value !== 'string' || !NAMESPACE_PATTERN.test(value)) {
        return { namespace: null, reason: `训练库 cache_meta 中的录像命名空间无效（${JSON.stringify(value ?? null)}）` }
      }
      return { namespace: value }
    } finally {
      database.close()
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ===== SQLite 三件套打包（只复制，绝不移动源文件） =====

function stampOf(now) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

async function packSqlite(databasePath, packageRoot, now = new Date()) {
  if (!await fileExists(databasePath)) throw new Error(`未找到训练库文件：${databasePath}`)
  let folder = path.join(packageRoot, `${EXPORT_FOLDER_PREFIX}${stampOf(now)}`)
  for (let attempt = 1; await fileExists(folder); attempt++) folder = path.join(packageRoot, `${EXPORT_FOLDER_PREFIX}${stampOf(now)}-${attempt}`)
  await mkdir(folder, { recursive: true })
  const copied = []
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${databasePath}${suffix}`
    if (!await fileExists(source)) continue
    const target = path.join(folder, `${DB_FILE}${suffix}`)
    await copyFile(source, target)
    copied.push({ file: `${DB_FILE}${suffix}`, bytes: (await stat(target)).size })
  }
  if (!copied.length) throw new Error('没有复制任何文件（训练库缺失）')
  return { folder, copied }
}

// ===== 主流程 =====

async function readJsonFile(target) {
  try {
    return JSON.parse(await readFile(target, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`无法读取 JSON 文件 ${target}: ${error && error.message}`)
  }
}

function printPlan(layout) {
  console.log('── 迁移导出准备 ──────────────────────────────')
  console.log(`包根目录　　　：${layout.packageRoot}`)
  console.log(`数据目录　　　：${layout.dataDir}（来源：${layout.dataDirSource}）`)
  console.log(`训练库文件　　：${layout.databasePath}`)
  console.log(`旧 origin 端口：${layout.port}（来源：${layout.portSource}）`)
  console.log(`录像命名空间　：${layout.namespace ? `${layout.namespace}（来源：训练库 cache_meta）` : `未知——${layout.namespaceReason}`}`)
  if (layout.portWarning) console.log(`⚠ ${layout.portWarning}`)
  console.log('──────────────────────────────────────────────')
}

function gateFailure(message) {
  console.error(`[错误] ${message}`)
  console.error('导出未开始，旧数据未被触碰。')
  process.exitCode = 2
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const packageRoot = args.packageRoot ? path.resolve(args.packageRoot) : path.dirname(path.dirname(__filename))
  const configRaw = await readJsonFile(path.join(packageRoot, 'trainer.config.json'))
  const config = parseTrainerConfig(configRaw, packageRoot)

  let dataDirChoice
  let databasePath
  if (args.dataDir) {
    // 显式 --data-dir 是权威数据目录：不做候选评分、不受包根 trainer.config.json 影响
    //（评分把显式参数票选出局的静默改写＝歧义静默决定，禁止）。
    dataDirChoice = { dir: path.resolve(args.dataDir), source: '命令行 --data-dir（显式指定，直接采用）' }
    databasePath = args.db ? path.resolve(args.db) : path.join(dataDirChoice.dir, DB_FILE)
  } else {
    const candidates = []
    const addCandidate = (entry) => { if (entry && !candidates.some(item => path.resolve(item.path) === path.resolve(entry.path))) candidates.push(entry) }
    addCandidate(config.dataDirExplicit ? { path: config.dataDir, source: 'trainer.config.json dataDir' } : null)
    addCandidate({ path: path.join(packageRoot, 'data'), source: '包根 data/（v1.2.7 默认）' })
    addCandidate({ path: path.join(os.homedir(), LEGACY_HOME_DIR_NAME), source: `主目录 ${LEGACY_HOME_DIR_NAME}/（旧版默认）` })
    for (const entry of candidates) {
      entry.hasState = await fileExists(path.join(entry.path, STATE_FILE))
      entry.hasDb = await fileExists(path.join(entry.path, DB_FILE))
    }
    dataDirChoice = pickDataDir(candidates)
    databasePath = args.db ? path.resolve(args.db) : (config.databasePathExplicit ? config.databasePath : path.join(dataDirChoice.dir, DB_FILE))
  }

  const stateRaw = await readJsonFile(path.join(dataDirChoice.dir, STATE_FILE))
  const stateRead = stateRaw === null ? { problem: 'state file missing' } : readStateIdentity(stateRaw)
  const portChoice = resolvePort({
    argPort: args.port,
    statePort: stateRead.state ? stateRead.state.port : null,
    // 显式 --data-dir 时包根 trainer.config.json 的 port 不再参与（配置属另一解析上下文）
    configPort: args.dataDir ? null : config.port,
    configPortExplicit: args.dataDir ? false : config.portExplicit,
  })

  // 停服门禁（fail-closed）：状态记录的进程仍活着 → 无论健康端点如何都拒绝；
  // 目标端口上有任何 HTTP 应答（含疑似训练器身份）→ 拒绝。只有明确拒接才继续。
  if (stateRead.state && pidAlive(stateRead.state.pid)) {
    const probe = await probeHealth(stateRead.state.port)
    if (probe.responded && probeMatchesTrainer(probe)) {
      return gateFailure(`旧训练器仍在运行（端口 ${stateRead.state.port}，PID ${stateRead.state.pid}）。请先在训练器页面点「退出训练器」正常退出（或运行 Stop.cmd），再重新双击本工具。`)
    }
    return gateFailure(`数据目录记录的训练器进程（PID ${stateRead.state.pid}）仍存活，但其健康端点无法确认（${probe.reason ?? `HTTP ${probe.status}`}）。为避免读取不一致，请先结束该进程后重试。`)
  }
  const portProbe = await probeHealth(portChoice.port)
  if (portProbe.responded) {
    const identity = probeMatchesTrainer(portProbe)
    return gateFailure(`端口 ${portChoice.port} 上已有服务在应答（${identity ? '像是训练器' : '非训练器'}）。${identity ? '请先退出旧训练器（页面「退出训练器」按钮或 Stop.cmd）。' : '同源导出必须使用旧训练器当时的端口，工具不会改用其他端口。'}也可改用工具文件夹里的「迁移兜底-浏览器控制台脚本.txt」（需要旧训练器保持运行）。`)
  }
  if (!portProbe.refused) {
    return gateFailure(`端口 ${portChoice.port} 探测结果不确定（${portProbe.reason}），无法安全绑定，已停止。请检查防火墙/代理对本机回环地址的拦截后重试。`)
  }

  const namespaceRead = await readNamespaceFromSqlite(databasePath, dataDirChoice.dir)

  const layout = {
    packageRoot,
    dataDir: dataDirChoice.dir,
    dataDirSource: dataDirChoice.source,
    databasePath,
    port: portChoice.port,
    portSource: portChoice.source,
    portWarning: portChoice.warning ?? null,
    namespace: namespaceRead.namespace,
    namespaceReason: namespaceRead.reason ?? null,
  }
  printPlan(layout)

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, layout).catch(error => {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    })
  })
  server.on('error', error => {
    const code = error && error.code
    const hint = code === 'EACCES'
      ? '该端口落在 Windows 系统保留段（WinNAT 排除段）。请用 --port 指定旧训练器实际使用的其他端口。'
      : code === 'EADDRINUSE'
        ? '端口刚被其他程序占用。请关闭占用程序后重试，或改用控制台兜底脚本。'
        : `绑定失败（${code ?? '未知错误'}）。`
    gateFailure(`无法在 127.0.0.1:${layout.port} 上启动导出页：${hint}`)
    process.exit(2)
  })
  await new Promise(resolve => server.listen(layout.port, '127.0.0.1', resolve))

  let idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS)
  const bumpIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS)
  }

  function onIdleTimeout() {
    console.error('[提示] 30 分钟无操作，工具自动退出。需要时请重新双击运行。')
    process.exit(3)
  }

  async function handleRequest(request, response, current) {
    bumpIdle()
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${current.port}`)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const info = {
        port: current.port,
        namespace: current.namespace,
        namespaceSource: current.namespace ? 'sqlite-cache-meta' : 'none',
        dataDir: current.dataDir,
        databasePath: current.databasePath,
      }
      const html = PAGE_TEMPLATE.split(PAGE_INFO_TOKEN).join(JSON.stringify(info))
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(html)
      return
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, tool: TOOL_ID, port: current.port }))
      return
    }
    if (request.method === 'POST' && url.pathname === '/pack-sqlite') {
      const result = await packSqlite(current.databasePath, current.packageRoot)
      console.log(`[导出] SQLite 三件套已复制到 ${result.folder}（${result.copied.map(item => `${item.file} ${item.bytes}B`).join(', ')}）`)
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, folder: result.folder, files: result.copied }))
      return
    }
    if (request.method === 'POST' && url.pathname === '/shutdown') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true }))
      console.log('[完成] 页面请求关闭工具。')
      setTimeout(() => process.exit(0), 200)
      return
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, error: 'not found' }))
  }

  function probeMatchesTrainer(probe) {
    return Boolean(probe.responded && probe.status === 200 && isTrainerHealth(probe.json))
  }

  const baseURL = `http://127.0.0.1:${layout.port}`
  console.log(`[就绪] 导出页已伺服于 ${baseURL}（与旧训练器同源，才能读取旧录像）。`)
  if (args.openBrowser) {
    const opened = await openBrowser(baseURL)
    console.log(opened ? '[浏览器] 已打开默认浏览器。' : '[提示] 无法自动打开浏览器，请手动访问上面的地址（必须用平时使用旧训练器的浏览器）。')
  } else {
    console.log('[提示] --no-open：请手动访问上面的地址（必须用平时使用旧训练器的浏览器）。')
  }
  console.log('[提示] 导出完成后回到本窗口；页面点「完成并关闭工具」或按 Ctrl+C 退出。')

  process.on('SIGINT', () => {
    console.log('\n[退出] 收到 Ctrl+C。旧数据未被修改。')
    process.exit(0)
  })
}

function openBrowser(url) {
  return new Promise(resolve => {
    try {
      const child = process.platform === 'win32'
        ? cp.spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
        : process.platform === 'darwin'
          ? cp.spawn('open', [url], { detached: true, stdio: 'ignore' })
          : cp.spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
      child.once('error', () => resolve(false))
      child.once('spawn', () => resolve(true))
    } catch {
      resolve(false)
    }
  })
}

// ===== 供单测导入的纯函数面（require.main 守卫：被 import 时不执行主流程） =====

module.exports = {
  parseArgs,
  parseTrainerConfig,
  readStateIdentity,
  pickDataDir,
  resolvePort,
  pidAlive,
  isTrainerHealth,
  stampOf,
  PAGE_INFO_TOKEN,
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[错误] ${error instanceof Error ? error.message : String(error)}`)
    console.error('工具异常退出，旧数据未被触碰。')
    process.exit(1)
  })
}
