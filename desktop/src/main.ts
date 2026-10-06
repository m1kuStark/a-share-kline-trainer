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
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
import {
  createNodeDataHomeDeps,
  LIBRARY_FILE,
  parseDataHomeAnswerEnv,
  parseSavedTdxChoice,
  persistDataChoiceRecord,
  resolveDataHome,
  savedChoiceSearchDir,
  SAVED_TDX_CHOICE_FILE,
  type DataHomeAnswer,
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
  resolveInstallActionOnExit,
  resolveUpdateChannel,
  resolveUpdateFeed,
  type DesktopUpdateEvent,
} from './desktop-updates.js'
import { adaptElectronUpdater, defaultDesktopUpdater } from './update-adapter.js'
import { registerUpdateIpc } from './update-ipc.js'

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
/** 排空完成后待安装的新版（downloaded 事件置位；仅 exit 分支非 forced 路径消费） */
let installPendingUpdate = false
/** 更新事件下发：窗口已销毁/未建时丢弃并日志（下载可在窗口生命周期外进行） */
function sendUpdateEvent(event: DesktopUpdateEvent): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) {
    console.warn('[desktop] update event dropped (no live window):', event.type)
    return
  }
  try {
    win.webContents.send('desktop-update:event', event)
  } catch (error) {
    console.error('[desktop] update event send failed:', error)
  }
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

// ===== PACK-03 数据落点发现/采用＋共存防线（GUI 询问可注入，测试/冒烟不依赖 GUI） =====

const DATA_HOME_DIALOG = {
  title: '选择训练数据',
  message: '发现了两份训练数据',
  detail: (candidates: { exe: string; legacy: string }) =>
    `exe 旁数据目录：\n${candidates.exe}\n\n历史主目录数据：\n${candidates.legacy}\n\n`
    + '请选择本次及以后沿用的数据；「取消」＝退出且不做任何改动。',
  buttons: ['使用 exe 旁数据', '使用历史主目录数据', '取消'],
  defaultId: 0,
  cancelId: 2,
}

async function askDataHomeDialog(candidates: { exe: string; legacy: string }): Promise<DataHomeAnswer> {
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: DATA_HOME_DIALOG.title,
    message: DATA_HOME_DIALOG.message,
    detail: DATA_HOME_DIALOG.detail(candidates),
    buttons: DATA_HOME_DIALOG.buttons,
    defaultId: DATA_HOME_DIALOG.defaultId,
    cancelId: DATA_HOME_DIALOG.cancelId,
    noLink: true,
  })
  // 按钮序即应答序：0=exe / 1=legacy / 2=cancel（Esc/关闭＝cancelId→cancel）
  return (['exe', 'legacy', 'cancel'] as const)[choice.response]
}

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
    console.error('[desktop] state record cleanup failed:', error)
  }
}

// ===== PACK-04 更新通道接线（channel/adapter/IPC；安装走下方退出管线的 exit 分支） =====

let updateAdapterRef: { quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void } | null = null

async function setupUpdateChannel(): Promise<void> {
  const updater = await defaultDesktopUpdater()
  const adapter = adaptElectronUpdater(updater)
  adapter.setFeedURL(resolveUpdateFeed(process.env))
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
    logger: console,
  })
  registerUpdateIpc({
    ipcMain,
    controller,
    channelKind: updateChannelKind,
    runBootCheck: () => controller.checkForUpdates(),
    bootCheckOutPath: updateChannelKind === 'packaged'
      ? (process.env.TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT?.trim() || null)
      : null,
    logger: console,
  })
}

// ===== 启动 =====

