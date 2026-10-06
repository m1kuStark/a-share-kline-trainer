// PACK-01 Electron 主进程（最小原型）：
// 单实例锁（基础版，完整生命周期 PACK-02）→ 进程内启动 Fastify server（架构师选型，
// spike 实测 Electron 44.5.1 内置 Node 24.21.0 满足 engines>=24 与 node:sqlite）→
// BrowserWindow 加载 http://127.0.0.1:<port>，标题「K线训练器」。
// 开发窗口模式（DESKTOP_DEV_URL）：只开窗口不内嵌服务，复用 dev:server＋vite 代理。
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { buildAppUrl, buildServerEnv, resolveDesktopConfig } from './desktop-config.js'

const DEV_WINDOW_URL = process.env.DESKTOP_DEV_URL?.trim() || null
const WINDOW_TITLE = 'K线训练器'

let mainWindow: BrowserWindow | null = null
let serverHandle: { shutdown(): Promise<void> } | null = null
let booting: Promise<void> | null = null

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    title: WINDOW_TITLE,
    autoHideMenuBar: true,
    show: false,
  })
  // 页面自带 <title>A股 K线训练器</title> 会在加载后覆盖窗口标题；PACK-01 冻结窗口标题
  // 为「K线训练器」（派发简报原文），拒绝页面标题覆盖（proposed_default：标题固定策略）。
  win.on('page-title-updated', event => { event.preventDefault() })
  win.once('ready-to-show', () => { win.show() })
  void win.loadURL(url)
  return win
}

async function bootServerAndOpen(): Promise<void> {
  // 便携 exe：electron-builder 注入 PORTABLE_EXECUTABLE_DIR＝exe 所在目录（用户选择的位置），
  // 与 zip「包根 data」语义对齐；开发/非便携回退 process.execPath 同级。
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim() || join(app.getAppPath(), '..', '..')
  const config = resolveDesktopConfig(process.env, { exeDir, appRoot: app.getAppPath() })
  // server loadConfig 在调用时读 process.env：先注入隔离运行 env 再动态导入入口。
  Object.assign(process.env, buildServerEnv(config, process.env))
  const serverEntry = await import('../../server/dist/index.js')
  const started = await serverEntry.startTrainerServer()
  serverHandle = started
  mainWindow = createWindow(buildAppUrl(started.port))
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  booting = (async () => {
    try {
      if (DEV_WINDOW_URL) {
        mainWindow = createWindow(DEV_WINDOW_URL)
        return
      }
      await bootServerAndOpen()
    } catch (error) {
      console.error('[desktop] startup failed:', error)
      dialog.showErrorBox('K线训练器启动失败', `${error instanceof Error ? error.message : String(error)}\n\n详细信息见控制台输出。`)
      app.quit()
    }
  })()
  return booting
}

async function shutdownServer(): Promise<void> {
  try {
    await serverHandle?.shutdown()
  } catch (error) {
    console.error('[desktop] server shutdown error:', error)
  } finally {
    serverHandle = null
  }
}

app.on('window-all-closed', () => { void shutdownServer().finally(() => app.quit()) })
app.on('before-quit', () => { void shutdownServer() })

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 基础版聚焦：完整生命周期（含最小化/托盘恢复）属 PACK-02
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  void bootstrap()
}
