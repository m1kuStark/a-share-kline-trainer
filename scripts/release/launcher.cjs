'use strict'
/**
 * A股K线训练器 便携版启动器 / Portable launcher for the packaged release.
 *
 * Runs from the package root with the bundled Node runtime (no third-party
 * modules, CommonJS so it loads without a package.json "type" resolution).
 * Package root is the directory containing this script; --root PATH overrides
 * it for unit fixtures. Everything writable lives in the configured data
 * directory, never inside the (possibly read-only) package.
 */

const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const net = require('node:net')
const {
  access, appendFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile,
} = require('node:fs/promises')
const { homedir, tmpdir } = require('node:os')
const { dirname, isAbsolute, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { setTimeout: delay } = require('node:timers/promises')

const APP_ID = 'a-share-kline-trainer'
const DEFAULT_PORT = 8787
const DATA_DIR_NAME = '.a-share-kline-trainer'
const STATE_FILE = 'trainer-state.json'
const LOCK_FILE = 'launch.lock'
const READY_FILE = 'ready.json'
const SERVER_LOG = 'server.log'
const LAUNCHER_LOG = 'launcher.log'
const READY_TIMEOUT_MS = 30_000
const LOCK_WAIT_MS = 15_000
const STOP_EXIT_TIMEOUT_MS = 5_000
// SETUP-01 受控重启（监管模式）：交接文件、已保存选择、有界时限与轮询节奏
const ATTEMPT_FILE = 'setup-restart-attempt.json'
const RESTART_STATUS_FILE = 'setup-restart-status.json'
const SAVED_CHOICE_FILE = 'saved-tdx-choice.json'
const RESTART_TIMEOUTS = {
  saveMs: 5_000,
  drainMs: 15_000,
  sigtermMs: 8_000,
  spawnMs: 20_000,
  healthMs: 25_000,
  restoreMs: 5_000,
}
const SUPERVISOR_ITERATION_CAP = 600
const SUPERVISOR_POLL_MS = 150

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function usage() {
  return [
    '用法 / Usage: node launcher.cjs [--root PATH] [--config PATH] [--no-open] [--stop]',
    '               node launcher.cjs --setup-restart-attempt PATH（内部模式 / internal）',
    '',
    '  --root PATH    包根目录 / package root (default: the directory holding launcher.cjs)',
    '  --config PATH  配置文件 / config file (default: <root>/trainer.config.json, optional)',
    '  --no-open      不自动打开浏览器 / do not open a browser window',
    '  --stop         停止全部已验证训练器进程后退出 / stop all verified trainers, then exit',
    '  --conflict-answer=reuse|restart  预答端口冲突询问（自动化用；正常使用由弹框询问）',
    '                                / pre-answered conflict prompt (automation only)',
    '  --setup-restart-attempt PATH  受控重启监管模式（由应用内"保存并生效"自动调用，',
    '                                不手动运行 / controlled-restart supervisor, invoked by the app)',
    '',
    '停止语义（PORT-02，用户 2026-10-06）：--stop 关闭全部能通过健康身份验证（/api/health',
    '返回 200 且 status/runId/pid 匹配训练器口径）的训练器进程——本包 state 记录者，加系统',
    '扫描发现的命令行含 launcher.cjs 或以 server\\dist\\index.js 结尾的 node 进程（含非本包',
    '记录的孤儿）；身份验证不过的不明进程绝不杀；杀后确认进程退出与端口释放，未确认退出',
    '的如实报错、非零退出码。注意：--stop 仍是应急强制结束（SIGKILL），不等待页面保存完成；',
    '正常的"保存并退出"请在训练器页面使用"退出训练器"按钮，Stop.cmd 只作应急兜底。',
    'Stop semantics (PORT-02): --stop closes every trainer process it can verify by health',
    'identity — the recorded one plus a system-wide sweep of node processes running',
    'launcher.cjs or server\\dist\\index.js (state-less orphans included); unknown or',
    'unverifiable processes are never signaled, and unconfirmed kills are reported honestly',
    'with a non-zero exit. Note: --stop remains an emergency force stop (SIGKILL) that does',
    'not wait for the in-app save flow; use the in-app exit for a normal saved shutdown.',
    '',
    '端口冲突规则 / port conflict rule (PORT-02，用户 2026-10-06)：目标端口被验证为训练器',
    '占用时弹框询问"是否从已有进程启动训练器？"——[是]＝打开已有服务（不新开进程）；',
    '[否]＝关闭该训练器后从新进程启动；PowerShell 不可用时回退控制台输入提示，双通道',
    '皆不可用则中止启动且不杀任何进程。非训练器占用维持原语义（显式端口报明确原因，',
    '默认端口自动换邻近可用端口）。/ when the target port is held by a verified trainer,',
    'a dialog asks "reuse or restart" (console fallback; abort without killing anything if',
    'both channels fail); non-trainer occupants keep the PORT-01 semantics.',
    '',
    '配置字段 / config fields: tdxRoot, port (default 8787), dataDir (default <root>/data), databasePath (absolute).',
    '端口规则 / port rule: 未写 port 时，默认端口被系统保留(WinNAT 排除段)或被占用会自动改用邻近',
    '可用端口并在控制台与页面提示实际端口；显式写了 port 则必须可用，失败时报明确原因。/ without',
    'an explicit "port", a reserved/occupied default port auto-moves to a nearby free port (noted on',
    'console and page); an explicitly configured port is honored and failures name the exact cause.',
    '环境变量优先于配置文件 / environment overrides the config file when set:',
    '  TDX_ROOT=<absolute path>  TRAINER_DB=<absolute sqlite path>',
  ].join('\n')
}

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
    const root = value('root')
    if (root !== undefined) { parsed.root = root; continue }
    const config = value('config')
    if (config !== undefined) { parsed.configPath = config; continue }
    const restartAttempt = value('setup-restart-attempt')
    if (restartAttempt !== undefined) { parsed.restartAttemptPath = restartAttempt; continue }
    const conflictAnswer = value('conflict-answer')
    if (conflictAnswer !== undefined) {
      if (conflictAnswer !== 'reuse' && conflictAnswer !== 'restart') {
        throw new Error(`--conflict-answer 只接受 reuse 或 restart / --conflict-answer accepts reuse or restart, got: ${conflictAnswer}`)
      }
      parsed.conflictAnswer = conflictAnswer
      continue
    }
    if (arg === '--no-open') { parsed.openBrowser = false; continue }
    if (arg === '--stop') { parsed.stop = true; continue }
    if (arg === '--help' || arg === '-h') { parsed.help = true; continue }
    throw new Error(`未知参数 / unknown argument: ${arg}\n\n${usage()}`)
  }
  return parsed
}

async function readConfigFile(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`无法读取配置文件 / cannot read config file ${path}: ${error && error.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`配置文件不是有效 JSON / config file is not valid JSON: ${path} (${error && error.message})`)
  }
}

function requireSanePort(value) {
  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`配置端口无效 / config port must be an integer in 1..65535, got ${JSON.stringify(value ?? null)}`)
  }
  return port
}

/** 配置里是否"显式"写了端口。PORT-01 口径：只有用户亲手写了 port 字段才算显式——
 * 显式端口必须被尊重（失败时报明确原因）；默认端口（未写、写空、写 null）允许
 * 启动器在不可用时自动改用邻近可用端口，保持零配置一键启动。 */
function isExplicitPortField(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

/**
 * Normalize the optional trainer.config.json plus documented environment
 * overrides. Relative tdxRoot/dataDir paths resolve against the package root;
 * databasePath must be absolute so a relative typo cannot silently point into
 * a read-only package.
 */
function resolveConfig(root, raw, env = {}) {
  if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`配置文件内容必须是 JSON 对象 / config file must contain a JSON object`)
  }
  const fields = raw ?? {}
  const text = key => (typeof fields[key] === 'string' ? fields[key].trim() : '')
  const portExplicit = isExplicitPortField(fields.port)
  const config = { port: requireSanePort(portExplicit ? fields.port : DEFAULT_PORT), portExplicit }
  // V1.2.6：默认数据目录从用户主目录改为包根 data——便携包按版本解压在不同文件夹，
  // 各版本训练数据（SQLite 库：历史训练/排行/回放复盘）天然相互独立。旧版本数据仍留在
  // 主目录 DATA_DIR_NAME，可在应用内"训练数据目录"设置中指回该路径继续使用。
  const dataDir = text('dataDir')
  config.dataDir = dataDir ? resolve(root, dataDir) : join(root, 'data')
  const databasePath = text('databasePath')
  if (databasePath) {
    if (!isAbsolute(databasePath)) {
      throw new Error(`databasePath 必须是绝对路径 / databasePath must be an absolute path: ${databasePath}`)
    }
    config.databasePath = resolve(databasePath)
  } else {
    config.databasePath = join(config.dataDir, 'trainer.sqlite')
  }
  const tdxRoot = text('tdxRoot')
  config.tdxRoot = tdxRoot ? resolve(root, tdxRoot) : null
  const envTdxRoot = typeof env.TDX_ROOT === 'string' ? env.TDX_ROOT.trim() : ''
  if (envTdxRoot) config.tdxRoot = resolve(envTdxRoot)
  const envDatabase = typeof env.TRAINER_DB === 'string' ? env.TRAINER_DB.trim() : ''
  if (envDatabase) {
    if (!isAbsolute(envDatabase)) {
      throw new Error(`TRAINER_DB 必须是绝对路径 / TRAINER_DB must be an absolute path: ${envDatabase}`)
    }
    config.databasePath = resolve(envDatabase)
  }
  return config
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    return !(error && error.code === 'ENOENT')
  }
}

async function isTdxRootPath(root) {
  let hasDaily = false
  for (const market of ['sh', 'sz', 'bj']) {
    const names = await readdir(join(root, 'vipdoc', market, 'lday')).catch(() => null)
    if (names && names.some(name => name.toLowerCase().endsWith('.day'))) hasDaily = true
  }
  return hasDaily && await pathExists(join(root, 'T0002', 'hq_cache'))
}

/**
 * Read the saved TDX choice written by the in-app setup flow
 * (server/src/setup/saved-choice.ts, SETUP-SAVE-01). Returns null for a
 * missing/foreign/corrupt file; never throws. Only shape version and the root
 * string are checked here — liveness is decided by isTdxRootPath by the caller.
 */
async function readSavedChoice(dataDir) {
  let raw
  try {
    raw = await readFile(join(dataDir, SAVED_CHOICE_FILE), 'utf8')
  } catch {
    return null
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== 1) return null
  if (typeof value.root !== 'string' || value.root.trim() === '') return null
  return { version: 1, root: value.root }
}

/**
 * Resolve the effective TDX root plus a source label with the frozen priority
 * explicit env → explicit config → saved choice. An unconfigured or unavailable
 * saved directory leaves setup pending; the launcher never scans for a replacement.
 * The label is display/contract metadata only (TRAINER_TDX_SOURCE); it never
 * carries the path itself. config.tdxRoot already folds env + config file
 * together (env wins), so `envSet` distinguishes the top two tiers.
 */
async function resolveTdxWithSource({ config, dataDir, env }) {
  const envSet = typeof env.TDX_ROOT === 'string' && env.TDX_ROOT.trim() !== ''
  if (config.tdxRoot) {
    if (!(await isTdxRootPath(config.tdxRoot))) return { error: config.tdxRoot }
    return { root: config.tdxRoot, source: envSet ? 'env' : 'explicit-config' }
  }
  const saved = await readSavedChoice(dataDir)
  if (saved && await isTdxRootPath(saved.root)) {
    return { root: resolve(saved.root), source: 'saved-choice' }
  }
  return { root: null, source: null }
}

/** Validate the fixed release layout; never builds anything. */
async function inspectPackage(root) {
  let release
  try {
    release = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'))
  } catch (error) {
    throw new Error(`缺少有效的 release.json / not a trainer package, missing valid release.json in ${root} (${error && error.message})`)
  }
  if (!release || release.appId !== APP_ID) {
    throw new Error(`release.json appId 应为 "${APP_ID}" / unexpected release.json appId: ${JSON.stringify(release && release.appId)}`)
  }
  const nodePath = join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  const serverScript = join(root, 'server', 'dist', 'index.js')
  const webDir = join(root, 'web', 'dist')
  const missing = []
  for (const [label, path] of [['runtime node', nodePath], ['server/dist/index.js', serverScript], ['web/dist', webDir]]) {
    if (!(await pathExists(path))) missing.push(label)
  }
  if (missing.length) {
    throw new Error(`安装不完整，缺少 ${missing.join('、')} / incomplete package, missing ${missing.join(', ')}; re-extract the full package: ${root}`)
  }
  return {
    release,
    nodePath,
    serverScript,
    webDir,
    version: typeof release.version === 'string' ? release.version : 'unknown',
    gitCommit: typeof release.gitCommit === 'string' ? release.gitCommit : 'unknown',
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error && error.code === 'EPERM')
  }
}

function isTrainerHealth(value) {
  return Boolean(value && typeof value === 'object'
    && value.status === 'ok'
    && typeof value.runId === 'string'
    && Number.isInteger(value.pid))
}

/** True when a probe carries this state's own health identity over HTTP 200. */
function probeMatchesState(probe, state) {
  return Boolean(probe && probe.responded && probe.status === 200 && isTrainerHealth(probe.json)
    && probe.json.runId === state.runId && probe.json.pid === state.pid)
}

/**
 * One /api/health probe against 127.0.0.1 only (port is a validated integer).
 * `refused` marks a definitively free port; everything else is either a
 * response or an unknown listener. redirect:'error' so a foreign loopback
 * listener cannot move the identity check to another host by answering with
 * a redirect; the body only counts as identity on HTTP 200.
 */
async function probeHealth(port, { timeoutMs = 1_200 } = {}) {
  const url = `http://127.0.0.1:${port}/api/health`
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    let json = null
    if (response.status === 200) {
      try { json = await response.json() } catch { json = null }
    }
    return { responded: true, refused: false, status: response.status, json }
  } catch (error) {
    const cause = error && error.cause && error.cause.code
    return { responded: false, refused: cause === 'ECONNREFUSED', reason: `${(error && error.message) || error}${cause ? ` (${cause})` : ''}` }
  }
}

