// PACK-04 更新 IPC 粘合（依赖注入 Electron API；vitest 不 import 本文件——决策层在
// desktop-updates.ts，集成证据在 desktop-updates-fixture.test.ts＋冒烟阶段 H）。
// 通道面（UPD-DESKTOP-IPC-MINIMAL）：ipcMain.handle('desktop-update:invoke')（method 路由
// channel/checkForUpdates/downloadAndInstall）＋单向 'desktop-update:event'（main 侧 sendEvent
// 由调用方注入，本模块不触碰 BrowserWindow）。无其他 IPC 面。
// 可观测性缝（冒烟专用，off by default）：env TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT=<path>
// 且 packaged → 启动后做一次 checkForUpdates 并把结果原子写该路径（只查不装、不自动检查；
// 与 TRAINER_DESKTOP_CONFLICT_ANSWER 同类 env 注入缝，design §3.3）。
import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import type { DesktopUpdateCheckView, DesktopUpdateController } from './desktop-updates.js'

export interface UpdateIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
  }
  controller: DesktopUpdateController
  channelKind: 'packaged' | 'dev'
  /** 冒烟可观测性缝用：执行一次 check（main 传 controller.checkForUpdates 的绑定） */
  runBootCheck: () => Promise<DesktopUpdateCheckView>
  bootCheckOutPath: string | null
  logger: { error(...args: unknown[]): void, warn(...args: unknown[]): void }
}

export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  const { ipcMain, controller, channelKind } = deps

  ipcMain.handle('desktop-update:invoke', (_event, request) => {
    const method = (request as { method?: unknown } | null)?.method
    if (method === 'channel') return { kind: channelKind }
    if (method === 'checkForUpdates') return controller.checkForUpdates()
    if (method === 'downloadAndInstall') return controller.downloadAndInstall()
    return { ok: false, error: `未知的更新 IPC 方法：${String(method)}` }
  })

  // 冒烟可观测性缝：一次性、只查不装、结果原子落盘（失败也落盘供冒烟断言）
  if (deps.bootCheckOutPath) {
    const outPath = deps.bootCheckOutPath
    void deps.runBootCheck()
      .then(async view => {
        const temporary = `${outPath}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify({ channel: channelKind, ...view }, null, 2)}\n`, 'utf8')
        await rename(temporary, outPath)
      })
      .catch(async error => {
        const temporary = `${outPath}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify({ channel: channelKind, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, 'utf8').catch(() => {})
        await rename(temporary, outPath).catch(() => {})
        deps.logger.error('[desktop] update boot check failed:', error)
      })
  }
}
