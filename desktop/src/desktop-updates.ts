// PACK-04 桌面更新通道·纯决策与载荷层（不 import electron，vitest 直接测）。
// 口径来源＝PACK-04 派发简报设计决策＋docs/verification/2026-10/PACK-04/design.md：
//   - 双通道：packaged（app.isPackaged）→ electron-updater；dev/源码 → 既有 UPD HTTP 端点
//   - check 视图与 UPD-01 契约 §2.1 同形；updateAvailable 复用 server version.ts 三段十进制
//     口径（单一版本口径，经编译产物只读 import）
//   - 安装必经排空退出管线（requestInstallWithDrain），controller 绝不直接 quitAndInstall；
//     forced 退出（排空超时）绝不安装（resolveInstallActionOnExit）
//   - feed 可注入（env TRAINER_DESKTOP_UPDATE_FEED→generic；缺省 GitHub provider 常量）
import { compareVersions } from '../../server/dist/update/version.js'

export type DesktopUpdateChannelKind = 'packaged' | 'dev'

/** PACK-04 §2.3：与 UPD HTTP check 同形的 IPC check 视图（camelCase） */
export interface DesktopUpdateCheckView {
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  releaseNotes: string | null
  error: string | null
}

export type DesktopUpdateEvent =
  | { type: 'download-progress', percent: number, transferred: number, total: number, bytesPerSecond: number }
  | { type: 'downloaded', version: string }
  | { type: 'installing' }
  | { type: 'error', message: string }

/** 缺省 GitHub provider（与 package.json repository 同源；PACK-05 落实发布资产） */
export const DEFAULT_GITHUB_FEED = { provider: 'github', owner: 'm1kuStark', repo: 'a-share-kline-trainer' } as const

export function resolveUpdateChannel(input: { isPackaged: boolean }): DesktopUpdateChannelKind {
  return input.isPackaged ? 'packaged' : 'dev'
}

export type UpdateFeed = { provider: 'github', owner: string, repo: string } | { provider: 'generic', url: string }

/** env TRAINER_DESKTOP_UPDATE_FEED（http(s) URL，trim 非空即用）> GitHub 常量 */
export function resolveUpdateFeed(env: NodeJS.ProcessEnv): UpdateFeed {
  const injected = typeof env.TRAINER_DESKTOP_UPDATE_FEED === 'string' ? env.TRAINER_DESKTOP_UPDATE_FEED.trim() : ''
  if (injected !== '') return { provider: 'generic', url: injected }
  return { ...DEFAULT_GITHUB_FEED }
}

export interface MapCheckViewInput {
  currentVersion: string | null
  latestVersion: string | null
  releaseNotes: string | null
  error?: string | null
}

/**
 * check 视图组装（design §2.3）：error 优先且不做部分判读（对齐 UPD-CHECK-OFFLINE
 * 「不部分解读坏清单」）；版本比较用 server version.ts compareVersions（v 前缀容忍，
 * 1.2.10>1.2.9 三段十进制）；不可比较→人话 error 不猜。
 */