/** Confirm the recorded state still identifies the live healthy server. */
async function confirmOwnedServer(state, { attempts = 3, timeoutMs = 1_200 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (probeMatchesState(await probeHealth(state.port, { timeoutMs }), state)) return true
    if (attempt + 1 < attempts) await delay(250)
  }
  return false
}

// ===== PORT-01 端口可用性与自动回退（2026-09-30 用户拍板"自动换可用端口"） =====
//
// 根因实证：默认端口 8787 可落进 Windows WinNAT 的排除端口段（本机实测 8711-8810，
// 逐次开机漂移），bind 直接 EACCES，服务进程启动即退；HTTP 探针只能看到"无监听"，
// 旧逻辑误判端口空闲后把失败留到服务侧，报错只剩"服务进程在启动期间退出"。
// 因此端口可用性一律以 bind 探测为准：
//   - 显式配置端口：必须尊重，bind 失败按错误码给出明确中文原因（系统保留段/
//     被占用）＋netsh 排查指引＋改端口方法，不自动换端口；
//   - 未配置端口（默认 8787）：bind 失败时自动改用邻近可用端口，控制台与页面
//     常驻提示实际端口，保持零配置一键启动。换端口不改数据库与数据目录。

const PORT_FALLBACK_ATTEMPTS = 40

/**
 * 真实 bind 探测：在 127.0.0.1 上试监听后立即释放。成功=端口可 bind；
 * 失败返回错误码（Windows 排除端口段为 EACCES，已有监听者为 EADDRINUSE）。
 * 这是唯一能发现"系统保留段"的手段——保留段没有监听者，HTTP 探针只会看到拒绝连接。
 */
