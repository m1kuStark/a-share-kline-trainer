// PACK-04 更新 IPC 粘合（依赖注入 Electron API；vitest 经注入桩直接测——决策层在
// desktop-updates.ts，集成证据在 desktop-updates-fixture.test.ts＋冒烟阶段 H）。
// 通道面（UPD-DESKTOP-IPC-MINIMAL）：ipcMain.handle('desktop-update:invoke')（method 路由
// channel/checkForUpdates/downloadAndInstall）＋单向 'desktop-update:event'（main 侧 sendEvent
// 由调用方注入，本模块不触碰 BrowserWindow）。无其他 IPC 面。
// UPD-NOTIFY-01（v1.3.0）：packaged 形态每次启动自动执行一次版本检查（fire-and-forget，
// 不影响启动时序；静默失败——只 warn 不弹 UI）；发现新版经 onBootNotice 交 main 侧投递
// 渲染端首页提示；dev 形态跳过（开发环境启动不打更新源）。
// 可观测性缝（冒烟专用，off by default）：env TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT=<path>
// 且 packaged → 自动检查结果原子写该路径（只查不装；与 TRAINER_DESKTOP_CONFLICT_ANSWER
// 同类 env 注入缝，design §3.3）。
import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import {
  bootNoticeFromCheckView,
  shouldAutoCheckOnBoot,
  type DesktopUpdateCheckView,
  type DesktopUpdateController,
  type DesktopUpdateNotice,
} from './desktop-updates.js'

export interface UpdateIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
  }
  controller: DesktopUpdateController
  channelKind: 'packaged' | 'dev'
  /** boot 自动检查执行体（main 传 controller.checkForUpdates 的绑定） */
  runBootCheck: () => Promise<DesktopUpdateCheckView>
  bootCheckOutPath: string | null
  /**
   * CN-FEED-01 观测缝（off by default）：boot 检查的逐源尝试记录（镜像/GitHub 哪个
   * 成功、失败原因）——main 侧绑回退适配器的 lastAttempts()；落盘 JSON 追加 sources
   * 字段（字段名与形状＝proposed_default，W5 真机判断走了哪个源）。
   */
  bootCheckSources?: () => unknown
  /** UPD-NOTIFY-01：boot 自动检查发现新版时的通知出口（main 侧缓存并投递渲染端） */
  onBootNotice: (notice: DesktopUpdateNotice) => void
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

  // UPD-NOTIFY-01 boot 自动检查：一次性、fire-and-forget、静默失败（零打扰）；
  // 发现新版→onBootNotice；结果在设置可观测性缝时原子落盘供冒烟断言（失败也落盘）。
  if (!shouldAutoCheckOnBoot(channelKind)) return
  void deps.runBootCheck()
    .then(async view => {
      if (view.error !== null) {
        deps.logger.warn('[desktop] update boot check failed:', view.error)
      } else {
        const notice = bootNoticeFromCheckView(view)
        if (notice) deps.onBootNotice(notice)
      }
      const outPath = deps.bootCheckOutPath
      if (outPath) {
        const sources = deps.bootCheckSources?.()
        const temporary = `${outPath}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify({ channel: channelKind, ...view, ...(sources !== undefined ? { sources } : {}) }, null, 2)}\n`, 'utf8')
        await rename(temporary, outPath)
      }
    })
    .catch(async error => {
      deps.logger.warn('[desktop] update boot check failed:', error)
      const outPath = deps.bootCheckOutPath
      if (outPath) {
        const temporary = `${outPath}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify({ channel: channelKind, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, 'utf8').catch(() => {})
        await rename(temporary, outPath).catch(() => {})
      }
    })
}