export function mapCheckView(input: MapCheckViewInput): DesktopUpdateCheckView {
  const currentVersion = input.currentVersion
  if (input.error && input.error.trim() !== '') {
    return { currentVersion, latestVersion: null, updateAvailable: false, releaseNotes: null, error: input.error }
  }
  if (currentVersion === null || input.latestVersion === null) {
    return {
      currentVersion, latestVersion: input.latestVersion, updateAvailable: false, releaseNotes: null,
      error: currentVersion === null ? '无法确定当前版本，不能判断更新' : null,
    }
  }
  try {
    const available = compareVersions(input.latestVersion, currentVersion) > 0
    return {
      currentVersion, latestVersion: input.latestVersion, updateAvailable: available,
      releaseNotes: input.releaseNotes, error: null,
    }
  } catch (error) {
    return {
      currentVersion, latestVersion: null, updateAvailable: false, releaseNotes: null,
      error: `无法比较的版本号（${currentVersion} vs ${input.latestVersion}）：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** electron-updater 错误 → 人话中文（清单缺失/网络错/其余 message 直传截断） */
export function normalizeUpdaterError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(message)) {
    return `无法检查更新：更新源未提供 latest.yml（${message.slice(0, 200)}）`
  }
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || /network|fetch failed|ECONNRESET/i.test(message)) {
    return `无法检查更新：网络错误（${message.slice(0, 200)}）`
  }
  return message.slice(0, 500)
}

/**
 * 退出分支安装裁决（design §3.2）：forced（排空超时/外层超时兜底）绝不带病安装
 * （plain-quit，更新留 electron-updater 缓存可重试）；正常收敛且有待装更新才安装。
 */
export function resolveInstallActionOnExit(input: { installPending: boolean, forced: boolean }): 'quit-and-install' | 'plain-quit' {
  return input.installPending && !input.forced ? 'quit-and-install' : 'plain-quit'
}

/** 主进程侧 updater 适配器（main 绑 autoUpdater；测试绑真实 NsisUpdater 或桩） */
export interface DesktopUpdaterAdapter {
  setFeedURL(feed: UpdateFeed): void
  /** 拒绝＝检查失败（网络/清单缺失等）；resolve 携带最新版本信息（update-not-available 也 resolve） */
  checkForUpdates(): Promise<{ updateAvailable: boolean, version: string, releaseNotes: string | null }>
  /** 拒绝＝下载失败（渲染端可重试）；resolve＝下载完成 */
  downloadUpdate(): Promise<{ version: string }>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
  onDownloadProgress(callback: (progress: { percent: number, transferred: number, total: number, bytesPerSecond: number }) => void): void
}

export interface DesktopUpdateControllerDeps {
  adapter: DesktopUpdaterAdapter
  /** 当前版本（main 侧＝app.getVersion()＝包根 package.json version；测试注入常量） */
  getCurrentVersion: () => string | null
  sendEvent: (event: DesktopUpdateEvent) => void
  /** 下载完成后发起「排空→安装」请求（main 侧绑定退出管线；controller 绝不直接 quitAndInstall） */
  requestInstallWithDrain: () => void
  logger: { error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void }
}

export interface DesktopUpdateController {
  checkForUpdates(): Promise<DesktopUpdateCheckView>
  downloadAndInstall(): Promise<{ ok: true } | { ok: false, error: string }>
}

/**
 * 更新编排（design §3.1）：手动检查＋下载→排空安装；下载失败发 error 事件并可重试。
 * 版本可用性判定走 mapCheckView（compareVersions 单一口径），adapter 的 updateAvailable
 * 仅作参考，不一致时以我方口径为准并记 warn。
 */
export function createDesktopUpdateController(deps: DesktopUpdateControllerDeps): DesktopUpdateController {
  const { adapter, getCurrentVersion, sendEvent, requestInstallWithDrain, logger } = deps
  let checked = false
  let downloading = false

  adapter.onDownloadProgress(progress => {
    sendEvent({ type: 'download-progress', ...progress })
  })

  return {
    async checkForUpdates(): Promise<DesktopUpdateCheckView> {
      try {
        const result = await adapter.checkForUpdates()
        const view = mapCheckView({
          currentVersion: getCurrentVersion(),
          latestVersion: result.version,
          releaseNotes: result.releaseNotes,
        })
        if (view.updateAvailable !== result.updateAvailable) {
          logger.warn(`[desktop-updates] availability mismatch (ours=${view.updateAvailable} updater=${result.updateAvailable}); ours wins`)
        }
        checked = view.updateAvailable
        return view
      } catch (error) {
        return mapCheckView({ currentVersion: getCurrentVersion(), latestVersion: null, releaseNotes: null, error: normalizeUpdaterError(error) })
      }
    },

    async downloadAndInstall(): Promise<{ ok: true } | { ok: false, error: string }> {
      if (downloading) return { ok: false, error: '更新已在进行中' }
      if (!checked) return { ok: false, error: '请先检查更新' }
      downloading = true
      try {
        const outcome = await adapter.downloadUpdate()
        sendEvent({ type: 'downloaded', version: outcome.version })
        // 安装统一走排空退出管线（design §3.2）：controller 不直接 quitAndInstall
        requestInstallWithDrain()
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendEvent({ type: 'error', message: message.slice(0, 500) })
        return { ok: false, error: message.slice(0, 500) }
      } finally {
        downloading = false
      }
    },
  }
}