function bindCheckPort(port) {
  return new Promise(resolveCheck => {
    const probe = net.createServer()
    const settle = result => {
      probe.removeAllListeners('listening')
      probe.removeAllListeners('error')
      resolveCheck(result)
    }
    probe.once('error', error => settle({ ok: false, code: (error && error.code) || 'EUNKNOWN' }))
    probe.once('listening', () => {
      probe.close(() => settle({ ok: true }))
    })
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * 未配置端口不可用时，从 preferred+1 起向上找第一个可 bind 的端口。
 * bind 探测本身排除了任何监听者（含无状态文件的训练器进程），不存在"换到一个
 * 已被占用的端口"的窗口；找不到时返回 null，由调用方如实报错。
 */
async function findFallbackPort(preferred, { probe = bindCheckPort, attempts = PORT_FALLBACK_ATTEMPTS } = {}) {
  for (let offset = 1; offset <= attempts; offset += 1) {
    const candidate = preferred + offset
    if (candidate > 65535) return null
    const state = await probe(candidate)
    if (state.ok) return candidate
  }
  return null
}

/** bind 失败的明确中文原因（显式端口专用）：区分系统保留段与被占用，附排查与改法。 */
function portUnavailableMessage(port, code) {
  const reserved = code === 'EACCES'
  const cause = reserved
    ? `端口 ${port} 被系统保留，无法监听（Windows WinNAT 排除端口段会覆盖常见默认端口，且每次开机会漂移）`
      + ` / port ${port} is reserved by the system (a Windows excluded port range covers it; ranges drift across reboots)`
    : `端口 ${port} 已被其他程序占用，无法监听 / port ${port} is occupied by another program`
  return `${cause}。`
    + `排查：在命令提示符运行 netsh int ipv4 show excludedportrange 查看系统保留段（被占用时用 netstat -ano | findstr :${port} 找进程）。`
    + `如需固定端口，请编辑 trainer.config.json 的 port 字段后重新 Start.cmd（改端口前先 Stop.cmd）。`
    + ` / check "netsh int ipv4 show excludedportrange" for reserved ranges (netstat -ano | findstr :${port} for occupants); `
    + `to pin a port, set "port" in trainer.config.json and restart via Stop.cmd + Start.cmd`
}

/** 控制台/结果里的自动换端口一句话说明（未配置端口回退时）。 */
function portFallbackNote(fallback) {
  if (!fallback) return null
  const cause = fallback.reason === 'reserved' ? '被系统保留' : '被其他程序占用'
  return `默认端口 ${fallback.from} ${cause}，本次自动改用可用端口 ${fallback.to}（数据库与训练数据不受影响；`
    + `浏览器历史录像按访问地址存放，端口变化后需回到原地址查看；如需固定端口，可在 trainer.config.json 设置 port）`
    + ` / default port ${fallback.from} is ${fallback.reason === 'reserved' ? 'reserved by the system' : 'occupied'}; `
    + `automatically using port ${fallback.to} instead (database unaffected; browser recordings live per-origin — `
    + `pin "port" in trainer.config.json to keep one address)`
}

// ===== PORT-02 训练器启动/关闭进程治理（用户 2026-10-06 指令） =====
//
// 用户拍板取代两条旧语义：
//  1) Start：目标端口的占用者经 isTrainerHealth 验证为训练器时，不再一律拒绝启动，
//     改为弹框询问"是否从已有进程启动训练器？"——确认＝打开已有服务（不新开进程，
//     无双写风险）；不同意＝清理该进程后从新进程启动。非训练器占用不进入此分支，
//     维持 PORT-01 语义（显式端口报因 / 默认端口自动回退）。
//  2) Stop：不再判断训练器进程是否从当前安装包启动，直接关闭全部经验证的训练器
//     进程（state 记录者＋系统扫描发现的孤儿）；身份验证不过的不明进程依旧不杀。
//
// 分层：库层 launch() 在"训练器占用且未提供应答"时抛 TRAINER_CONFLICT_ASK 决策请求
// 错误（携带占用者身份）；main()（CLI 边界）捕获后弹框/控制台取得应答，带
// conflictAnswer 重入。这样自动化调用（测试/脚本）永不阻塞在 GUI 上。

const CONFLICT_ASK_CODE = 'TRAINER_CONFLICT_ASK'

function conflictAskError(occupant) {
  const error = new Error(
    `端口 ${occupant.port} 上有训练器服务（PID ${occupant.pid}）但没有对应的启动状态，可能来自旧版本或手动启动；`
    + `需要用户决定：从已有进程打开，还是清理后重新启动（CLI 层会弹框询问）`
    + ` / port ${occupant.port} is served by a trainer process without launcher state (PID ${occupant.pid}); `
    + `a user decision (reuse or clean-and-restart) is required before launch can proceed`)
  error.code = CONFLICT_ASK_CODE
  error.occupant = occupant
  return error
}

/** 真实 PowerShell 运行器：args 为完整参数数组（不含 powershell.exe 本身）。 */
function defaultPowershellRunner(args) {
  return new Promise(resolveRun => {
    let child
    try {
      child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolveRun({ ok: false, code: null, stdout: '', error: `${(error && error.message) || error}` })
      return
    }
    let stdout = ''
    let settled = false
    child.stdout.on('data', chunk => { stdout += chunk })
    child.once('error', error => {
      if (settled) return
      settled = true
      resolveRun({ ok: false, code: null, stdout: '', error: `${(error && error.message) || error}` })
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      resolveRun({ ok: code === 0, code, stdout })
    })
  })
}

/** PowerShell 命令运行（发现/端口列举用，-Command 形态）。 */
function runPowerShellCommand(command) {
  return defaultPowershellRunner(['-NoProfile', '-NonInteractive', '-Command', command])
}

/** 询问用 MessageBox 脚本：中文经 .ps1 文件（UTF-8 BOM）传递，规避命令行内联编码坑。 */
function conflictAskScript(occupant) {
  return [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$answer = [System.Windows.Forms.MessageBox]::Show(',
    `  "检测到端口 ${occupant.port} 上已有训练器服务（PID ${occupant.pid}）。是否从已有进程启动训练器？\\n\\n[是] = 复用已有服务（不新开进程）\\n[否] = 关闭该训练器后重新启动",`,
    '  "K线训练器启动",',
    '  [System.Windows.Forms.MessageBoxButtons]::YesNo,',
    '  [System.Windows.Forms.MessageBoxIcon]::Question)',
    'Write-Output ([int]$answer)',
    '',
  ].join('\n')
}

function conflictAskMessage(occupant) {
  return `检测到端口 ${occupant.port} 上已有训练器服务（PID ${occupant.pid}）。是否从已有进程启动训练器？`
    + `（是/y＝复用已有服务不新开进程；否/n＝关闭该训练器后重新启动）`
}

/** 控制台回退询问（PowerShell 不可用时）。读不到答案返回 null，绝不替用户猜。 */
async function consoleAskDefault(message) {
  const readline = require('node:readline/promises')
  const session = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = String(await session.question(`${message} [y/n]: `)).trim().toLowerCase()
    if (answer === 'y' || answer === 'yes' || answer === '是') return 'reuse'
    if (answer === 'n' || answer === 'no' || answer === '否') return 'restart'
    return null
  } catch {
    return null
  } finally {
    session.close()
  }
}

/**
 * PORT-02 冲突询问：优先 PowerShell MessageBox（Yes=6→reuse / No=7→restart），
 * 不可用或返回垃圾时回退控制台输入；两通道都拿不到答案则抛错中止启动（不杀、
 * 不启新进程）。powershellRunner/consoleAsk 均可注入（自动化测试不依赖真实 GUI）。
 */
async function askConflictReuseOrRestart(occupant, options = {}) {
  const powershellRunner = options.powershellRunner ?? defaultPowershellRunner
  const consoleAsk = options.consoleAsk ?? consoleAskDefault
  const directory = await mkdtemp(join(tmpdir(), 'trainer-ask-'))
  const scriptPath = join(directory, 'ask.ps1')
  try {
    await writeFile(scriptPath, `\uFEFF${conflictAskScript(occupant)}`, 'utf8')
    const result = await powershellRunner(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath])
    if (result && result.ok) {
      const answer = String(result.stdout ?? '').trim()
      if (answer === '6') return 'reuse'
      if (answer === '7') return 'restart'
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
  const fallback = await consoleAsk(conflictAskMessage(occupant))
  if (fallback === 'reuse' || fallback === 'restart') return fallback
  throw new Error(
    `无法获得用户选择（PowerShell 对话框与控制台输入均不可用），已中止启动；未关闭任何进程，也未启动新服务 `
    + `/ could not obtain an answer to the reuse-or-restart question (dialog and console both unavailable); `
    + `start aborted without killing or starting anything`)
}

/**
 * PORT-02 停止扫描的候选口径：命令行含 launcher.cjs，或以 server\dist\index.js
 * （含正斜杠变体）作为完整参数出现。发布包解压目录名不含仓库名，不能按目录名匹配。
 */
function isTrainerCandidateCommandLine(commandLine) {
  if (typeof commandLine !== 'string' || commandLine.trim() === '') return false
  const normalized = commandLine.replace(/["']/g, ' ')
  if (/(?:^|\s)[^\s]*launcher\.cjs(?=\s|$)/i.test(normalized)) return true
  return /(?:^|\s)[^\s]*server[\\/]dist[\\/]index\.js(?=\s|$)/i.test(normalized)
}

/** 枚举系统 node.exe 进程（Get-CimInstance）。PowerShell 不可用时如实报告 available=false。 */
async function enumerateNodeProcessesPS() {
  const command = `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`
    + ` | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`
  const result = await runPowerShellCommand(command)
  if (!result.ok) return { available: false, reason: result.error ?? `powershell exit ${result.code}` }
  try {
    const text = result.stdout.trim()
    const parsed = text === '' ? null : JSON.parse(text)
    const list = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
    const processes = list
      .filter(entry => entry && typeof entry === 'object' && Number.isInteger(entry.ProcessId))
      .map(entry => ({ pid: entry.ProcessId, commandLine: typeof entry.CommandLine === 'string' ? entry.CommandLine : '' }))
    return { available: true, processes }
  } catch (error) {
    return { available: false, reason: `parse failed: ${(error && error.message) || error}` }
  }
}

/** 某 PID 的监听端口列表（Get-NetTCPConnection，只读）。失败/无监听返回 []。 */
async function listListenPortsPS(pid) {
  const command = `Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue`
    + ` | Select-Object -ExpandProperty LocalPort | ConvertTo-Json -Compress`
  const result = await runPowerShellCommand(command)
  if (!result.ok) return []
  const text = result.stdout.trim()
  if (text === '') return []
  try {
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return [...new Set(list.map(Number).filter(port => Number.isInteger(port) && port > 0))]
  } catch {
    return []
  }
}

/** 有界等待进程退出；pidAliveImpl 可注入（测试模拟杀不死的进程）。 */
async function waitPidExit(pid, timeoutMs, pidAliveImpl = pidAlive) {
  const deadline = Date.now() + timeoutMs
  while (pidAliveImpl(pid)) {
    if (Date.now() >= deadline) return false
    await delay(100)
  }
  return true
}

/** 有界等待端口重新拒绝连接（释放）。 */
async function waitPortRefused(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await probeHealth(port, { timeoutMs: 500 })).refused) return true
    await delay(100)
  }
  return false
}

/**
 * 结束一个已通过身份验证的训练器进程并确认退出/端口释放。结果如实呈现：
 * signaled/exited/portDrained 分别报告，不假报成功。
 */
async function killVerifiedTrainer(pid, port, options = {}) {
  const entry = {
    pid,
    port,
    runId: typeof options.runId === 'string' ? options.runId : undefined,
    signaled: true,
    exited: false,
    portDrained: false,
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    entry.signaled = false
    entry.error = `${(error && error.message) || error}`
    return entry
  }
  entry.exited = await waitPidExit(pid, options.exitTimeoutMs ?? STOP_EXIT_TIMEOUT_MS, options.pidAliveImpl)
  entry.portDrained = entry.exited
    ? await waitPortRefused(port, options.portDrainTimeoutMs ?? 3_000)
    : false
  return entry
}

/**
 * PORT-02 全量清剿：枚举候选（注入枚举器或真实 PowerShell）→ 逐个按其监听端口做
 * isTrainerHealth＋pid 一致验证 → 验证通过才杀。不明候选进 spared 报告且不发信号。
 * excludePids 用于跳过已被记录路径处理的 PID；自身进程永不匹配。
 */
async function sweepTrainers(options = {}) {
  const kills = []
  const spared = []
  const excludePids = options.excludePids instanceof Set ? options.excludePids : new Set(options.excludePids ?? [])
  let listing
  try {
    listing = options.processEnumerator ? await options.processEnumerator() : await enumerateNodeProcessesPS()
  } catch (error) {
    return { kills, spared, available: false, reason: `enumeration threw: ${(error && error.message) || error}` }
  }
  if (!listing || listing.available !== true) {
    return { kills, spared, available: false, reason: (listing && listing.reason) || 'enumerator returned no listing' }
  }
  const candidates = (Array.isArray(listing.processes) ? listing.processes : []).filter(entry =>
    entry && Number.isInteger(entry.pid) && entry.pid > 0
    && entry.pid !== process.pid
    && !excludePids.has(entry.pid)
    && isTrainerCandidateCommandLine(entry.commandLine))
  for (const candidate of candidates) {
    let ports = []
    try {
      const listed = options.portLister ? await options.portLister(candidate.pid) : await listListenPortsPS(candidate.pid)
      ports = [...new Set((Array.isArray(listed) ? listed : [listed])
        .map(Number)
        .filter(port => Number.isInteger(port) && port > 0 && port < 65536))]
    } catch { ports = [] }
    if (!ports.length) {
      spared.push({ pid: candidate.pid, reason: 'no-listening-port' })
      continue
    }
    let verified = null
    for (const port of ports) {
      const probe = await probeHealth(port, { timeoutMs: 1_200 })
      if (probe.responded && probe.status === 200 && isTrainerHealth(probe.json)
        && probe.json.pid === candidate.pid) {
        verified = { port, runId: probe.json.runId }
        break
      }
    }
    if (!verified) {
      spared.push({ pid: candidate.pid, reason: 'health-unverified' })
      continue
    }
    kills.push(await killVerifiedTrainer(candidate.pid, verified.port, {
      runId: verified.runId,
      exitTimeoutMs: options.exitTimeoutMs,
      portDrainTimeoutMs: options.portDrainTimeoutMs,
      pidAliveImpl: options.pidAliveImpl,
    }))
  }
  return { kills, spared, available: true }
}

function statePath(dataDir) { return join(dataDir, STATE_FILE) }
function lockPath(dataDir) { return join(dataDir, LOCK_FILE) }

function assertStateIdentity(value) {
  if (!value || typeof value !== 'object') throw new Error('state is not an object')
  if (typeof value.runId !== 'string' || !/^run-[0-9a-f-]{36}$/.test(value.runId)) throw new Error('state runId is invalid')
  if (!Number.isInteger(value.pid) || value.pid < 1) throw new Error('state pid is invalid')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('state port is invalid')
  if (value.baseURL !== `http://127.0.0.1:${value.port}`) throw new Error('state baseURL does not match the port')
  return value
}

/**
 * Read our own server record. Returns null when absent, {state} when valid,
 * {stale, pid?} for ours-but-broken content (pid is the best-effort recorded
 * value, used to refuse replacing a possibly-live owner), and throws for a
 * file claiming a different appId so foreign data is never cleared.
 */
async function readOwnedState(dataDir) {
  let raw
  try {
    raw = await readFile(statePath(dataDir), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`无法读取服务状态 / cannot read server state ${statePath(dataDir)}: ${error && error.message}`)
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return { stale: 'state file is not valid JSON' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { stale: 'state file is not an object' }
  if (value.appId !== APP_ID) {
    throw new Error(`服务状态属于其他应用 (${JSON.stringify(value.appId)})，拒绝处理 / state file belongs to another app: ${statePath(dataDir)}`)
  }
  try {
    return { state: assertStateIdentity(value) }
  } catch (error) {
    return { stale: error.message, pid: Number.isInteger(value.pid) && value.pid >= 1 ? value.pid : null }
  }
}

async function writeStateFile(dataDir, state) {
  const path = statePath(dataDir)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

async function clearState(dataDir) {
  await rm(statePath(dataDir), { force: true })
}

function unverifiableOwnerMessage(state) {
  return `已记录的训练服务进程仍在运行（PID ${state.pid}，端口 ${state.port}），但通过 127.0.0.1:${state.port}/api/health 无法确认它属于这条记录（runId/PID 不匹配或健康端点不可达）；`
    + `为避免两个服务写同一个数据库，启动器不会清除该记录，也不会再启动新服务。请先确认并结束该进程（任务管理器中的 PID ${state.pid}）后重试 / `
    + `a recorded trainer process is still alive (PID ${state.pid}, port ${state.port}) but does not answer as this record on 127.0.0.1:${state.port}/api/health `
    + `(runId/PID mismatch or health unreachable); to avoid two writers on one database the launcher will not erase the record or start a second server — `
    + `end that process first (verify PID ${state.pid} in Task Manager), then retry`
}

/**
 * Decide what launch may do with a recorded state: 'reuse' (verified live
 * owner), 'clean' (recorded PID provably dead, or stale content with no live
 * recorded PID), or throw for a live owner that cannot be verified. Never
 * clears a state whose recorded PID is still alive: an unverified live owner
 * may be writing the same database, so replacing it could start a second
 * writer. Callers must run this under the launch lock: a concurrent stop
 * (which takes the same lock to verify and signal) must never be observable
 * mid-kill as "recorded PID alive but health already gone".
 */
async function decideRecordedServer(dataDir) {
  const existing = await readOwnedState(dataDir)
  if (!existing) return { action: 'absent' }
  if (existing.state) {
    if (!pidAlive(existing.state.pid)) return { action: 'clean', state: existing.state }
    if (await confirmOwnedServer(existing.state)) return { action: 'reuse', state: existing.state }
    throw new Error(unverifiableOwnerMessage(existing.state))
  }
  if (existing.pid && pidAlive(existing.pid)) {
    throw new Error(`训练状态文件无法识别（${existing.stale}），但其中记录的进程（PID ${existing.pid}）仍在运行；`
      + `启动器不会覆盖可能仍在运行的服务。请确认后结束该进程，或确认它不是训练器后手动删除状态文件 / `
      + `the state file is unreadable (${existing.stale}) but its recorded process (PID ${existing.pid}) is still alive; `
      + `the launcher will not replace a possibly-live owner — end that process, or delete the state file manually after making sure it is not a trainer`)
  }
  return { action: 'clean' }
}

async function readLockInfo(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Create the launch lock ('wx' exclusive). On an existing lock: recover it
 * after verifying the recorded PID is dead; report it otherwise. Never
 * touches a lock held by a live process.
 */
async function acquireLaunchLock(dataDir) {
  const path = lockPath(dataDir)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = await open(path, 'wx')
      const info = { appId: APP_ID, pid: process.pid, startedAt: new Date().toISOString() }
      await handle.writeFile(`${JSON.stringify(info, null, 2)}\n`)
      await handle.close()
      return { path, owned: true, info }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw new Error(`无法创建启动锁 / cannot create launch lock ${path}: ${error && error.message}`)
      }
      const existing = await readLockInfo(path)
      if (existing && existing.appId === APP_ID && Number.isInteger(existing.pid) && existing.pid >= 1) {
        if (!pidAlive(existing.pid)) {
          await rm(path, { force: true })
          continue
        }
        return { path, owned: false, info: existing }
      }
      return { path, owned: false, info: null }
    }
  }
  throw new Error(`启动锁反复被占用 / launch lock at ${path} kept reappearing`)
}

/**
 * Best-effort browser open; resolves false when the opener is missing or
 * fails. Never throws: a missing browser must not crash the launcher after
 * the server is already up. Argument array only, no shell user input.
 * `spawnImpl` exists so tests can inject a failing opener.
 */
function openURL(url, spawnImpl = spawn) {
  return new Promise(resolveOpened => {
    let settled = false
    const finish = opened => {
      if (settled) return
      settled = true
      resolveOpened(opened)
    }
    let child
    try {
      if (process.platform === 'win32') {
        // Argument array, no shell string: safe for spaces, Chinese and "&" paths.
        child = spawnImpl('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      } else if (process.platform === 'darwin') {
        child = spawnImpl('open', [url], { detached: true, stdio: 'ignore' })
      } else {
        child = spawnImpl('xdg-open', [url], { detached: true, stdio: 'ignore' })
      }
    } catch {
      finish(false)
      return
    }
    // Without this listener a spawn 'error' (e.g. ENOENT) escapes as an
    // uncaught exception and kills the launcher.
    child.once('error', () => finish(false))
    if (typeof child.unref === 'function') child.unref()
    delay(500).then(() => finish(true))
  })
}

/** Stop a child this launcher spawned; never signals unknown processes. */
async function stopOwnedChild(child) {
  if (!child || !child.pid) return
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  } catch { /* already gone */ }
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  if (child.exitCode === null && child.signalCode === null) await Promise.race([exited, delay(3_000)])
}

async function waitForReady({ child, readyFile, runId, port, timeoutMs, logPath }) {
  const deadline = Date.now() + timeoutMs
  const expectedURL = `http://127.0.0.1:${port}`
  let spawnFailure = null
  child.once('error', error => { spawnFailure = error })
  let lastTransient = null
  while (Date.now() < deadline) {
    if (spawnFailure) throw new Error(`无法启动服务进程 / failed to start server process: ${spawnFailure.message}`)
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`服务进程在启动期间退出（code ${child.exitCode ?? child.signalCode}），日志 / server exited during startup, log: ${logPath}`)
    }
    let ready
    try {
      ready = JSON.parse(await readFile(readyFile, 'utf8'))
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await delay(120)
        continue
      }
      throw new Error(`ready 文件损坏 / readiness file is not valid JSON: ${readyFile}`)
    }
    if (!ready || typeof ready !== 'object'
      || ready.runId !== runId || ready.pid !== child.pid
      || ready.port !== port || ready.baseURL !== expectedURL) {
      throw new Error(`ready 身份不匹配 / readiness identity does not match the launched server: ${JSON.stringify(ready)}`)
    }
    const probe = await probeHealth(port, { timeoutMs: 1_000 })
    if (probeMatchesState(probe, { runId, pid: child.pid })) {
      return { baseURL: expectedURL }
    }
    if (probe.responded) {
      throw new Error(`健康检查身份不匹配 / health identity does not match the launched server on ${expectedURL}`)
    }
    lastTransient = probe.reason
    await delay(120)
  }
  await stopOwnedChild(child)
  await rm(readyFile, { force: true }).catch(() => {})
  throw new Error(`启动超时（${Math.round(timeoutMs / 1000)} 秒）未就绪，日志 / readiness timed out, log: ${logPath}${lastTransient ? `; last probe: ${lastTransient}` : ''}`)
}

async function reuseResult(state, { dataDir, tdxRoot, openBrowser: shouldOpen }) {
  let openedBrowser = false
  if (shouldOpen) openedBrowser = await openURL(state.baseURL)
  return {
    reused: true,
    url: state.baseURL,
    port: state.port,
    pid: state.pid,
    runId: state.runId,
    dataDir,
    logPath: join(dataDir, SERVER_LOG),
    tdxRoot,
    openedBrowser,
    portFallback: state.portFallback && Number.isInteger(state.portFallback.from) && state.portFallback.from !== state.port
      ? { ...state.portFallback, to: state.port }
      : null,
  }
}

/**
 * 显式端口下复用必须核对端口一致（用户指定了端口，静默换用会造成两个写库者或
 * 打开错误的页面）。PORT-01：未配置端口时豁免——上一次启动可能因默认端口被系统
 * 保留而自动落在邻近端口，复用我们自己记录的健康服务正是避免第二个写库者，
 * 不能再因"端口≠默认值"拒绝零配置的第二次 Start.cmd。
 */
function assertPortMatchesRunning(state, config) {
  if (config.portExplicit && state.port !== config.port) {
    throw new Error(`之前的训练服务仍运行在端口 ${state.port}（PID ${state.pid}），而配置要求端口 ${config.port}；`
      + `为避免两个服务写同一个数据库，请先运行 Stop.cmd 停止旧服务或将端口改回 ${state.port} / `
      + `a previous trainer still runs on port ${state.port} (PID ${state.pid}) while the config asks for ${config.port}; `
      + `run Stop.cmd first, or set the port back, to avoid two writers on one database`)
  }
}

/**
 * A reused server must be the SAME release asking for the SAME database as
 * this launch; anything else would either mix releases or put two writers on
 * one database. Semantics: reuse means "the service recorded in this
 * dataDir, from this release, with this config" — not necessarily the same
 * copy of the package on disk. States written before these fields existed
 * (version/gitCommit/databasePath/tdxRoot absent) are tolerated: they carry
 * nothing comparable. tdxRoot only gates reuse, never stop.
 */
function assertReuseCompatible(state, { config, layout, tdxRoot }) {
  const problems = []
  if (typeof state.databasePath === 'string' && !samePath(state.databasePath, config.databasePath)) {
    problems.push(`databasePath ${state.databasePath} != ${config.databasePath}`)
  }
  if (typeof state.version === 'string' && state.version !== layout.version) {
    problems.push(`version ${state.version} != ${layout.version}`)
  }
  if (typeof state.gitCommit === 'string' && state.gitCommit !== layout.gitCommit) {
    problems.push(`gitCommit ${state.gitCommit} != ${layout.gitCommit}`)
  }
  if ((typeof state.tdxRoot === 'string' || state.tdxRoot === null)
    && !samePath(state.tdxRoot ?? '', tdxRoot ?? '')) {
    problems.push(`tdxRoot ${state.tdxRoot ?? '(none)'} != ${tdxRoot ?? '(none)'}`)
  }
  if (!problems.length) return
  throw new Error(`已记录的训练服务（端口 ${state.port}，PID ${state.pid}）与本次启动不一致（${problems.join('; ')}）；`
    + `为避免新旧版本混用或两个服务写同一个数据库，请先运行 Stop.cmd 停止旧服务再启动 / `
    + `the recorded trainer (port ${state.port}, PID ${state.pid}) does not match this launch (${problems.join('; ')}); `
    + `run Stop.cmd to stop it first — never mix releases or run two writers on one database`)
}

/**
 * Launch (or reuse) the trainer server. Returns a result summary; throws
 * actionable errors. Options: root, configPath, openBrowser, env,
 * startTimeoutMs, lockWaitMs.
 */
async function launch(options = {}) {
  const root = resolve(options.root ?? __dirname)
  const env = options.env ?? process.env
  const layout = await inspectPackage(root)
  const configPath = options.configPath ? resolve(options.configPath) : join(root, 'trainer.config.json')
  const config = resolveConfig(root, await readConfigFile(configPath), env)
  const dataDir = config.dataDir
  try {
    try {
      await mkdir(dataDir, { recursive: true })
      await mkdir(dirname(config.databasePath), { recursive: true })
    } catch (error) {
      throw new Error(`数据目录不可写 / data directory is not writable: ${dataDir} (${error && error.message})`)
    }

    // 仅使用用户确认过的来源（env → 显式配置 → 已保存选择），缺失时进入接入流程。
    // 来源标签只说明"这个目录是怎么来的"，随 TRAINER_TDX_SOURCE 下发；绝不回传路径。
    const resolved = await resolveTdxWithSource({
      config,
      dataDir,
      env,
    })
    if (resolved.error) {
      throw new Error(`配置的 tdxRoot 不是有效的通达信目录（需要 vipdoc\\<市场>\\lday 下有 .day 文件且存在 T0002\\hq_cache）：${resolved.error} / `
        + `configured tdxRoot does not look like a TDX installation: ${resolved.error}`)
    }
    const tdxRoot = resolved.root
    const tdxSource = resolved.source

    // Every reuse/cleanup decision runs under the same single-flight lock
    // stop() uses, so a concurrent stop can never be observed mid-kill.
    // Deciding outside the lock once read the state with a live PID and then
    // failed health confirmation after the stop's SIGKILL, rejecting a
    // legitimate stop as an "unverifiable owner" (and a pre-lock reuse could
    // hand back a server the stop was already killing). A bounded retry loop
    // re-evaluates state after waiting out a contender instead of recursing.
    for (let round = 0; ; round++) {
      if (round >= 4) {
        throw new Error('启动竞争多次发生，请稍后重试 / repeated launch contention on the same data directory; try again shortly')
      }

      // 1) Single-flight lock so two clicks cannot spawn two DB writers and
      //    launch cannot race a concurrent stop's verify-and-kill.
      const lock = await acquireLaunchLock(dataDir)
      if (!lock.owned) {
        if (!lock.info) {
          throw new Error(`存在无法识别的启动锁 ${lock.path}；确认没有其他训练器窗口后可手动删除该文件 / `
            + `unrecognized launch lock; delete the file manually if no other trainer window is open`)
        }
        const deadline = Date.now() + (options.lockWaitMs ?? LOCK_WAIT_MS)
        let released = false
        while (Date.now() < deadline) {
          if (!(await pathExists(lock.path))) {
            released = true
            break
          }
          await delay(150)
        }
        if (!released) {
          throw new Error(`另一个启动/停止进程仍在进行（PID ${lock.info.pid}）／ another launch or stop is in progress (PID ${lock.info.pid})`)
        }
        // The owner released its lock without leaving a reusable server
        // (its start failed, or it was a stop); loop around and decide
        // again under our own lock acquisition.
        await delay(150)
        continue
      }

      try {
        // 2) Under the lock: reuse only our own recorded server (state file
        //    + live PID + matching health identity), clean provably dead
        //    records, refuse live-but-unverifiable owners.
        const existing = await decideRecordedServer(dataDir)
        if (existing.action === 'reuse') {
          assertPortMatchesRunning(existing.state, config)
          assertReuseCompatible(existing.state, { config, layout, tdxRoot })
          return await reuseResult(existing.state, { dataDir, tdxRoot, openBrowser: options.openBrowser ?? true })
        }
        if (existing.action === 'clean') await clearState(dataDir)

        // 3) Port availability (PORT-01 + PORT-02): a VERIFIED trainer occupant is a
        //    user decision (PORT-02, 2026-10-06): reuse it (open its URL, no second
        //    process) or clean it and start fresh. Without an injected/recorded answer
        //    launch() throws a TRAINER_CONFLICT_ASK decision request — the CLI layer
        //    asks via dialog/console and re-enters with conflictAnswer. Non-trainer
        //    occupants never reach this branch and keep the PORT-01 semantics: the
        //    bind probe decides (explicit port must be honored with an actionable
        //    reason; the unconfigured default may move to a nearby free port).
        const occupancy = await probeHealth(config.port, { timeoutMs: 1_200 })
        if (occupancy.responded && isTrainerHealth(occupancy.json)
          && Number.isInteger(occupancy.json.pid) && occupancy.json.pid > 0) {
          const occupant = {
            pid: occupancy.json.pid,
            port: config.port,
            runId: occupancy.json.runId,
            baseURL: `http://127.0.0.1:${config.port}`,
          }
          const answer = options.conflictAnswer
          if (answer !== 'reuse' && answer !== 'restart') throw conflictAskError(occupant)
          if (answer === 'reuse') {
            // 应答期间占用者可能已退出：复核失败则落入下方正常启动流程
            const recheck = await probeHealth(config.port, { timeoutMs: 1_200 })
            if (recheck.responded && recheck.status === 200 && isTrainerHealth(recheck.json)) {
              // 确认＝从已有进程启动：打开已有服务 URL，不产生第二个服务进程（无双写风险）
              const urlOpener = options.urlOpener ?? openURL
              let openedBrowser = false
              if (options.openBrowser ?? true) openedBrowser = await urlOpener(occupant.baseURL)
              return {
                reused: true,
                reusedConflictTrainer: true,
                url: occupant.baseURL,
                port: occupant.port,
                pid: recheck.json.pid,
                runId: recheck.json.runId,
                dataDir,
                logPath: join(dataDir, SERVER_LOG),
                tdxRoot,
                openedBrowser,
                portFallback: null,
              }
            }
          } else {
            // 拒绝＝清理后重启：复核身份一致才杀，杀后等退出与端口释放，再正常启动
            const recheck = await probeHealth(config.port, { timeoutMs: 1_200 })
            if (recheck.responded && recheck.status === 200 && isTrainerHealth(recheck.json)
              && recheck.json.pid === occupant.pid) {
              const cleaned = await killVerifiedTrainer(occupant.pid, occupant.port, {
                runId: occupant.runId,
                exitTimeoutMs: options.conflictExitTimeoutMs ?? 5_000,
                portDrainTimeoutMs: options.conflictPortDrainTimeoutMs ?? 3_000,
              })
              if (!cleaned.signaled) {
                throw new Error(`无法结束端口 ${occupant.port} 上的训练器进程（PID ${occupant.pid}）：${cleaned.error ?? 'signal failed'}；已中止启动，未改动数据库 `
                  + `/ failed to signal the conflicting trainer on port ${occupant.port} (PID ${occupant.pid}); start aborted`)
              }
              if (!cleaned.exited) {
                throw new Error(`已向端口 ${occupant.port} 上的训练器进程（PID ${occupant.pid}）发送结束信号，但它未在限时内退出；已中止启动 `
                  + `/ signaled the conflicting trainer (PID ${occupant.pid}) but it did not exit in time; start aborted`)
              }
            }
            // 占用者已消失或身份变化：落入下方正常启动流程（bind 探测重新裁决）
          }
        }
        const checkPort = options.portProbe ?? bindCheckPort
        let effectivePort = config.port
        let portFallback = null
        const bindState = await checkPort(config.port)
        if (!bindState.ok) {
          if (config.portExplicit) {
            throw new Error(portUnavailableMessage(config.port, bindState.code))
          }
          const reason = bindState.code === 'EACCES' ? 'reserved' : 'occupied'
          const picked = await findFallbackPort(config.port, { probe: checkPort })
          if (picked === null) {
            throw new Error(`默认端口 ${config.port} 与其上方 ${PORT_FALLBACK_ATTEMPTS} 个邻近端口都不可用（系统保留或被占用），无法自动选择端口；`
              + `请在 trainer.config.json 显式设置一个可用 port 后重新启动 `
              + `/ the default port ${config.port} and ${PORT_FALLBACK_ATTEMPTS} ports above it are all unavailable; set an explicit "port" in trainer.config.json`)
          }
          effectivePort = picked
          portFallback = { from: config.port, to: picked, reason }
        }

        // 4) Start the detached server: no IPC, hidden window, logs in dataDir.
        const runId = `run-${randomUUID()}`
        const readyFile = join(dataDir, READY_FILE)
        const logPath = join(dataDir, SERVER_LOG)
        await rm(readyFile, { force: true })
        const log = await open(logPath, 'a')
        let child
        try {
          await log.write(`\n[${new Date().toISOString()}] launcher v${layout.version} (${layout.gitCommit}) `
            + `starting run ${runId} on port ${effectivePort} with database ${config.databasePath}`
            + (portFallback ? ` (auto-fallback from default port ${portFallback.from}, reason: ${portFallback.reason})` : '') + '\n')
          child = spawn(layout.nodePath, [layout.serverScript], {
            cwd: root,
            detached: true,
            windowsHide: true,
            stdio: ['ignore', log.fd, log.fd],
            env: {
              ...env,
              TRAINER_RUN_ID: runId,
              TRAINER_DB: config.databasePath,
              TRAINER_STATIC_DIR: layout.webDir,
              TRAINER_READY_FILE: readyFile,
              TDX_ROOT: tdxRoot ?? '',
              // SETUP-01：受控重启与保存生效所需的本机会话注入。
              // TRAINER_CONTROL_TOKEN 只经环境传给服务端与本机监管进程，
              // 不写入状态文件/日志/任何 HTTP 响应。
              TRAINER_CONTROL_TOKEN: env.TRAINER_CONTROL_TOKEN?.trim() || `ctr-${randomUUID()}`,
              TRAINER_DATA_DIR: dataDir,
              // V1.2.6：训练数据目录设置写回启动器配置所需；服务端据此判定"启动器托管运行"
              TRAINER_CONFIG_PATH: configPath,
              TRAINER_LAUNCHER_CJS: resolve(__filename),
              TRAINER_TDX_SOURCE: tdxSource ?? '',
              // PORT-01：自动换端口标记（页面常驻提示用）。空串＝未发生回退；
              // 只含端口号与原因枚举，不含任何本机路径。
              TRAINER_PORT_FALLBACK: portFallback ? `${portFallback.from},${portFallback.reason}` : '',
              HOST: '127.0.0.1',
              PORT: String(effectivePort),
              OPEN_BROWSER: '0',
            },
          })
          child.unref()
          try {
            const { baseURL } = await waitForReady({
              child, readyFile, runId, port: effectivePort,
              timeoutMs: options.startTimeoutMs ?? READY_TIMEOUT_MS, logPath,
            })
            const state = {
              appId: APP_ID,
              runId,
              pid: child.pid,
              port: effectivePort,
              baseURL,
              startedAt: new Date().toISOString(),
              version: layout.version,
              gitCommit: layout.gitCommit,
              databasePath: config.databasePath,
              tdxRoot: tdxRoot ?? null,
            }
            if (portFallback) state.portFallback = { ...portFallback }
            await writeStateFile(dataDir, state)
            let openedBrowser = false
            if (options.openBrowser ?? true) {
              try {
                openURL(baseURL)
                openedBrowser = true
              } catch { /* user can open the URL manually */ }
            }
            return {
              reused: false,
              url: baseURL,
              port: effectivePort,
              pid: child.pid,
              runId,
              dataDir,
              logPath,
              tdxRoot,
              openedBrowser,
              portFallback,
            }
          } catch (error) {
            // Startup failure: keep the log for diagnosis, stop only our own child.
            await stopOwnedChild(child)
            await rm(readyFile, { force: true }).catch(() => {})
            throw error
          }
        } finally {
          await log.close().catch(() => {})
        }
      } finally {
        if (lock.owned) await rm(lock.path, { force: true }).catch(() => {})
      }
    }
  } catch (error) {
    if (error && typeof error === 'object') error.dataDir = dataDir
    throw error
  }
}

/**
 * Stop the trainer. Same config resolution as launch, but targeting is always the
 * RECORDED port, so editing the config port cannot hide a running service.
 * Serialized with launch through the same launch lock. Identity is proven before
 * any signal (state appId/runId/pid plus a live HTTP 200 /api/health match on
 * 127.0.0.1); unknown or unverifiable processes are never killed.
 *
 * PORT-02（用户 2026-10-06）: with options.allTrainers === true (the --stop CLI
 * semantic) the recorded server is stopped first — keeping all of its refusal
 * protections — and then a system-wide sweep closes every OTHER trainer process
 * it can verify (node processes whose command line contains launcher.cjs or ends
 * with server\dist\index.js, state-less orphans included). Unverified candidates
 * are reported as spared and never signaled; unconfirmed kills are reported
 * honestly. Database, WAL sidecar files and logs are always kept.
 * Options: root, configPath, env, allTrainers, processEnumerator, portLister,
 * pidAliveImpl, lockWaitMs, exitTimeoutMs, portDrainTimeoutMs.
 */
async function stop(options = {}) {
  const root = resolve(options.root ?? __dirname)
  const env = options.env ?? process.env
  const configPath = options.configPath ? resolve(options.configPath) : join(root, 'trainer.config.json')
  const config = resolveConfig(root, await readConfigFile(configPath), env)
  const dataDir = config.dataDir
  const allTrainers = options.allTrainers === true
  try {
    // No dataDir means launch never got as far as creating one: nothing recorded
    // to stop — but the PORT-02 sweep still hunts state-less orphans, so create
    // the directory (the launch lock lives there) and proceed.
    if (!(await pathExists(dataDir))) {
      if (!allTrainers) return { stopped: false, noop: 'no-state', dataDir }
      await mkdir(dataDir, { recursive: true })
    }

    // Serialize against launch and other stops; bounded wait, then refuse.
    const lockDeadline = Date.now() + (options.lockWaitMs ?? LOCK_WAIT_MS)
    for (;;) {
      const lock = await acquireLaunchLock(dataDir)
      if (lock.owned) {
        try {
          if (allTrainers) return await stopRecordedAndSweep(dataDir, options)
          return await stopRecorded(dataDir, options)
        } finally {
          await rm(lock.path, { force: true }).catch(() => {})
        }
      }
      if (!lock.info) {
        throw new Error(`存在无法识别的启动锁 ${lock.path}；确认没有其他训练器窗口后可手动删除该文件 / `
          + `unrecognized launch lock; delete the file manually if no other trainer window is open`)
      }
      if (Date.now() >= lockDeadline) {
        throw new Error(`另一个启动/停止进程仍在进行（PID ${lock.info.pid}），停止操作已让位以免竞争 / `
          + `another launch or stop is in progress (PID ${lock.info.pid}); stop yielded to avoid racing it`)
      }
      await delay(150)
    }
  } catch (error) {
    if (error && typeof error === 'object') error.dataDir = error.dataDir ?? dataDir
    throw error
  }
}

/**
 * PORT-02 全量停止：先走原记录路径（保留其全部保护——stale/异主状态拒绝与文件保留、
 * 活跃但不可验证者拒绝、已死者清理不杀），再系统级清剿其他已验证训练器进程。
 */
async function stopRecordedAndSweep(dataDir, options) {
  const recorded = await stopRecorded(dataDir, options)
  const killedPids = new Set()
  if (recorded.stopped) killedPids.add(recorded.pid)
  const sweep = await sweepTrainers({ ...options, excludePids: killedPids })
  const kills = []
  if (recorded.stopped) {
    kills.push({
      pid: recorded.pid,
      port: recorded.port,
      runId: recorded.runId,
      signaled: true,
      exited: true,
      portDrained: recorded.portDrained === true,
      recorded: true,
    })
  }
  kills.push(...sweep.kills)
  return {
    ...recorded,
    kills,
    spared: sweep.spared,
    sweep: sweep.available === true
      ? { available: true }
      : { available: false, reason: sweep.reason ?? 'unknown' },
  }
}

/** Lock-held part of stop(): verify, signal the exact PID, confirm exit. */
async function stopRecorded(dataDir, options) {
  const existing = await readOwnedState(dataDir)
  if (!existing) return { stopped: false, noop: 'no-state', dataDir }
  if (existing.stale) {
    throw new Error(`训练状态文件无法识别（${existing.stale}），停止器拒绝猜测；文件已保留。确认没有训练器在运行后可手动删除 trainer-state.json / `
      + `the state file is unreadable (${existing.stale}); refusing to guess — the file is kept. Delete trainer-state.json manually after making sure no trainer is running`)
  }
  const state = existing.state
  if (!pidAlive(state.pid)) {
    // Dead own record: clean it without signaling anything.
    await clearState(dataDir)
    await rm(join(dataDir, READY_FILE), { force: true }).catch(() => {})
    return { stopped: false, noop: 'already-dead', cleanedStaleState: true, dataDir, pid: state.pid, port: state.port }
  }
  if (!(await confirmOwnedServer(state))) {
    throw new Error(unverifiableOwnerMessage(state))
  }
  try {
    process.kill(state.pid, 'SIGKILL')
  } catch (error) {
    throw new Error(`无法结束已通过身份核验的训练服务进程（PID ${state.pid}）：${error && error.message}；状态文件已保留 / `
      + `failed to signal the identity-verified trainer process (PID ${state.pid}): ${error && error.message}; the state file is kept`)
  }
  const exitDeadline = Date.now() + (options.exitTimeoutMs ?? STOP_EXIT_TIMEOUT_MS)
  while (pidAlive(state.pid)) {
    if (Date.now() >= exitDeadline) {
      throw new Error(`已向 PID ${state.pid} 发送结束信号但它未在限时内退出；状态文件已保留，数据库与日志未改动 / `
        + `signaled PID ${state.pid} but it did not exit within the time limit; the state file is kept and database/logs are untouched`)
    }
    await delay(100)
  }
  // 进程已死，但刚被结束的监听端口可能短暂滞留；等端口真正可拒绝后再报
  // 成功，这样紧随的 Start.cmd 不会撞上未释放的端口。超限也照常报告成功
  // （PID 已死是停止的契约），只是提示紧随启动可能需要重试。
  const drainDeadline = Date.now() + (options.portDrainTimeoutMs ?? 3_000)
  let drained = false
  while (Date.now() < drainDeadline) {
    if ((await probeHealth(state.port, { timeoutMs: 500 })).refused) {
      drained = true
      break
    }
    await delay(100)
  }
  await clearState(dataDir)
  await rm(join(dataDir, READY_FILE), { force: true }).catch(() => {})
  return {
    stopped: true,
    pid: state.pid,
    port: state.port,
    url: state.baseURL,
    runId: state.runId,
    dataDir,
    logPath: join(dataDir, SERVER_LOG),
    portDrained: drained,
  }
}

// ===== SETUP-01 受控重启（--setup-restart-attempt 监管模式） =====
//
// 服务端 /api/setup/save-choice 落盘后，/api/setup/apply 写出交接文件并拉起本模块
// 的 detached 监管进程。监管进程按 SETUP-RESTART-PLAN-01 冻结的纯函数状态机
// （server/dist/setup/restart-plan.js）逐步执行：preflight 身份双轨 → 保存核对 →
// 排空（受控 control/prepare）→ 旧服务退出（SIGTERM 一次，超时 SIGKILL 一次）→
// 拉起新服务（runId/端口/数据库/浏览器 origin 全部保留）→ 健康身份绑定确认 →
// ready；任何失败先恢复旧的选择文件再终态（restore-old-config）。
// 每一步先持久化状态再执行动作；交接文件与状态文件不含控制令牌。

/** 解析交接文件（attempt）。任何形状问题都给出可行动错误，不猜测。 */
async function readAttemptFile(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`无法读取重启交接文件 / cannot read restart attempt file ${path}: ${error && error.message}`)
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`重启交接文件不是有效 JSON / restart attempt file is not valid JSON: ${path}`)
  }
  const problems = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) problems.push('内容不是 JSON 对象')
  if (value && value.appId !== APP_ID) problems.push(`appId 应为 ${APP_ID}`)
  if (value && value.version !== 1) problems.push('version 应为 1')
  if (value && (typeof value.attemptId !== 'string' || !value.attemptId || value.attemptId.length > 128)) problems.push('attemptId 非法')
  for (const [label, fields] of [
    ['old', ['runId', 'pid', 'port', 'databasePath', 'origin', 'dataDir']],
    ['planned', ['dataDir', 'databasePath', 'port', 'origin', 'tdxRoot', 'source']],
    ['target', ['runId', 'port', 'origin']],
  ]) {
    const section = value ? value[label] : null
    if (!section || typeof section !== 'object') { problems.push(`${label} 缺失`); continue }
    for (const field of fields) {
      if (section[field] === undefined || section[field] === null || section[field] === '') problems.push(`${label}.${field} 缺失`)
    }
  }
  if (problems.length) {
    throw new Error(`重启交接文件字段不完整（${problems.join('；')}）；拒绝猜测，请重新在页面里执行"保存并生效" / restart attempt file is malformed (${problems.join('; ')}); redo the save-and-apply step in the app`)
  }
  return value
}

