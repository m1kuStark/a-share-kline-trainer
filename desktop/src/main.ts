// PACK-02 Electron 主进程（完整生命周期；PACK-01 最小原型的升级）：
//   单实例锁（锁检查先于一切启动分支）→ 开发窗口模式（DESKTOP_DEV_URL）或
//   端口决策（PORT-01 自动回退/PORT-02 训练器占用三应答，应答可注入）→
//   进程内启动 Fastify server → BrowserWindow（bounds 记忆/最小尺寸/安全基线/外部链接系统浏览器）。
//   退出：窗口全关→冻结排空（in-app 口径，未完成训练保留 SQLite）→server close→app 退出；
//   超时（TRAINER_DESKTOP_DRAIN_TIMEOUT_MS，默认 15s）强制退出并如实记录。
// 决策逻辑全部抽在纯函数层（boot-plan/port-conflict/quit-state/window-bounds/external-links，
// vitest 覆盖）；本文件只做 Electron API 粘合，实机行为由 desktop/scripts/smoke-desktop.mjs 验证。
import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildAppUrl, buildServerEnv, resolveDesktopConfig, type DesktopRuntimeConfig } from './desktop-config.js'
import { planInstanceBoot } from './boot-plan.js'
import {
  bindCheckTcp,
  parseConflictAnswerEnv,
  portFallbackEnvValue,
  probeHealthHttp,
  resolvePortPlan,
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

const DEV_WINDOW_URL = process.env.DESKTOP_DEV_URL?.trim() || null
const WINDOW_TITLE = 'K线训练器'
const WINDOW_STATE_FILE = 'window-state.json'

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
      .catch(error => console.error('[desktop] window state persist failed:', error))
  } catch (error) {
    console.error('[desktop] window state persist failed:', error)
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
      void shell.openExternal(url).catch(error => console.error('[desktop] openExternal failed:', error))
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const disposition = classifyUrl(url, appOrigin)
    if (disposition === 'external') {
      event.preventDefault()
      void shell.openExternal(url).catch(error => console.error('[desktop] openExternal failed:', error))
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
    // 安全基线（PACK-02 决策⑥）：显式锁定 Electron 安全默认，不因后续升级漂移
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  // 页面自带 <title>A股 K线训练器</title> 会在加载后覆盖窗口标题；PACK-01 冻结窗口标题
  // 为「K线训练器」（派发简报原文），拒绝页面标题覆盖（proposed_default：标题固定策略）。
  win.on('page-title-updated', event => { event.preventDefault() })
  win.once('ready-to-show', () => { win.show() })
  win.on('close', () => { rememberWindowBounds() })
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
  // PORT-02 口径：身份已复核（resolvePortPlan 内），这里只负责结束该 PID 并等退出。
  // Windows 上 process.kill(pid)＝硬终止（与 launcher 对 node 服务的处理等量级）。
  try {
    process.kill(occupant.pid)
  } catch (error) {
    // ESRCH＝进程已消失＝目标达成；其他错误（EPERM 等）如实上报
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      return { exited: false, error: String((error as Error)?.message ?? error) }
    }
  }
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      process.kill(occupant.pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return { exited: true }
    }
    if (Date.now() > deadline) return { exited: false, error: `PID ${occupant.pid} did not exit within 5000ms` }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
}

// ===== 启动 =====

async function bootServerAndOpen(): Promise<void> {
  // 便携 exe：electron-builder 注入 PORTABLE_EXECUTABLE_DIR＝exe 所在目录（用户选择的位置），
  // 与 zip「包根 data」语义对齐；开发/非便携回退 process.execPath 同级。
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim() || join(app.getAppPath(), '..', '..')
  const config = resolveDesktopConfig(process.env, { exeDir, appRoot: app.getAppPath() })
  windowStatePath = join(config.dataDir, WINDOW_STATE_FILE)

  // 端口决策（PORT-01/PORT-02 桌面版）：应答注入优先于 GUI 询问
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
    console.log(`[desktop] reusing existing trainer at ${plan.url} (PID ${plan.occupant.pid})`)
    mainWindow = createWindow(plan.url, await loadWindowBounds())
    return
  }

  // start：注入 PORT-01 回退标记（页面常驻提示）＋实际端口，再组装隔离运行 env
  const effectiveConfig: DesktopRuntimeConfig = { ...config, port: plan.port }
  process.env.TRAINER_PORT_FALLBACK = portFallbackEnvValue(plan.fallback)
  // server loadConfig 在调用时读 process.env：先注入隔离运行 env 再动态导入入口。
  Object.assign(process.env, buildServerEnv(effectiveConfig, process.env))
  const serverEntry = await import('../../server/dist/index.js')
  const started = await serverEntry.startTrainerServer()
  serverHandle = started
  serverRunning = true
  mainWindow = createWindow(buildAppUrl(started.port), await loadWindowBounds())
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  try {
    const boot = planInstanceBoot({ hasLock: true, devWindowUrl: DEV_WINDOW_URL })
    if (boot.kind === 'quit') return // 不可达：无锁实例不进本函数（见文件尾单实例检查）
    if (boot.mode === 'dev-window') {
      windowStatePath = null
      mainWindow = createWindow(boot.url, null)
      return
    }
    await bootServerAndOpen()
  } catch (error) {
    console.error('[desktop] startup failed:', error)
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
    } catch (error) {
      console.error('[desktop] server shutdown error:', error)
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
      if (action.forced) {
        console.error(`[desktop] forced exit: ${action.reason ?? 'unknown'}`)
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
      console.error('[desktop] invalid TRAINER_DESKTOP_DRAIN_TIMEOUT_MS, using default:', error)
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
    console.error('[desktop] before-quit reached without graceful drain; closing server as fallback')
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
