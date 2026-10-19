// PACK-02 Electron 主进程（完整生命周期；PACK-01 最小原型的升级）：
//   单实例锁（锁检查先于一切启动分支）→ 开发窗口模式（DESKTOP_DEV_URL）或
//   端口决策（PORT-01 自动回退/PORT-02 训练器占用三应答，应答可注入）→
//   进程内启动 Fastify server → BrowserWindow（bounds 记忆/最小尺寸/安全基线/外部链接系统浏览器）。
//   退出：窗口全关→冻结排空（in-app 口径，未完成训练保留 SQLite）→server close→app 退出；
//   超时（TRAINER_DESKTOP_DRAIN_TIMEOUT_MS，默认 15s）强制退出并如实记录。
// PACK-03 数据与配置兼容：启动早期先做首启数据发现/采用（adopt-in-place，绝不复制/迁移/
//   删除既有库）＋trainer.config.json 旧配置沿用＋saved-tdx-choice 沿用；内嵌服务启动前取
//   launch.lock 并按 dataDir 状态记录做共存裁决（与 zip launcher 双向防双写）；服务起来后写
//   同格式 trainer-state.json 供 launcher 反向识别，退出时仅清理本进程身份匹配的自有记录。
// PACK-04 更新通道：packaged 形态经 electron-updater（GitHub latest.yml；feed 可注入），
//   dev/源码形态回落既有 UPD HTTP 端点（渲染端探测，UPD-01/02 零降级）；安装必经排空退出
//   管线（resolveInstallActionOnExit：排空超时 forced 路径绝不安装）。preload 仅暴露更新窄接口。
// 决策逻辑全部抽在纯函数层（boot-plan/port-conflict/quit-state/window-bounds/external-links/
// data-home/coexist-guard/desktop-updates，vitest 覆盖）；本文件只做 Electron API 粘合，实机行为由
// desktop/scripts/smoke-desktop.mjs 验证。
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAppUrl,
  buildServerEnv,
  hasExplicitDataOverride,
  resolveDesktopConfig,
  type DesktopRuntimeConfig,
} from './desktop-config.js'
import { planInstanceBoot } from './boot-plan.js'
import {
  bindCheckTcp,
  killTrainerTree,
  parseConflictAnswerEnv,
  portFallbackEnvValue,
  probeHealthHttp,
  resolvePortPlan,
  taskkillTreeKillWindows,
  type ConflictAnswer,
  type PortPlan,
  type TrainerIdentity,
} from './port-conflict.js'
import { nextQuitState, resolveDrainTimeoutMs, type QuitState } from './quit-state.js'
import { classifyUrl } from './external-links.js'
import {
  clampToBounds,
  MIN_WINDOW_SIZE,
  parseWindowState,
  serializeBounds,
  type WindowBounds,
} from './window-bounds.js'
import {
  createNodeDataHomeDeps,
  LIBRARY_FILE,
  parseSavedTdxChoice,
  persistDataChoiceRecord,
  resolveDataHome,
  savedChoiceSearchDir,
  SAVED_TDX_CHOICE_FILE,
} from './data-home.js'
import {
  acquireLaunchLock,
  buildStateRecord,
  decideCoexistence,
  launchLockPathOf,
  parseTrainerStateRecord,
  STATE_APP_ID,
  STATE_FILE,
  stateRecordIsOurs,
  type DesktopStateRecord,
} from './coexist-guard.js'
import {
  createDesktopUpdateController,
  resolveDownloadStallTimeoutMs,
  resolveInstallActionOnExit,
  resolveUpdateChannel,
  resolveUpdateFeed,
  type DesktopUpdateEvent,
  type DesktopUpdateNotice,
  type DesktopUpdaterAdapter,
} from './desktop-updates.js'
import { adaptElectronUpdater, defaultDesktopUpdater } from './update-adapter.js'
import { createFeedFallbackAdapter, readUpdateSourceSetting, resolveDesktopFeedPlan } from './cn-feed.js'
import { registerUpdateIpc } from './update-ipc.js'
import { registerArchiveIpc } from './archive-recording.js'
import {
  applyPendingHistoryAtBoot,
  consumeOneClickHistoryStaging,
  registerMigrationIpc,
  runOneClickRecordingImport,
} from './mig-import.js'
import { cleanupPortableUpdateLeftovers, createPortableUpdaterAdapter, isPortableExecution, resolvePortableTargetExe } from './portable-updater.js'
import { createDiagLogger, createNodeDiagLogDeps, createTeeConsole, type DiagLogger } from './diag-log.js'
import {
  DIAG_RECENT_ERROR_LIMIT,
  DIAG_TAIL_MAX_LINES,
  registerDiagnosticsIpc,
  summarizeUpdateCheck,
  tailResultToFactsLogTail,
  type DiagnosticsFacts,
  type UpdateCheckSnapshot,
} from './diagnostics.js'