/** 加载冻结的重启状态机（打包布局保证 server/dist 存在；inspectPackage 已先校验）。 */
async function loadRestartPlan(root) {
  const planPath = join(root, 'server', 'dist', 'setup', 'restart-plan.js')
  try {
    return await import(pathToFileURL(planPath).href)
  } catch (error) {
    throw new Error(`无法加载受控重启状态机 / cannot load the restart state machine from ${planPath}: ${error && error.message}`)
  }
}

/** 状态文件原子写（先 wx 临时文件再 rename），内容供 /api/setup/restart-status 读取。 */
async function writeRestartStatus(dataDir, payload) {
  const path = join(dataDir, RESTART_STATUS_FILE)
  const body = { ...payload, updatedAt: new Date().toISOString() }
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

/**
 * 受控重启执行者。options: root, attemptPath, env, planModule?, probeHealthImpl?,
 * fetchImpl?, spawnImpl?, pidAliveImpl?, pollDelayMs?, lockWaitMs?。
 * 返回 { ready, phase, stage, reason }；所有失败都以终态状态文件收尾，不抛出
 * （监管进程 detached 无界面，结果只经状态文件与退出码呈现）。
 */
async function runSetupRestartAttempt(options = {}) {
  const root = resolve(options.root ?? __dirname)
  const env = options.env ?? process.env
  const pollDelayMs = options.pollDelayMs ?? SUPERVISOR_POLL_MS
  let layout
  try {
    layout = await inspectPackage(root)
  } catch (error) {
    await logSupervisorFailure(null, error)
    throw error
  }
  let attempt
  try {
    attempt = await readAttemptFile(resolve(options.attemptPath))
  } catch (error) {
    await logSupervisorFailure(null, error)
    throw error
  }
  const dataDir = attempt.old.dataDir
  const dataDirExists = await pathExists(dataDir)
  if (!dataDirExists) {
    const error = new Error(`交接文件里的数据目录不存在 / data directory from the attempt file does not exist: ${dataDir}`)
    await logSupervisorFailure(dataDir, error)
    throw error
  }
  const plan = options.planModule ?? await loadRestartPlan(root).catch(async error => {
    await writeStatusBestEffort(dataDir, attempt, {
      phase: 'new-start-failed', stage: 'restore-failed', reason: '受控重启状态机模块不可用；未改动任何服务', done: true,
    }).catch(() => {})
    await logSupervisorFailure(dataDir, error)
    throw error
  })
  const probeImpl = options.probeHealthImpl ?? probeHealth
  const fetchImpl = options.fetchImpl ?? fetch
  const spawnImpl = options.spawnImpl ?? spawn
  const pidAliveImpl = options.pidAliveImpl ?? pidAlive
  // 有限时限可整体注入（测试用短时限）；生产缺省用冻结默认值
  const timeouts = { ...RESTART_TIMEOUTS, ...(options.timeouts ?? {}) }

  // 与 launch/stop 共用同一单飞锁：重启全程不允许并行的启动/停止插入
  const lockDeadline = Date.now() + (options.lockWaitMs ?? LOCK_WAIT_MS)
  for (;;) {
    const lock = await acquireLaunchLock(dataDir)
    if (lock.owned) {
      try {
        return await superviseLocked({
          root, env, layout, attempt, dataDir, plan,
          probeImpl, fetchImpl, spawnImpl, pidAliveImpl, pollDelayMs, timeouts,
          attemptPath: resolve(options.attemptPath),
        })
      } finally {
        await rm(lock.path, { force: true }).catch(() => {})
      }
    }
    if (!lock.info) {
      const error = new Error(`存在无法识别的启动锁 ${lock.path}；重启已放弃 / unrecognized launch lock; restart aborted`)
      await logSupervisorFailure(dataDir, error)
      throw error
    }
    if (Date.now() >= lockDeadline) {
      const error = new Error(`另一个启动/停止进程仍在进行（PID ${lock.info.pid}），重启已让位 / another launch or stop is in progress; restart yielded`)
      await logSupervisorFailure(dataDir, error)
      throw error
    }
    await delay(150)
  }
}

async function logSupervisorFailure(dataDir, error) {
  if (!dataDir) return
  await appendFile(join(dataDir, LAUNCHER_LOG), `[${new Date().toISOString()}] setup-restart: ${error instanceof Error ? error.message : String(error)}\n`).catch(() => {})
}

async function writeStatusBestEffort(dataDir, attempt, payload) {
  try {
    await writeRestartStatus(dataDir, {
      version: 1, appId: APP_ID, attemptId: attempt.attemptId, ...payload,
    })
  } catch { /* 状态文件写失败不改变既定的终态语义 */ }
}

/** 持锁后的监督主循环：观测 → planRestartStep → 持久化 → 执行动作。 */
async function superviseLocked(context) {
  const { root, env, layout, attempt, dataDir, plan, probeImpl, fetchImpl, spawnImpl, pidAliveImpl, pollDelayMs, timeouts, attemptPath } = context
  const token = typeof env.TRAINER_CONTROL_TOKEN === 'string' ? env.TRAINER_CONTROL_TOKEN : ''
  const oldOrigin = attempt.old.origin

  let state = plan.initialRestartState()
  let pendingSave = null            // null=pending；{ok:true}|{ok:false,detail}
  let prepareRequested = false
  let drainOutcome = null           // null=pending；{kind:'success'|'timeout'|'failure'|'unknown',detail?}
  let shutdownRequested = false
  let sigtermSent = false
  let sigkillSent = false
  let spawnCall = null              // {ok:true,runId,pid}|{ok:false,detail}
  let child = null
  let pendingRestore = null

  const fetchJson = async (url, init, timeoutMs = 1_500) => {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      let json = null
      if (response.status >= 200 && response.status < 500) {
        try { json = await response.json() } catch { json = null }
      }
      return { responded: true, status: response.status, json }
    } catch (error) {
      return { responded: false, reason: `${(error && error.message) || error}` }
    }
  }
  const controlPost = (endpoint, timeoutMs) => fetchJson(`${oldOrigin}/api/setup/control/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-control-token': token },
    body: JSON.stringify({ runId: attempt.old.runId, attemptId: attempt.attemptId }),
  }, timeoutMs)

  const observeOldIdentity = async () => {
    const probe = await probeImpl(attempt.old.port)
    if (probeMatchesState(probe, { runId: attempt.old.runId, pid: attempt.old.pid })) {
      return {
        runId: attempt.old.runId,
        pid: attempt.old.pid,
        port: attempt.old.port,
        databasePath: attempt.old.databasePath,
        origin: attempt.old.origin,
      }
    }
    return null
  }
  const observeActiveTraining = async () => {
    const result = await fetchJson(`${oldOrigin}/api/trainings/active`, { method: 'GET' })
    const training = result.responded && result.json && typeof result.json === 'object' ? result.json.training : null
    return training && Number.isInteger(training.id) ? training.id : null
  }
  const observeOldExit = () => (pidAliveImpl(attempt.old.pid) ? { kind: 'alive' } : { kind: 'exited' })
  const observeSpawn = () => {
    if (!spawnCall) return { kind: 'pending' }
    return spawnCall.ok
      ? { kind: 'success', runId: spawnCall.runId, pid: spawnCall.pid }
      : { kind: 'failure', detail: spawnCall.detail }
  }
  const observeHealth = async () => {
    if (state.boundNewPid === null) return { kind: 'pending' }
    const probe = await probeImpl(attempt.planned.port)
    if (probeMatchesState(probe, { runId: attempt.target.runId, pid: state.boundNewPid })) {
      return { kind: 'success', runId: attempt.target.runId, pid: state.boundNewPid }
    }
    if (probe.responded) return { kind: 'unknown', detail: '健康端点返回了其他身份或非 200' }
    return { kind: 'pending' }
  }

  const performSave = async () => {
    const saved = await readSavedChoice(dataDir)
    const plannedRoot = String(attempt.planned.tdxRoot)
    const matches = saved && (process.platform === 'win32'
      ? saved.root.toLowerCase() === plannedRoot.toLowerCase()
      : saved.root === plannedRoot)
    return matches ? { ok: true, root: saved.root } : { ok: false, detail: '已保存的选择文件缺失或与本次计划不一致' }
  }
  const performDrain = async () => {
    const prepare = await controlPost('prepare', 20_000)
    if (prepare.responded && prepare.status === 200) return { kind: 'success' }
    if (prepare.responded && prepare.status === 504) return { kind: 'timeout' }
    if (prepare.responded && prepare.status === 409) {
      const code = prepare.json && prepare.json.error
      // 已在关闭中：排空事实上完成；活动训练/其他冲突按失败保守放弃
      if (code === 'CONTROL_CLOSING') return { kind: 'success' }
      if (code === 'ACTIVE_TRAINING') return { kind: 'failure', detail: '旧服务报告有进行中的训练' }
      return { kind: 'unknown', detail: `prepare 返回 ${code || prepare.status}` }
    }
    if (prepare.responded) return { kind: 'unknown', detail: `prepare 返回 ${prepare.status}` }
    return { kind: 'unknown', detail: 'prepare 无法连接旧服务' }
  }
  const requestShutdown = async () => {
    if (shutdownRequested) return
    shutdownRequested = true
    await controlPost('shutdown', 3_000)
    // 202 不证明退出；退出由 oldExit 观测决定
  }
  const performRestore = async () => {
    const previous = attempt.previousSavedChoice
    const target = join(dataDir, SAVED_CHOICE_FILE)
    try {
      if (previous && previous.version === 1 && typeof previous.root === 'string' && previous.root.trim() !== '') {
        const path = target
        const temporary = `${path}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify(previous, null, 2)}\n`, { flag: 'wx' })
        await rename(temporary, path)
      } else {
        await rm(target, { force: true })
      }
      return { ok: true }
    } catch {
      return { ok: false, detail: '恢复已保存选择失败' }
    }
  }
  const performStart = async () => {
    const runId = attempt.target.runId
    const readyFile = join(dataDir, READY_FILE)
    const logPath = join(dataDir, SERVER_LOG)
    await rm(readyFile, { force: true })
    const log = await open(logPath, 'a')
    try {
      await log.write(`\n[${new Date().toISOString()}] setup-restart ${attempt.attemptId}: starting run ${runId} on port ${attempt.planned.port}\n`)
      child = spawnImpl(layout.nodePath, [layout.serverScript], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
        env: {
          ...env,
          TRAINER_RUN_ID: runId,
          TRAINER_DB: attempt.planned.databasePath,
          TRAINER_STATIC_DIR: layout.webDir,
          TRAINER_READY_FILE: readyFile,
          TDX_ROOT: attempt.planned.tdxRoot,
          TRAINER_TDX_SOURCE: 'saved-choice',
          TRAINER_DATA_DIR: dataDir,
          // V1.2.6：训练数据目录设置写回启动器配置所需；supervisor 自身未解析配置时按默认路径
          TRAINER_CONFIG_PATH: context.configPath ?? join(root, 'trainer.config.json'),
          TRAINER_LAUNCHER_CJS: resolve(__filename),
          HOST: '127.0.0.1',
          PORT: String(attempt.planned.port),
          OPEN_BROWSER: '0',
        },
      })
      child.once('error', error => {
        spawnCall = { ok: false, detail: `新服务进程启动失败：${error && error.message}` }
      })
      if (child.unref) child.unref()
    } catch (error) {
      spawnCall = { ok: false, detail: `新服务进程无法创建：${error && error.message}` }
      return
    } finally {
      // 子进程已继承自己的 fd 副本（stdio 即日志文件）；监管进程自己的句柄必须
      // 显式关闭，不能留给 GC——否则触发 DEP0137（"Closing file descriptor on
      // garbage collection"），未来 Node 版本会升级为错误。
      await log.close().catch(() => {})
    }
    if (Number.isInteger(child.pid) && child.pid >= 1) {
      spawnCall = { ok: true, runId, pid: child.pid }
    } else {
      spawnCall = { ok: false, detail: '新服务进程没有有效 PID' }
    }
  }

  for (let iteration = 0; iteration < SUPERVISOR_ITERATION_CAP; iteration += 1) {
    const nowMs = Date.now()
    const step = plan.planRestartStep(state, {
      nowMs,
      activeTrainingId: await observeActiveTraining(),
      oldRecorded: attempt.old,
      oldObserved: await observeOldIdentity(),
      planned: attempt.planned,
      target: attempt.target,
      saveNewSource: pendingSave === null
        ? { kind: 'pending' }
        : (pendingSave.ok ? { kind: 'success' } : { kind: 'failure', detail: pendingSave.detail }),
      drain: drainOutcome ?? { kind: 'pending' },
      oldExit: observeOldExit(),
      spawn: observeSpawn(),
      health: await observeHealth(),
      restore: pendingRestore === null
        ? { kind: 'pending' }
        : (pendingRestore.ok ? { kind: 'success' } : { kind: 'failure', detail: pendingRestore.detail }),
      timeouts,
    })
    state = step.nextState
    const terminal = state.stageStartedAtMs === null && state.terminalReason !== null
    // 先持久化本轮状态（含已认领的 claimed），再执行动作
    await writeStatusBestEffort(dataDir, attempt, {
      phase: step.phase,
      stage: state.stage,
      reason: step.reason,
      done: terminal,
      planState: {
        stage: state.stage,
        claimed: state.claimed,
        boundNewPid: state.boundNewPid,
        stageStartedAtMs: state.stageStartedAtMs,
        terminalReason: state.terminalReason,
      },
    })

    if (terminal) {
      if (state.stage === 'ready') {
        const pid = spawnCall && spawnCall.ok ? spawnCall.pid : null
        if (pid !== null) {
          await writeStateFile(dataDir, {
            appId: APP_ID,
            runId: attempt.target.runId,
            pid,
            port: attempt.target.port,
            baseURL: attempt.target.origin,
            startedAt: new Date().toISOString(),
            version: layout.version,
            gitCommit: layout.gitCommit,
            databasePath: attempt.planned.databasePath,
            tdxRoot: attempt.planned.tdxRoot,
          }).catch(() => {})
        }
      } else if (child && child.pid && child.exitCode === null && child.signalCode === null) {
        // 非就绪终态：半启动的新服务必须收掉，避免与旧/未来服务双写
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      }
      await rm(attemptPath, { force: true }).catch(() => {})
      return { ready: state.stage === 'ready', phase: step.phase, stage: state.stage, reason: step.reason }
    }

    switch (step.action) {
      case 'save-new-source':
        pendingSave = await performSave()
        break
      case 'wait-save':
        await delay(Math.min(pollDelayMs, 50))
        break
      case 'wait-drain':
        if (!prepareRequested) {
          prepareRequested = true
          drainOutcome = await performDrain()
        } else {
          await delay(Math.min(pollDelayMs, 50))
        }
        break
      case 'send-sigterm':
        if (!sigtermSent) {
          sigtermSent = true
          void requestShutdown()
          try { process.kill(attempt.old.pid, 'SIGTERM') } catch { /* already gone */ }
        }
        await delay(pollDelayMs)
        break
      case 'send-sigkill-once':
        if (!sigkillSent) {
          sigkillSent = true
          try { process.kill(attempt.old.pid, 'SIGKILL') } catch { /* already gone */ }
        }
        await delay(pollDelayMs)
        break
      case 'start-new-server':
        await performStart()
        break
      case 'restore-old-config':
        pendingRestore = await performRestore()
        break
      default:
        // await-* / keep-old-state / abort 等等待或无副作用动作：轮询后重观测
        await delay(pollDelayMs)
        break
    }
  }
  const reason = '受控重启轮询次数超限；保留旧状态并停止监管'
  await writeStatusBestEffort(dataDir, attempt, {
    phase: 'drain-timeout', stage: 'old-exit-unconfirmed', reason, done: true,
  })
  if (child && child.pid && child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
  await rm(resolve(options.attemptPath), { force: true }).catch(() => {})
  return { ready: false, phase: 'drain-timeout', stage: 'old-exit-unconfirmed', reason }
}

/**
 * CLI 装配层。io 为可选注入通道（自动化测试用）：env、askConflict（冲突询问）、
 * urlOpener（复用时打开 URL）、processEnumerator / portLister / pidAliveImpl（停止
 * 扫描注入）。缺省全部走真实实现（弹框/PowerShell/真实进程发现）。
 */
async function main(argv, io = {}) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    console.error(`[参数错误 / bad arguments] ${error.message}`)
    process.exitCode = 1
    return
  }
  if (parsed.help) {
    console.log(usage())
    return
  }
  try {
    if (parsed.restartAttemptPath) {
      // SETUP-01 受控重启监管模式：由服务端 detached 拉起，无交互输出；结果经
      // dataDir/setup-restart-status.json 呈现，退出码 0=ready、1=未就绪/失败。
      // V1.2.7 修复：main() 此前透传的是 parseArgs 的 restartAttemptPath 键，而
      // runSetupRestartAttempt 读 options.attemptPath——字段名不匹配导致 resolve(undefined)
      // 启动即崩、状态永远停在 preflight（真实包首配"重启确认超时"的根因；测试直调
      // 函数绕过了 CLI 装配层，故 49 例全绿未拦截）。
      const result = await runSetupRestartAttempt({ ...parsed, attemptPath: parsed.restartAttemptPath, env: process.env })
      if (result.ready) {
        console.log('受控重启完成，新服务已就绪 / controlled restart ready')
      } else {
        console.error(`受控重启未完成（${result.phase}）：${result.reason} / controlled restart did not reach ready`)
        process.exitCode = 1
      }
      return
    }
    if (parsed.stop) {
      // PORT-02（用户 2026-10-06）：Stop.cmd 关闭全部已验证训练器进程（记录者＋孤儿），
      // 不明进程不杀；未确认退出的杀如实报错并以非零退出码呈现。
      const result = await stop({
        ...parsed,
        allTrainers: true,
        env: io.env ?? process.env,
        ...(io.processEnumerator ? { processEnumerator: io.processEnumerator } : {}),
        ...(io.portLister ? { portLister: io.portLister } : {}),
        ...(io.pidAliveImpl ? { pidAliveImpl: io.pidAliveImpl } : {}),
      })
      if (result.stopped) {
        console.log(`训练服务已停止（PID ${result.pid}，端口 ${result.port}）。数据库与日志保留在 ${result.dataDir} / server stopped; database and logs kept`)
        console.log('本次为应急强制结束；正常保存退出请使用页面里的"退出训练器" / this was an emergency force stop; use the in-app exit for a normal saved shutdown')
      } else if (result.noop === 'already-dead') {
        console.log(`记录的服务进程（PID ${result.pid}）已不存在，已清理过期状态 / the recorded process is gone; stale state cleaned`)
      } else {
        console.log('没有已记录的训练服务 / no recorded trainer to stop')
      }
      const kills = Array.isArray(result.kills) ? result.kills : []
      const extraKills = kills.filter(entry => !entry.recorded)
      if (extraKills.length) {
        console.log(`另外发现并关闭 ${extraKills.length} 个训练器进程：${extraKills.map(entry => `PID ${entry.pid}（端口 ${entry.port}）`).join('、')} / additional trainer processes closed`)
      }
      const unconfirmed = kills.filter(entry => entry.exited !== true || entry.signaled !== true)
      if (unconfirmed.length) {
        console.error(`以下训练器进程未能确认退出，未假报成功：${unconfirmed.map(entry => `PID ${entry.pid}${entry.signaled !== true ? '（结束信号失败）' : ''}`).join('、')}；请稍后重试 Stop.cmd 或在任务管理器确认 `
          + `/ could not confirm exit for: ${unconfirmed.map(entry => `PID ${entry.pid}`).join(', ')}; retry Stop.cmd later or check Task Manager`)
        process.exitCode = 1
      } else if (result.sweep && result.sweep.available === false) {
        console.log(`警告：无法枚举系统训练器进程（${result.sweep.reason}）；已按记录处理，未做全量清理 / warning: system-wide trainer enumeration unavailable; only the recorded service was handled`)
      }
      const spared = Array.isArray(result.spared) ? result.spared : []
      if (spared.length) {
        console.log(`发现 ${spared.length} 个未能验证为训练器的候选进程，已保留不动：${spared.map(entry => `PID ${entry.pid}（${entry.reason}）`).join('、')} / unverified candidates left untouched`)
      }
      return
    }
    // PORT-02：训练器占用目标端口时先取得用户应答（--conflict-answer 优先，否则弹框/
    // 控制台），再带应答重入 launch；一次重入后仍冲突则按失败上报，不无限循环。
    let result
    let launchOptions = {
      ...parsed,
      env: io.env ?? process.env,
      ...(io.urlOpener ? { urlOpener: io.urlOpener } : {}),
    }
    for (let attempt = 0; ; attempt++) {
      try {
        result = await launch(launchOptions)
        break
      } catch (error) {
        if (attempt === 0 && error && error.code === CONFLICT_ASK_CODE) {
          let answer = parsed.conflictAnswer
          if (answer !== 'reuse' && answer !== 'restart') {
            answer = await (io.askConflict ?? askConflictReuseOrRestart)(error.occupant)
          }
          if (answer !== 'reuse' && answer !== 'restart') {
            throw new Error(`冲突询问返回了未知应答（${JSON.stringify(answer)}），已中止启动；未改动任何进程 / unexpected conflict answer; start aborted without touching any process`)
          }
          launchOptions = { ...launchOptions, conflictAnswer: answer }
          continue
        }
        throw error
      }
    }
    if (result.reused) {
      console.log(`训练服务已在运行，直接复用 / reusing the running server: ${result.url}`)
      if (result.reusedConflictTrainer) {
        console.log('已按你的选择从已有进程打开训练器（未新开服务进程）/ opened the existing trainer per your choice (no second server process)')
      } else {
        console.log('如修改过 trainer.config.json 或更换了新版本包，请先运行 Stop.cmd 停止旧服务再启动。/ Config or package changes apply after running Stop.cmd first.')
      }
      if (result.portFallback) console.log(`端口提示 / port note: ${portFallbackNote(result.portFallback)}`)
    } else {
      console.log(`训练服务已启动 / server started: ${result.url}`)
      console.log(`数据目录 / data directory: ${result.dataDir}`)
      console.log(`行情目录 / market data (tdxRoot): ${result.tdxRoot ?? '未找到通达信目录，可在 trainer.config.json 配置 tdxRoot / not found; set tdxRoot in trainer.config.json'}`)
      console.log(`服务进程 PID: ${result.pid}   日志 / log: ${result.logPath}`)
      if (result.portFallback) console.log(`端口提示 / port note: ${portFallbackNote(result.portFallback)}`)
      console.log('再次运行 Start.cmd 会复用当前服务并打开浏览器；停止服务请运行 Stop.cmd（关闭浏览器不会停止服务）。/ Run Start.cmd again to reopen the browser; run Stop.cmd to stop the server (closing the browser does not stop it).')
    }
    if (parsed.openBrowser && !result.openedBrowser) {
      console.log('浏览器未能自动打开，请手动访问上面的地址 / could not open a browser; visit the URL above manually')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[${parsed.stop ? '停止失败 / stop failed' : '启动失败 / launch failed'}] ${message}`)
    process.exitCode = 1
    const dataDir = error && typeof error === 'object' ? error.dataDir : null
    if (typeof dataDir === 'string') {
      await appendFile(join(dataDir, LAUNCHER_LOG), `[${new Date().toISOString()}] ${message}\n`).catch(() => {})
    }
    // V1.2.7：受控重启监管进程在早期（读交接文件/加载状态机/抢锁之前）崩溃时，
    // 磁盘上的重启状态永远停在 preflight，页面只能等满轮询窗口后报"重启确认超时"。
    // 这里尽力把状态写成明确终态：已保存的目录未自动生效，重新打开训练器即可使用。
    if (parsed.restartAttemptPath) {
      try {
        const raw = JSON.parse(await readFile(parsed.restartAttemptPath, 'utf8'))
        if (raw && typeof raw === 'object' && typeof raw.old?.dataDir === 'string') {
          await writeStatusBestEffort(raw.old.dataDir, raw, {
            phase: 'failed', stage: 'failed',
            reason: `重启监管进程异常退出（${message.slice(0, 120)}）；保存的目录未自动生效，重新打开训练器即可使用新目录`,
            done: true,
          })
        }
      } catch { /* 兜底失败不掩盖原始错误 */ }
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  APP_ID,
  CONFLICT_ASK_CODE,
  DATA_DIR_NAME,
  DEFAULT_PORT,
  LOCK_FILE,
  READY_FILE,
  SERVER_LOG,
  STATE_FILE,
  acquireLaunchLock,
  askConflictReuseOrRestart,
  bindCheckPort,
  enumerateNodeProcessesPS,
  findFallbackPort,
  assertStateIdentity,
  clearState,
  confirmOwnedServer,
  decideRecordedServer,
  inspectPackage,
  isTrainerCandidateCommandLine,
  isTdxRootPath,
  killVerifiedTrainer,
  launch,
  listListenPortsPS,
  loadRestartPlan,
  lockPath,
  main,
  openURL,
  parseArgs,
  pidAlive,
  probeHealth,
  probeMatchesState,
  readAttemptFile,
  readConfigFile,
  readOwnedState,
  readSavedChoice,
  resolveConfig,
  resolveTdxWithSource,
  runSetupRestartAttempt,
  statePath,
  stop,
  sweepTrainers,
  usage,
  waitPidExit,
  waitPortRefused,
  writeStateFile,
  writeRestartStatus,
}
