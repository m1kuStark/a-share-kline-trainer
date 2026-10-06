// PACK-04 electron-updater 适配层（薄绑定，无业务逻辑；决策在 desktop-updates.ts）。
// 依赖注入形态：本模块不 import electron——接受任意满足 ElectronUpdaterLike 的 updater
// 实例（main 传 electron-updater 的 autoUpdater；vitest fixture 传注入 AppAdapter 的
// 真实 NsisUpdater），因此可在 node 环境直接集成测试（design §1.2-6）。
// 手动语义（design §1.2-8）：autoDownload=false（检查不自动下载）＋
// autoInstallOnAppQuit=false（安装必经我们的排空退出管线，不被 Electron 退出钩子绕过）。
import type { DesktopUpdaterAdapter, UpdateFeed } from './desktop-updates.js'

/** electron-updater AppUpdater 的结构子集（本适配层用到的面；测试以 NsisUpdater 实例满足） */
export interface ElectronUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL(options: unknown): void
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean
    updateInfo: { version: string, releaseNotes?: string | Array<{ note?: string }> | null }
  } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', listener: (progress: ProgressInfoLike) => void): unknown
}

interface ProgressInfoLike {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

/** releaseNotes 归一：string 直传；GitHub fullChangelog 的分段数组拼接；缺省 null */
function normalizeReleaseNotes(notes: string | Array<{ note?: string }> | null | undefined): string | null {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    const joined = notes.map(item => (typeof item?.note === 'string' ? item.note : '')).join('\n').trim()
    return joined === '' ? null : joined
  }
  return null
}

export function adaptElectronUpdater(updater: ElectronUpdaterLike): DesktopUpdaterAdapter {
  // 手动检查不自动下载；安装必经排空管线（autoInstallOnAppQuit 缺省 true 会绕过排空）
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  let lastCheckedVersion: string | null = null
  let lastCheckedNotes: string | null = null

  return {
    setFeedURL(feed: UpdateFeed): void {
      updater.setFeedURL(feed.provider === 'generic' ? feed.url : { provider: 'github', owner: feed.owner, repo: feed.repo })
    },

    async checkForUpdates() {
      const result = await updater.checkForUpdates()
      if (!result) {
        // isUpdaterActive=false（未打包且未 forceDev）——主进程只在 packaged 通道接线，防御性人话
        throw new Error('当前运行方式不支持更新检查（updater inactive）')
      }
      lastCheckedVersion = result.updateInfo.version
      lastCheckedNotes = normalizeReleaseNotes(result.updateInfo.releaseNotes)
      return {
        updateAvailable: result.isUpdateAvailable,
        version: result.updateInfo.version,
        releaseNotes: lastCheckedNotes,
      }
    },

    async downloadUpdate() {
      await updater.downloadUpdate()
      // 下载的版本＝最近一次 check 的版本（controller 流程保证 download 必跟 check）
      const version = lastCheckedVersion ?? ''
      lastCheckedNotes = lastCheckedNotes // 保留给后续 check 呈现
      return { version }
    },

    quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
      updater.quitAndInstall(isSilent, isForceRunAfter)
    },

    onDownloadProgress(callback): void {
      updater.on('download-progress', progress => {
        callback({
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        })
      })
    },
  }
}

/** main 进程缺省实例绑定（此处才触碰 electron-updater 单例）。
 *  取法陷阱（2026-10-05 实测）：out/main.js 以 Object.defineProperty getter 导出 autoUpdater
 *  （惰性构造）——ESM 具名导入在 CJS interop 下拿不到该 getter（值为 undefined，冒烟阶段 A
 *  曾因此崩：Cannot set properties of undefined (setting 'autoDownload')）——必须经
 *  module.default.autoUpdater 通道取实例。 */
export async function defaultDesktopUpdater(): Promise<ElectronUpdaterLike> {
  const module = await import('electron-updater')
  const holder = (module as { default?: { autoUpdater?: unknown } }).default ?? (module as unknown as { autoUpdater?: unknown })
  const updater = (holder as { autoUpdater?: unknown }).autoUpdater
  if (updater === undefined || updater === null) {
    throw new Error('electron-updater autoUpdater 不可用（CJS getter 导出未能解析）')
  }
  return updater as ElectronUpdaterLike
}