// ===== P0-4（PORT-UPD-01）＋UPD-QUIT-TYPEERROR-GUARD：主进程异常兜底（最后防线） =====
// 必须是模块体第一段语句（ESM import 无法前移，此处即注册可达的最早点）：晚于此的任何
// 顶层语句抛错都会落进「兜底未注册」窗口（Electron 默认崩溃窗形态）。
// 用户真机证据：undici（全局 fetch）内部 AssertionError [ERR_ASSERTION] assert(this.paused)
// 从异步路径抛出，不经任何 try/catch，Electron 默认行为＝弹「A JavaScript error
// occurred in the main process」崩溃窗（用户称启动后经常出现）。主进程网络层已整体
// 换 Node 原生 http/https（server 侧 safe-http.ts＋desktop 侧 portable-updater.ts），
// 本兜底确保任何残余异步异常（未知的第三方库内部断言等）只被完整记录、不再崩进程：
//   - uncaughtException/unhandledRejection → mainLog.error（tee：console＋落盘；时间＋堆栈）后不退出；
//   - 不触碰正常退出管线（不调用 process.exit/app.exit/app.quit、不改 exitCode）；
//   - 正常路径的错误仍由各调用点自身受控处理，本层不是错误处理的替代。
// UPD-QUIT-TYPEERROR-GUARD（2026-10-11 用户真机第三形态）加固：
//   - Electron 默认崩溃窗本身是一个 uncaughtException 监听器（lib/browser/init.ts），
//     listenerCount>1 即自禁——兜底注册后正常存活期的进程级异常不会再弹窗；弹窗＝异常
//     落入 JS 兜底失效的窗口（teardown 撕裂期 / 注册前），故 handler 自身绝不允许抛错
//     （handler 内抛错＝Electron 对其仍走默认崩溃路径）；
//   - 因此 reason/error 一律经 formatUnknownError 守卫格式化（undefined/非 Error/不可
//     字符串化对象全容忍），处理体内不直接解引用 error 的任何属性。
function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? '(no stack)'}`
  }
  try {
    return String(error)
  } catch {
    // String() 对 Symbol.toPrimitive 抛错的对象自身可抛异常——兜底内部零信任
    return '(unstringifiable error)'
  }
}

// ===== GAP1-DIAG（用户 2026-10-19 拍板 G1＋拍板 8）：主进程日志 tee 与诊断接线 =====
// DESKTOP-DIAG-LOG-PERSIST：main.ts 全部日志经 mainLog（tee）＝console 透传＋
// <dataDir>/logs/main.log 落盘（diag-log.ts 自实现，零新依赖；按大小滚动保留有限份，
// 写失败逐次降级 console，绝不阻断启动）。sink 在 dataDir 解析后才 attach——attach 前
// 的启动早期行（含本块与下方兜底注册之间的异常）仅 console，已知边界（开工简报披露）。
// DESKTOP-DIAG-IPC：诊断专用通道 desktop-diagnostics:invoke（preload 对应 desktopDiagnostics
// 窄对象），除此外不新增任何 IPC 面。最近错误＝主进程口径（root 2026-10-19 裁定：renderer
// 错误不采集，守住 IPC 最小面）。
let diagLogger: DiagLogger | null = null
let diagDataDir: string | null = null
let lastUpdateCheckSnapshot: UpdateCheckSnapshot | null = null
const recentErrors: string[] = []
const mainLog = createTeeConsole({
  getSink: () => diagLogger,
  onErrorLine: line => {
    recentErrors.push(line)
    if (recentErrors.length > DIAG_RECENT_ERROR_LIMIT) recentErrors.shift()
  },
})

/** dataDir 就绪后接入落盘 sink（幂等；首行自证 attach 成功） */
function attachDiagLog(dataDir: string): void {
  if (diagLogger) return
  diagDataDir = dataDir
  diagLogger = createDiagLogger({ dataDir, deps: createNodeDiagLogDeps() })
  mainLog.log(`[desktop] diag log attached at ${diagLogger.filePath}`)
}

/** 诊断 facts 组装（DESKTOP-DIAG-CLIPBOARD；版本/平台/数据目录/更新通道与最近检查/最近错误/日志尾部） */
async function collectDiagnosticsFacts(): Promise<DiagnosticsFacts> {
  const tail = diagLogger
    ? await diagLogger.readTail(DIAG_TAIL_MAX_LINES)
    : { ok: false as const, reason: '日志尚未初始化（dev 窗口或启动早期）' }
  return {
    appVersion: app.getVersion(),
    platform: {
      os: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node,
    },
    dataDir: diagDataDir,
    updateChannel: updateChannelKind,
    lastUpdateCheck: lastUpdateCheckSnapshot,
    recentErrors: [...recentErrors],
    logTail: tailResultToFactsLogTail(tail),
  }
}

process.on('uncaughtException', error => {
  mainLog.error(`[desktop] uncaught exception at ${new Date().toISOString()} (process kept alive):`, formatUnknownError(error))
})
process.on('unhandledRejection', reason => {
  mainLog.error(`[desktop] unhandled rejection at ${new Date().toISOString()} (process kept alive):`, formatUnknownError(reason))
})

const DEV_WINDOW_URL = process.env.DESKTOP_DEV_URL?.trim() || null
const WINDOW_TITLE = 'K线训练器'
const WINDOW_STATE_FILE = 'window-state.json'
// sandboxed preload 必须是 CJS（Electron ESM 文档）；src/preload.cts 编译产物为 dist/preload.cjs
const PRELOAD_ENTRY = fileURLToPath(new URL('./preload.cjs', import.meta.url))

type EmbeddedServer = {
  shutdown(): Promise<void>
  drain: {
    prepare(attemptId: string, options?: { allowActiveTraining?: boolean }): Promise<{ kind: string }>
  }
}

let mainWindow: BrowserWindow | null = null
let serverHandle: EmbeddedServer | null = null
let serverRunning = false
let quitState: QuitState = { phase: 'idle' }
let shutdownCall: Promise<void> | null = null
let windowStatePath: string | null = null
// PACK-03：内嵌服务的身份（写/清 trainer-state.json 与 health 上报同源）
let serverIdentity: { runId: string; pid: number; dataDir: string } | null = null
// PACK-04：更新通道（packaged→electron-updater；dev/源码→既有 UPD HTTP 端点由渲染端回落）
const updateChannelKind = resolveUpdateChannel({ isPackaged: app.isPackaged })
// DATA-ARCH-01：录像归档目录的数据目录来源（bootServerAndOpen 解析后生效；dev 窗口保持 null）
let archiveDataDir: string | null = null
// MIG-EXT-01：v1.2.7 训练历史迁移的目标库路径（bootServerAndOpen 解析后生效；dev 窗口保持 null）
let migrationDatabasePath: string | null = null
/** 排空完成后待安装的新版（downloaded 事件置位；仅 exit 分支非 forced 路径消费） */
let installPendingUpdate = false
/** PORT-UPD-01：便携自更新 staging 所在数据目录（IPC 注册先于启动；bootServerAndOpen 解析后回填） */
let portableUpdateDataDir: string | null = null
/** 更新事件下发：窗口已销毁/未建时丢弃并日志（下载可在窗口生命周期外进行） */
function sendUpdateEvent(event: DesktopUpdateEvent): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) {
    mainLog.warn('[desktop] update event dropped (no live window):', event.type)
    return
  }
  try {
    win.webContents.send('desktop-update:event', event)
  } catch (error) {
    mainLog.error('[desktop] update event send failed:', error)
  }
}

// ===== UPD-NOTIFY-01（v1.3.0）：boot 自动检查的新版通知投递 =====
// 启动时序竞态兜底：自动检查可能在窗口创建/渲染端订阅完成之前结束（即时投递会被
// sendUpdateEvent 丢弃或渲染端无人监听），故缓存通知，并在每次页面加载完成
// （did-finish-load，渲染端 setup 期已订阅）后补投；检查晚于加载完成时由 onBootNotice
// 即时投递。两条路径幂等（渲染端仅置内存态）。
let bootUpdateNotice: DesktopUpdateNotice | null = null
function deliverBootUpdateNotice(): void {
  if (!bootUpdateNotice) return
  sendUpdateEvent({ type: 'update-available-notice', ...bootUpdateNotice })
}

// ===== 窗口 =====

function targetWorkArea(bounds: WindowBounds) {
  return screen.getDisplayMatching(bounds).workArea
}

function rememberWindowBounds(): void {
  const statePath = windowStatePath
  if (!mainWindow || !statePath) return
  try {
    const saved = serializeBounds(mainWindow.getBounds())
    // 原子落盘：临时文件＋rename（与 server ready 文件同法）；失败仅日志，绝不阻断退出
    const temporary = `${statePath}.${randomUUID()}.tmp`
    void writeFile(temporary, JSON.stringify(saved), 'utf8')
      .then(() => rename(temporary, statePath))
      .catch(error => mainLog.error('[desktop] window state persist failed:', error))
  } catch (error) {
    mainLog.error('[desktop] window state persist failed:', error)
  }
}

/** 读取并 clamp 上次窗口位置；无记忆/损坏返回 null（由 Electron 默认居中 1360×860） */
async function loadWindowBounds(): Promise<WindowBounds | null> {
  const statePath = windowStatePath
  if (!statePath) return null
  try {
    const raw = JSON.parse(await readFile(statePath, 'utf8'))
    const parsed = parseWindowState(raw)
    if (parsed) return clampToBounds(parsed, targetWorkArea(parsed))
  } catch { /* 缺失/损坏 → 默认 */ }
  return null
}

function applyExternalLinkPolicy(win: BrowserWindow, appOrigin: string): void {
  // DESKTOP-EXTERNAL-LINKS：应用内不弹新 Electron 窗口；应用源外 http(s) 交系统默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyUrl(url, appOrigin) === 'external') {
      void shell.openExternal(url).catch(error => mainLog.error('[desktop] openExternal failed:', error))
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const disposition = classifyUrl(url, appOrigin)
    if (disposition === 'external') {
      event.preventDefault()
      void shell.openExternal(url).catch(error => mainLog.error('[desktop] openExternal failed:', error))
    } else if (disposition === 'denied') {
      event.preventDefault()
    }
  })
}

function createWindow(url: string, bounds: WindowBounds | null): BrowserWindow {
  const win = new BrowserWindow({
    ...(bounds ?? {}),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    title: WINDOW_TITLE,
    autoHideMenuBar: true,
    show: false,
    // 安全基线（PACK-02 决策⑥）：显式锁定 Electron 安全默认，不因后续升级漂移；
    // PACK-04：preload 仅更新窄接口（sandboxed preload＝CJS，见 PRELOAD_ENTRY 注释）
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: PRELOAD_ENTRY,
    },
  })
  // 页面自带 <title>A股 K线训练器</title> 会在加载后覆盖窗口标题；PACK-01 冻结窗口标题
  // 为「K线训练器」（派发简报原文），拒绝页面标题覆盖（proposed_default：标题固定策略）。
  win.on('page-title-updated', event => { event.preventDefault() })
  win.once('ready-to-show', () => { win.show() })
  win.on('close', () => { rememberWindowBounds() })
  // UPD-NOTIFY-01：页面加载完成后补投 boot 检查发现的新版通知（渲染端 setup 期已订阅；
  // 检查晚于加载完成时由 onBootNotice 即时投递，双路径幂等）
  win.webContents.on('did-finish-load', () => { deliverBootUpdateNotice() })
  applyExternalLinkPolicy(win, new URL(url).origin)
  void win.loadURL(url)
  return win
}

// ===== 端口冲突询问（GUI 不可测部分；应答可经 env 注入，测试/冒烟不依赖 GUI） =====

const CONFLICT_DIALOG: { title: string; message: (occupant: TrainerIdentity) => string; buttons: string[]; defaultId: number; cancelId: number } = {
  title: '端口被训练器占用',
  message: occupant => `检测到端口 ${occupant.port} 上已有训练器服务（PID ${occupant.pid}）。\n\n`
    + '「连接已有服务」＝直接打开该服务（不新开进程）；\n'
    + '「结束并重启」＝关闭该训练器后从这里重新启动；\n'
    + '「取消」＝不改动任何进程，退出本应用。',
  buttons: ['连接已有服务', '结束并重启', '取消'],
  defaultId: 0,
  cancelId: 2,
}

async function askConflictDialog(occupant: TrainerIdentity): Promise<ConflictAnswer> {
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: CONFLICT_DIALOG.title,
    message: CONFLICT_DIALOG.title,
    detail: CONFLICT_DIALOG.message(occupant),
    buttons: CONFLICT_DIALOG.buttons,
    defaultId: CONFLICT_DIALOG.defaultId,
    cancelId: CONFLICT_DIALOG.cancelId,
    noLink: true,
  })
  // 按钮序即应答序：0=reuse / 1=restart / 2=cancel（Esc/关闭＝cancelId→cancel）
  return (['reuse', 'restart', 'cancel'] as const)[choice.response]
}

async function killTrainerOccupant(occupant: TrainerIdentity): Promise<{ exited: boolean; error?: string }> {
  // PORT-02 口径：身份已复核（resolvePortPlan / decideCoexistence 内），这里只负责结束该
  // 训练器并等退出。PORT-COEXIST-V127-NODE（2026-10-11 用户真机验收修复）：
  //   - v1.2.7 zip 形态是 cmd 壳→launcher→detached node 服务链，另有 SETUP-01 受控重启
  //     监管形态；单 PID process.kill 对带子进程/监管者的形态会留残余甚至被重启——改按
  //     进程树终止（taskkill /PID <pid> /T /F，杀「该已验证训练器的 pid＋其后代」，
  //     绝不向树外发信号，不明进程不杀的边界不变）；
  //   - 杀后「等端口真正释放」由 resolvePortPlan 的释放轮询承载（这里只等进程退出）。
  return killTrainerTree(occupant.pid, {
    runTreeKill: taskkillTreeKillWindows,
    pidAlive,
  })
}

// ===== PACK-03 数据落点发现/采用＋共存防线（INSTALL-01 收敛后唯一候选＝legacy-home，
// 双候选决策对话框退役——data-home 决策层不再有询问路径；GUI 询问可注入仅余端口/共存冲突） =====

/** launcher pidAlive 镜像：EPERM＝活（无权限发信号≠进程不存在） */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function nodeLaunchLockDeps() {
  return {
    openExclusive: async (path: string) => {
      try {
        const handle = await open(path, 'wx')
        await handle.writeFile(`${JSON.stringify({ appId: STATE_APP_ID, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`)
        await handle.close()
        return { ok: true }
      } catch (error) {
        return { ok: false, code: (error as NodeJS.ErrnoException).code }
      }
    },
    readLockInfo: async (path: string): Promise<unknown> => {
      try {
        return JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        // 锁文件消失＝已释放（null）；存在但读不懂＝不可识别（非 null）
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        return 'unreadable-lock'
      }
    },
    removeFile: async (path: string) => { await rm(path, { force: true }) },
    pidAlive,
  }
}

async function readTrainerStateRaw(dataDir: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dataDir, STATE_FILE), 'utf8'))
  } catch {
    return null // 缺失/损坏均按 launcher readOwnedState 缺席处理（决策层再分档）
  }
}

/** 状态记录原子写入（launcher writeStateFile 同法：临时文件＋rename） */
async function writeTrainerStateFile(dataDir: string, record: DesktopStateRecord): Promise<void> {
  const path = join(dataDir, STATE_FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

/** 退出清理：仅当文件内容仍是本进程 runId+pid 身份时才删（绝不删他人记录） */
async function clearOwnTrainerState(): Promise<void> {
  const identity = serverIdentity
  if (!identity) return
  try {
    const path = join(identity.dataDir, STATE_FILE)
    const raw = await readTrainerStateRaw(identity.dataDir)
    if (stateRecordIsOurs(raw, identity)) await rm(path, { force: true })
  } catch (error) {
    mainLog.error('[desktop] state record cleanup failed:', error)
  }
}

// ===== PACK-04 更新通道接线（channel/adapter/IPC；安装走下方退出管线的 exit 分支） =====

let updateAdapterRef: { quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void } | null = null

/** CN-FEED-01：回退适配器的逐源尝试记录出口（boot-check.json sources 观测缝；非回退通道为 null） */
let updateFeedAttemptsRef: { lastAttempts(): unknown } | null = null

/**
 * 便携更新通道不可用（替换目标解析失败）时的 fail-closed 适配器（P0 修复）：
 * 检查/下载一律抛人话错误（controller 转成 check view error 如实呈现给设置页），
 * 绝不触碰任何 exe，也绝不静默回退 electron-updater（其不支持 portable target）。
 */
function createUnavailablePortableAdapter(reason: string): DesktopUpdaterAdapter {
  const message = `便携版更新不可用：${reason}`
  const fail = (): never => { throw new Error(message) }
  return {
    setFeedURL: () => { /* no-op：通道已禁用 */ },
    checkForUpdates: fail,
    downloadUpdate: fail,
    quitAndInstall: () => { mainLog.error('[desktop] portable update install skipped: channel unavailable') },
    onDownloadProgress: () => { /* no-op */ },
  }
}

async function setupUpdateChannel(): Promise<void> {
  const feed = resolveUpdateFeed(process.env)
  let adapter: DesktopUpdaterAdapter
  if (updateChannelKind === 'packaged' && isPortableExecution(process.env)) {
    // PORT-UPD-01：便携 exe（electron-updater 不支持 portable target 自更新）→ 自研替换式更新器；
    // 适配器实现同一 DesktopUpdaterAdapter 面，controller/IPC/渲染端零改动。
    // @deprecated INSTALL-01（2026-10-11 用户拍板，矩阵行 INSTALL-NSIS-ASSISTED）：v1.3.0 起
    // 便携产物退役、发布形态仅 NSIS 安装器——本分支仅供存量便携用户（≤v1.2.7 便携 exe）在
    // 更新源尚含便携条目时续命一个版本周期，防发布回滚；激活门＝PORTABLE_EXECUTABLE_DIR
    // （仅 electron-builder portable target 注入，NSIS/dev 形态该变量恒缺失→本分支不激活，
    // 走 electron-updater NSIS 通道；isPortableExecution 语义由 portable-updater.test.ts 锁定）。
    // P0 修复：替换目标＝resolvePortableTargetExe 解析的用户实际启动 exe（PORTABLE_EXECUTABLE_FILE）；
    // process.execPath 只是 portable 壳解压到 %TEMP% 的临时副本，以它为目标＝更新无效（真机实证）。
    // 解析失败（便携形态却缺该变量）→ fail-closed 禁用便携更新通道并上报（绝回退临时副本），
    // 不阻断启动（训练功能不受影响）。
    try {
      const portableTargetExe = resolvePortableTargetExe(process.env, process.execPath)
      adapter = createPortableUpdaterAdapter({
        exePath: portableTargetExe,
        env: process.env,
        getDataDir: () => portableUpdateDataDir,
        getCurrentVersion: () => app.getVersion(),
        // P0-5 真机实证（2026-10-11 两轮）：spawn 替换脚本后 app.exit(0) 在部分环境进程挂起
        // （server 已停、进程残留、脚本 60s 等不到 pid 超时零触碰）；GUI 正常退出路径
        // （window-all-closed 优雅管线，同为 exit 收尾）复现退净——quit 语义走完整
        // will-quit 清理（DevTools agent 等句柄释放）后再终止，稳定性更佳。
        quitApp: () => app.quit(),
        feed,
      })
      mainLog.log(`[desktop] portable self-update channel active (exe: ${portableTargetExe})`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      mainLog.error('[desktop] portable self-update unavailable (cannot resolve target exe):', reason)
      adapter = createUnavailablePortableAdapter(reason)
    }
  } else {
    const updater = await defaultDesktopUpdater()
    // CN-FEED-01（UPD-CN-FALLBACK-DESKTOP）：electron-updater 链经回退适配器包装——每次
    // 检查按 resolveDesktopFeedPlan 逐源 setFeedURL（env 注入单源不回退＞三态设置＞
    // auto＝镜像 latest.yml 优先、失败回退 GitHub 一次）；计划在检查期重取（读最新
    // update-source.json；portableUpdateDataDir 惰性取值＝config.dataDir，沿 archiveDataDir
    // 先例——setupUpdateChannel 先于 bootServerAndOpen，boot 检查期读到 null＝auto 默认，
    // 已知时序限制见 docs/verification/2026-10/CN-FEED-01/README.md §1.2）。
    const inner = adaptElectronUpdater(updater)
    const fallback = createFeedFallbackAdapter({
      inner,
      getPlan: async () => resolveDesktopFeedPlan(process.env, await readUpdateSourceSetting(portableUpdateDataDir)),
      logger: mainLog,
    })
    adapter = fallback
    updateFeedAttemptsRef = fallback
  }
  updateAdapterRef = adapter
  const controller = createDesktopUpdateController({
    adapter,
    getCurrentVersion: () => app.getVersion(),
    sendEvent: sendUpdateEvent,
    // 下载完成 → 排空退出管线（drain.prepare(allowActiveTraining:true)→shutdown→exit 分支安装）
    requestInstallWithDrain: () => {
      installPendingUpdate = true
      requestGracefulQuit()
    },
    logger: mainLog,
    // DL-HANG-01：下载停滞看门狗阈值（90s 缺省；env TRAINER_DESKTOP_DL_STALL_MS 可注入覆盖）
    stallTimeoutMs: resolveDownloadStallTimeoutMs(process.env),
  })
  registerUpdateIpc({
    ipcMain,
    controller,
    channelKind: updateChannelKind,
    // GAP1-DIAG：boot 检查结果留人话快照，供「复制诊断信息」的最近检查字段（渲染端手动
    // 检查不在主进程面内——设置页自身即呈现，诊断文本只承诺主进程视角）。
    runBootCheck: async () => {
      try {
        const view = await controller.checkForUpdates()
        lastUpdateCheckSnapshot = summarizeUpdateCheck(new Date().toISOString(), view)
        return view
      } catch (error) {
        lastUpdateCheckSnapshot = {
          at: new Date().toISOString(),
          ok: false,
          summary: `检查失败：${error instanceof Error ? error.message : String(error)}`,
        }
        throw error
      }
    },
    bootCheckOutPath: updateChannelKind === 'packaged'
      ? (process.env.TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT?.trim() || null)
      : null,
    // CN-FEED-01：boot 检查的逐源尝试记录（镜像/GitHub 哪个成功）落观测缝，W5 真机判断用
    bootCheckSources: updateFeedAttemptsRef === null ? undefined : () => updateFeedAttemptsRef?.lastAttempts(),
    // UPD-NOTIFY-01：boot 自动检查发现新版→缓存＋即时投递（加载完成前被丢时由
    // did-finish-load 补投）
    onBootNotice: notice => {
      bootUpdateNotice = notice
      deliverBootUpdateNotice()
    },
    logger: mainLog,
  })
}

// ===== DATA-ARCH-01 录像归档 IPC（唯一新增 IPC 段；不触碰更新绑定段） =====
// 渲染端经 preload 的 desktopRecordings.archiveRecording 提交语义化文件名＋gzip 载荷，
// 主进程原子写入 <dataDir>/recordings/（决策与原子写法在 archive-recording.ts）。
// 真实 fs 注入；recordingsDir 惰性取值（bootServerAndOpen 设置 archiveDataDir 后才可用，
// dev 窗口/启动早期为 null → 结构化未就绪错误，渲染端降级提示）。
registerArchiveIpc({
  ipcMain,
  recordingsDir: () => (archiveDataDir ? join(archiveDataDir, 'recordings') : null),
  fs: {
    mkdir: async path => { await mkdir(path, { recursive: true }) },
    writeFile: async (path, data, options) => { await writeFile(path, data, options) },
    rename: async (oldPath, newPath) => { await rename(oldPath, newPath) },
    access: async path => { await access(path) },
  },
  logger: mainLog,
})

// ===== MIG-EXT-01 v1.2.7 训练历史迁移 IPC（独立通道面；不触碰更新/归档绑定段） =====
// MIG-ONECLICK-01（2026-10-13 用户拍板）：设置页「从 v1.2.7 迁移」分栏退役，渲染端已无
// 调用方（preload 暴露面保留但无人 invoke）。底层 IPC 保留论证见
// docs/verification/2026-10/MIG-ONECLICK-01/README.md：preload.cts 不在本任务可写范围、
// 该通道有既有测试锁定且作为手动兜底无害。
// 渲染端经 preload 的 desktopMigration（pick/inspect/importHistory）触发：pick 弹原生文件
// 选择框选「训练历史迁移-…/迁移清单.json」；inspect 包体检；import 暂存 pending（重启生效）。
// databasePath 惰性取值（bootServerAndOpen 设置 migrationDatabasePath 后才可用，dev 窗口/
// 启动早期为 null → 结构化未就绪错误，渲染端如实呈现）。
async function pickMigrationManifestFile(): Promise<string | null> {
  const options = {
    title: '选择 v1.2.7 训练历史迁移清单',
    defaultPath: '迁移清单.json',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [{ name: '迁移清单（迁移清单.json）', extensions: ['json'] }],
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

registerMigrationIpc({
  ipcMain,
  pickManifestFile: pickMigrationManifestFile,
  databasePath: () => migrationDatabasePath,
  logger: mainLog,
})

// ===== GAP1-DIAG 诊断 IPC（desktop-diagnostics:invoke 单通道；preload 对应 desktopDiagnostics
// 窄对象的 copyDiagnostics）。facts 惰性取值：dataDir/日志尾部随启动进度生效，启动早期
// 调用＝结构化「日志尚未初始化」而非失败（与归档/迁移 IPC 同一惰性模式）。 =====
registerDiagnosticsIpc({
  ipcMain,
  clipboard,
  collectFacts: collectDiagnosticsFacts,
  logger: mainLog,
})

// ===== 启动 =====

async function bootServerAndOpen(): Promise<void> {
  // 便携 exe：electron-builder 注入 PORTABLE_EXECUTABLE_DIR＝exe 所在目录（用户选择的位置），
  // 与 zip「包根 data」语义对齐；开发/非便携回退 process.execPath 同级。
  // @deprecated INSTALL-01：便携形态退役后该来源只服务存量便携 exe 的回滚保护；exeDir 本体
  // 仍锚定采用记录 desktop-data-choice.json（dataDir 之外的固定点）与 appRoot 解析。
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim() || join(app.getAppPath(), '..', '..')
  const appRoot = app.getAppPath()

  // ---- PACK-03 步骤 1：首启数据发现/采用（INSTALL-01 收敛后唯一候选＝legacy-home，
  // ---- 决策层无询问路径——双候选对话框与其 env 应答注入随 exe-data 候选退役） ----
  const dataHome = await resolveDataHome(
    { envExplicit: hasExplicitDataOverride(process.env), paths: { exeDir, homeDir: homedir() } },
    createNodeDataHomeDeps({}),
  )
  if (dataHome.quit) {
    mainLog.log(`[desktop] ${dataHome.reason}`)
    app.quit()
    return
  }
  const { resolution, legacyConfig } = dataHome
  if (resolution.record) {
    try {
      await persistDataChoiceRecord(exeDir, resolution.record)
    } catch (error) {
      // 记录失败不阻断启动（下次会重新发现，结果相同）；如实记录
      mainLog.error('[desktop] data choice persist failed:', error)
    }
  }
  if (resolution.notice) {
    // 一次性提示 v1 收敛为 console（呈现类保守默认，收尾报告标注）：原生 dialog 实测两种形态
    // 均有硬伤——无父窗口（引导期）在 Windows 触发原生崩溃 0x80000003；挂主窗口则为模态，
    // 阻塞窗口关闭（冒烟/diag 关不掉需强杀）。窗口内提示（页面 toast 等）留待验收轮拍板。
    mainLog.log(`[desktop] ${resolution.notice}`)
  }

  // ---- PACK-03 步骤 2：saved-tdx-choice 沿用（env > 旧配置 > 采用目录内保存的选择） ----
  let savedTdxRoot: string | null = null
  const tdxFromEnv = process.env.TDX_ROOT?.trim() || null
  const tdxFromLegacy = legacyConfig?.tdxRoot ?? null
  if (!tdxFromEnv && !tdxFromLegacy) {
    // 搜索目录＝生效 dataDir（env 显式 TRAINER_DATA_DIR > 解析产物 > 唯一默认 legacy-home；纯函数已测）
    const effectiveDataDir = savedChoiceSearchDir(process.env, resolution, homedir())
    try {
      savedTdxRoot = parseSavedTdxChoice(JSON.parse(await readFile(join(effectiveDataDir, SAVED_TDX_CHOICE_FILE), 'utf8')))?.root ?? null
    } catch { savedTdxRoot = null }
  }

  // ---- 配置合并：env 显式 > 发现/旧配置产物（defaults）> 唯一默认 legacy-home（INSTALL-01） ----
  const config: DesktopRuntimeConfig = resolveDesktopConfig(process.env, { exeDir, appRoot, homeDir: homedir() }, {
    dataDir: resolution.dataDir ?? undefined,
    port: legacyConfig?.port,
    databasePath: legacyConfig?.databasePathExplicit
      ? legacyConfig.databasePath
      : (resolution.dataDir ? join(resolution.dataDir, LIBRARY_FILE) : undefined),
    tdxRoot: tdxFromLegacy ?? savedTdxRoot ?? undefined,
    tdxSource: tdxFromEnv ? 'env' : tdxFromLegacy ? 'explicit-config' : savedTdxRoot ? 'saved-choice' : undefined,
  })
  // GAP1-DIAG：生效数据目录一经解析即接入日志落盘 sink（此后的启动行进 <dataDir>/logs/main.log；
  // 复用分支同样生效——config 在分支前已解析；dev 窗口形态不解析 dataDir＝仅 console，已知边界）
  attachDiagLog(config.dataDir)
  windowStatePath = join(config.dataDir, WINDOW_STATE_FILE)
  // DATA-ARCH-01：归档目录跟生效数据目录（复用/reuse 分支同样生效——config 在分支前已解析）
  archiveDataDir = config.dataDir
  // MIG-EXT-01：迁移目标库跟生效数据目录的库路径（reuse 分支同样生效——只影响 IPC 只读面）
  migrationDatabasePath = config.databasePath
  // PORT-UPD-01：数据目录就绪——回填便携自更新 staging 根＋清理上次更新残留
  // （<dataDir>/update-staging 与用户 exe 旁 .old；非便携 no-op；失败不阻断启动）。
  // P0 修复：.old 残留 beside 用户实际启动的 exe（PORTABLE_EXECUTABLE_FILE），非 execPath
  // 临时副本旁——传入解析后的目标（cleanup 内部还会按 env fail-closed 复核）；
  // 解析失败仅记日志跳过清理（残留留待下次启动），绝不阻断启动。
  portableUpdateDataDir = config.dataDir
  try {
    const portableTargetExe = resolvePortableTargetExe(process.env, process.execPath)
    await cleanupPortableUpdateLeftovers({ env: process.env, dataDir: config.dataDir, exePath: portableTargetExe })
  } catch (error) {
    mainLog.error('[desktop] portable update leftover cleanup skipped:', error)
  }

  // ---- 端口决策（PORT-01/PORT-02 桌面版）：应答注入优先于 GUI 询问 ----
  const injectedAnswer = parseConflictAnswerEnv(process.env)
  const plan: PortPlan = await resolvePortPlan(config.port, {
    probeHealth: probeHealthHttp,
    bindCheck: bindCheckTcp,
    askConflict: injectedAnswer ? async () => injectedAnswer : askConflictDialog,
    killOccupant: killTrainerOccupant,
  })
  if (plan.action === 'quit') throw new Error(plan.reason)

  if (plan.action === 'reuse') {
    // 复用已有训练器服务：窗口直接加载其 URL，绝不启动第二个服务进程
    mainLog.log(`[desktop] reusing existing trainer at ${plan.url} (PID ${plan.occupant.pid})`)
    mainWindow = createWindow(plan.url, await loadWindowBounds())
    return
  }

  // ---- PACK-03 步骤 3：共存防线——launch.lock ＋ dataDir 状态记录裁决（zip/exe 双向防双写） ----
  // launcher 同法先确保数据目录存在（锁文件落在 dataDir 内；目录不可写＝启动失败如实呈现）
  try {
    await mkdir(config.dataDir, { recursive: true })
  } catch (error) {
    throw new Error(`数据目录不可用 / data directory is not usable: ${config.dataDir} (${error instanceof Error ? error.message : String(error)})`)
  }
  const lock = await acquireLaunchLock(launchLockPathOf(config.dataDir), nodeLaunchLockDeps())
  if (!lock.ok) throw new Error(lock.reason)
  let lockHeld = true
  try {
    const guard = await decideCoexistence(parseTrainerStateRecord(await readTrainerStateRaw(config.dataDir)), {
      pidAlive,
      probeHealth: probeHealthHttp,
      askConflict: injectedAnswer ? async () => injectedAnswer : askConflictDialog,
      killOccupant: killTrainerOccupant,
    })
    if (guard.action === 'quit') {
      if (guard.fatal) throw new Error(guard.reason)
      mainLog.log(`[desktop] ${guard.reason}`)
      app.quit()
      return
    }
    if (guard.action === 'reuse') {
      // 复用同库的已有训练器服务（zip launcher 等不占本端口的形态）：窗口加载其 URL，不启第二服务
      mainLog.log(`[desktop] reusing same-data-dir trainer at ${guard.url} (PID ${guard.occupant.pid})`)
      mainWindow = createWindow(guard.url, await loadWindowBounds())
      return
    }

    // proceed：注入 PORT-01 回退标记（页面常驻提示）＋实际端口，再组装隔离运行 env。
    // runId 预生成：状态记录 trainer-state.json 与内嵌服务 health 上报同源。
    // MIG-ONECLICK-01：一键迁移工具已把 v1.2.7 产物暂存到 <dataDir>/migrate-v127-import/
    // 时，先消费其训练历史半边（复用 stageHistoryImport 产 pending；失败保留暂存、
    // 下次启动自动重试，绝不阻断启动）——必须先于 applyPendingHistoryAtBoot 才能在
    // 本次启动完成归位。录像半边在窗口加载完成后注入（见下方 did-finish-load 接线）。
    try {
      const consumed = await consumeOneClickHistoryStaging(config.dataDir, config.databasePath)
      if (consumed.ran && consumed.ok) mainLog.log('[desktop] 一键迁移：v1.2.7 训练历史已暂存，本启动将合并应用（导入前自动备份）')
      else if (consumed.ran) mainLog.error('[desktop] 一键迁移：训练历史暂存失败（暂存保留，下次启动重试）:', consumed.error)
    } catch (error) {
      mainLog.error('[desktop] 一键迁移训练历史消费异常（下次启动自动重试）:', error)
    }
    // MIG-EXT-01 / MIG-MERGE-01：内嵌服务开库前应用上次会话暂存的 v1.2.7 训练历史
    // （统一合并：目标不存在＝pending 就位；存在＝合并导入——备份先行＋单事务＋幂等
    // 跳过＋ns 保留；失败目标零损伤、pending 保留下次自动重试——绝不阻断启动）。
    try {
      const applied = await applyPendingHistoryAtBoot(config.databasePath)
      if (applied.applied) mainLog.log(`[desktop] v1.2.7 训练历史迁移已在启动时合并应用（导入 ${applied.imported} 条、跳过已存在 ${applied.skipped} 条；原库已备份保留）`)
      else if (applied.error) mainLog.error(`[desktop] v1.2.7 训练历史迁移暂缓（${applied.reason}）:`, applied.error)
      else if (applied.reason !== 'none') mainLog.log(`[desktop] v1.2.7 训练历史迁移暂缓：${applied.reason}`)
    } catch (error) {
      mainLog.error('[desktop] v1.2.7 训练历史迁移应用异常（下次启动自动重试）:', error)
    }
    const runId = `run-${randomUUID()}`
    const effectiveConfig: DesktopRuntimeConfig = { ...config, port: plan.port }
    process.env.TRAINER_PORT_FALLBACK = portFallbackEnvValue(plan.fallback)
    // server loadConfig 在调用时读 process.env：先注入隔离运行 env 再动态导入入口。
    Object.assign(process.env, buildServerEnv(effectiveConfig, process.env, { runId }))
    const serverEntry = await import('../../server/dist/index.js')
    const started = await serverEntry.startTrainerServer()
    serverHandle = started
    serverRunning = true
    serverIdentity = { runId, pid: process.pid, dataDir: config.dataDir }
    // 反向防线：写 launcher 兼容状态记录，zip launcher decideRecordedServer 可识别并 reuse
    await writeTrainerStateFile(config.dataDir, buildStateRecord({
      runId,
      pid: process.pid,
      port: started.port,
      databasePath: config.databasePath,
    }))
    mainWindow = createWindow(buildAppUrl(started.port), await loadWindowBounds())
    // MIG-ONECLICK-01：一键迁移录像半边——页面加载完成后注入暂存的导入器脚本，
    // 在渲染端上下文把录像合并包写入本安装隔离的 IndexedDB（主进程无法直写；导入
    // 器与新版页面「导入录制」同链）。成功清理暂存；失败保留下次启动重试（幂等）。
    // 无一键暂存时 no-op，不触碰页面。did-finish-load 可能多次触发（刷新），runner
    // 以 manifest consumedAt 门控幂等。
    {
      const oneClickWindow = mainWindow
      oneClickWindow.webContents.on('did-finish-load', () => {
        void runOneClickRecordingImport({
          dataDir: config.dataDir,
          executeJavaScript: code => oneClickWindow.webContents.executeJavaScript(code),
        })
          .then(outcome => {
            if (!outcome.ran) return
            if (outcome.ok) {
              mainLog.log(`[desktop] 一键迁移：录像导入完成（成功 ${outcome.summary.imported ?? '?'} / 跳过 ${outcome.summary.skipped ?? '?'} / 失败 ${outcome.summary.failed ?? 0}）`)
            } else {
              mainLog.error('[desktop] 一键迁移：录像导入失败（暂存保留，下次启动重试）:', outcome.error)
            }
          })
          .catch(error => mainLog.error('[desktop] 一键迁移录像注入异常（下次启动重试）:', error))
      })
    }
  } finally {
    if (lockHeld) {
      lockHeld = false
      await rm(lock.path, { force: true }).catch(error => mainLog.error('[desktop] launch lock release failed:', error))
    }
  }
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  try {
    // PACK-04：更新 IPC 先于窗口（preload 启动即 invoke channel，主进程须已就绪）
    await setupUpdateChannel()
    const boot = planInstanceBoot({ hasLock: true, devWindowUrl: DEV_WINDOW_URL })
    if (boot.kind === 'quit') return // 不可达：无锁实例不进本函数（见文件尾单实例检查）
    if (boot.mode === 'dev-window') {
      windowStatePath = null
      mainWindow = createWindow(boot.url, null)
      return
    }
    await bootServerAndOpen()
  } catch (error) {
    mainLog.error('[desktop] startup failed:', error)
    dialog.showErrorBox('K线训练器启动失败', `${error instanceof Error ? error.message : String(error)}\n\n详细信息见控制台输出。`)
    app.quit()
  }
}

// ===== 优雅退出（DESKTOP-GRACEFUL-QUIT-DRAIN / DRAIN-TIMEOUT-FORCE / QUIT-NO-ORPHAN） =====

function runShutdownOnce(): Promise<void> {
  // shutdown 单飞幂等：重复触发共用同一次关闭（quit-state 保证 shutdown 动作至多发出一次，
  // 这里再兜底一层 started.shutdown 自身的 closing 单例语义）
  shutdownCall ??= (async () => {
    try {
      await serverHandle?.shutdown()
      // PACK-03：清理自有状态记录（身份复核；绝不删他人记录；失败仅日志不阻断退出）
      await clearOwnTrainerState()
    } catch (error) {
      mainLog.error('[desktop] server shutdown error:', error)
      throw error
    }
  })()
  return shutdownCall
}

function dispatchQuitEvent(event: Parameters<typeof nextQuitState>[1]): void {
  const transition = nextQuitState(quitState, event, serverRunning)
  quitState = transition.state
  for (const action of transition.actions) {
    if (action.call === 'prepare' && serverHandle) {
      // in-app 退出口径：未完成训练保留于 SQLite（与页面「保存并退出」同一冻结语义）
      void serverHandle.drain.prepare(action.attemptId, { allowActiveTraining: true })
        .then(outcome => dispatchQuitEvent({ type: 'drain-outcome', kind: outcome.kind as never }))
        .catch(error => dispatchQuitEvent({ type: 'shutdown-error', message: `prepare failed: ${String(error)}` }))
    } else if (action.call === 'shutdown') {
      void runShutdownOnce()
        .then(() => dispatchQuitEvent({ type: 'shutdown-done' }))
        .catch(error => dispatchQuitEvent({ type: 'shutdown-error', message: error instanceof Error ? error.message : String(error) }))
    } else if (action.call === 'exit') {
      // PACK-04：排空已收敛（exit 分支）且有待装更新 → 静默安装并装完自动重启；
      // forced（排空超时/外层超时）路径绝不安装（更新留缓存可重试）——resolveInstallActionOnExit。
      if (resolveInstallActionOnExit({ installPending: installPendingUpdate, forced: action.forced }) === 'quit-and-install') {
        installPendingUpdate = false
        sendUpdateEvent({ type: 'installing' })
        mainLog.log('[desktop] drained; installing downloaded update (quitAndInstall)')
        // UPD-QUIT-TYPEERROR-GUARD：适配器/底层（electron-updater 等）同步抛错不得逃逸出
        // exit 分支——逃逸＝异步链上的未捕获异常（teardown 窗口内即崩溃弹窗形态）或退出
        // 悬挂。就地记录并回落普通退出（更新留缓存可重试），绝不带病悬挂。
        try {
          updateAdapterRef?.quitAndInstall(true, true)
        } catch (error) {
          mainLog.error('[desktop] quitAndInstall threw synchronously; falling back to plain quit:', error instanceof Error ? error.message : String(error))
          app.quit()
        }
        return
      }
      if (action.forced) {
        mainLog.error(`[desktop] forced exit: ${action.reason ?? 'unknown'}`)
        app.exit(action.code)
      } else {
        app.quit()
      }
    }
  }
}

function requestGracefulQuit(): void {
  // 外层超时兜底：整个退出流程（排空＋关闭）超过预算 → outer-timeout → 强制退出并如实记录
  const timeoutMs = (() => {
    try {
      return resolveDrainTimeoutMs(process.env)
    } catch (error) {
      mainLog.error('[desktop] invalid TRAINER_DESKTOP_DRAIN_TIMEOUT_MS, using default:', error)
      return 15_000
    }
  })()
  setTimeout(() => dispatchQuitEvent({ type: 'outer-timeout' }), timeoutMs).unref()
  dispatchQuitEvent({ type: 'request-quit', attemptId: `desktop-${randomUUID()}` })
}

app.on('window-all-closed', () => { requestGracefulQuit() })
app.on('before-quit', () => {
  // OS 级退出（会话结束等）或 gracefulQuit 自身触发的 app.quit()：未走排空路径时兜底关闭服务
  if (quitState.phase === 'idle' && serverHandle) {
    mainLog.error('[desktop] before-quit reached without graceful drain; closing server as fallback')
    void runShutdownOnce().catch(() => { /* 已在 runShutdownOnce 内记录 */ })
  }
})

// ===== 单实例（锁检查先于一切启动分支；第二实例不启服务不开窗） =====

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  void bootstrap()
}