async function bootServerAndOpen(): Promise<void> {
  // 便携 exe：electron-builder 注入 PORTABLE_EXECUTABLE_DIR＝exe 所在目录（用户选择的位置），
  // 与 zip「包根 data」语义对齐；开发/非便携回退 process.execPath 同级。
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim() || join(app.getAppPath(), '..', '..')
  const appRoot = app.getAppPath()

  // ---- PACK-03 步骤 1：首启数据发现/采用（adopt-in-place；env 注入应答优先于 GUI 询问） ----
  const injectedDataAnswer = parseDataHomeAnswerEnv(process.env)
  const dataHome = await resolveDataHome(
    { envExplicit: hasExplicitDataOverride(process.env), paths: { exeDir, homeDir: homedir() } },
    createNodeDataHomeDeps({ ask: injectedDataAnswer ? async () => injectedDataAnswer : askDataHomeDialog }),
  )
  if (dataHome.quit) {
    console.log(`[desktop] ${dataHome.reason}`)
    app.quit()
    return
  }
  const { resolution, legacyConfig } = dataHome
  if (resolution.record) {
    try {
      await persistDataChoiceRecord(exeDir, resolution.record)
    } catch (error) {
      // 记录失败不阻断启动（下次会重新发现，结果相同）；如实记录
      console.error('[desktop] data choice persist failed:', error)
    }
  }
  if (resolution.notice) {
    // 一次性提示 v1 收敛为 console（呈现类保守默认，收尾报告标注）：原生 dialog 实测两种形态
    // 均有硬伤——无父窗口（引导期）在 Windows 触发原生崩溃 0x80000003；挂主窗口则为模态，
    // 阻塞窗口关闭（冒烟/diag 关不掉需强杀）。窗口内提示（页面 toast 等）留待验收轮拍板。
    console.log(`[desktop] ${resolution.notice}`)
  }

  // ---- PACK-03 步骤 2：saved-tdx-choice 沿用（env > 旧配置 > 采用目录内保存的选择） ----
  let savedTdxRoot: string | null = null
  const tdxFromEnv = process.env.TDX_ROOT?.trim() || null
  const tdxFromLegacy = legacyConfig?.tdxRoot ?? null
  if (!tdxFromEnv && !tdxFromLegacy) {
    // 搜索目录＝生效 dataDir（env 显式 TRAINER_DATA_DIR > 解析产物 > 便携默认；纯函数已测）
    const effectiveDataDir = savedChoiceSearchDir(process.env, resolution, exeDir)
    try {
      savedTdxRoot = parseSavedTdxChoice(JSON.parse(await readFile(join(effectiveDataDir, SAVED_TDX_CHOICE_FILE), 'utf8')))?.root ?? null
    } catch { savedTdxRoot = null }
  }

  // ---- 配置合并：env 显式 > 发现/旧配置产物（defaults）> 便携默认 ----
  const config: DesktopRuntimeConfig = resolveDesktopConfig(process.env, { exeDir, appRoot }, {
    dataDir: resolution.dataDir ?? undefined,
    port: legacyConfig?.port,
    databasePath: legacyConfig?.databasePathExplicit
      ? legacyConfig.databasePath
      : (resolution.dataDir ? join(resolution.dataDir, LIBRARY_FILE) : undefined),
    tdxRoot: tdxFromLegacy ?? savedTdxRoot ?? undefined,
    tdxSource: tdxFromEnv ? 'env' : tdxFromLegacy ? 'explicit-config' : savedTdxRoot ? 'saved-choice' : undefined,
  })
  windowStatePath = join(config.dataDir, WINDOW_STATE_FILE)

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
    console.log(`[desktop] reusing existing trainer at ${plan.url} (PID ${plan.occupant.pid})`)
    mainWindow = createWindow(plan.url, await loadWindowBounds())
    return
  }

  // ---- PACK-03 步骤 3：共存防线——launch.lock ＋ dataDir 状态记录裁决（zip/exe 双向防双写） ----
  // launcher 同法先确保数据目录存在（锁文件落在 dataDir 内；目录不可写＝启动失败如实呈现）
  try {
    await mkdir(config.dataDir, { recursive: true })
  } catch (error) {
    throw new Error(`数据目录不可用 / data directory is not usable: ${config.dataDir} (${(error as Error).message})`)
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
      console.log(`[desktop] ${guard.reason}`)
      app.quit()
      return
    }
    if (guard.action === 'reuse') {
      // 复用同库的已有训练器服务（zip launcher 等不占本端口的形态）：窗口加载其 URL，不启第二服务
      console.log(`[desktop] reusing same-data-dir trainer at ${guard.url} (PID ${guard.occupant.pid})`)
      mainWindow = createWindow(guard.url, await loadWindowBounds())
      return
    }

    // proceed：注入 PORT-01 回退标记（页面常驻提示）＋实际端口，再组装隔离运行 env。
    // runId 预生成：状态记录 trainer-state.json 与内嵌服务 health 上报同源。
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
  } finally {
    if (lockHeld) {
      lockHeld = false
      await rm(lock.path, { force: true }).catch(error => console.error('[desktop] launch lock release failed:', error))
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
      // PACK-03：清理自有状态记录（身份复核；绝不删他人记录；失败仅日志不阻断退出）
      await clearOwnTrainerState()
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
      // PACK-04：排空已收敛（exit 分支）且有待装更新 → 静默安装并装完自动重启；
      // forced（排空超时/外层超时）路径绝不安装（更新留缓存可重试）——resolveInstallActionOnExit。
      if (resolveInstallActionOnExit({ installPending: installPendingUpdate, forced: action.forced }) === 'quit-and-install') {
        installPendingUpdate = false
        sendUpdateEvent({ type: 'installing' })
        console.log('[desktop] drained; installing downloaded update (quitAndInstall)')
        updateAdapterRef?.quitAndInstall(true, true)
        return
      }
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
