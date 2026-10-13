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
  // UPD-NOTIFY-01（v1.3.0）：boot 自动检查发现新版本→渲染端首页提示（经既有
  // 'desktop-update:event' 单向事件面，不新增 IPC 通道/preload 成员）
  | { type: 'update-available-notice', version: string, releaseNotes: string | null }
  // DL-HANG-01（UPD-DL-START-CONFIRM）：downloadAndInstall 进入即发出——使「下载已触发」
  // 对渲染端与日志观测缝立即可区分（真机 20 分钟死寂时无法区分未启动/卡住）
  | { type: 'download-started' }

/** UPD-NOTIFY-01：首页更新提示载荷（boot 自动检查发现新版时经事件面下发） */
export type DesktopUpdateNotice = { version: string, releaseNotes: string | null }

/**
 * boot 自动检查口径（UPD-NOTIFY-01，用户 2026-10-11 原话「每次启动都要进行一次版本更新
 * 检查」）：仅 packaged 通道每次启动检查一次（不加间隔）；dev 形态跳过——开发窗口每次
 * 启动都打更新源没有意义。
 */
export function shouldAutoCheckOnBoot(channelKind: DesktopUpdateChannelKind): boolean {
  return channelKind === 'packaged'
}

/**
 * boot 检查视图→首页提示载荷：只有干净的有新版视图才产生通知（失败/已是最新/坏视图
 * 一律 null——零打扰，且不做部分判读，对齐 UPD-CHECK-OFFLINE 口径）。该视图同时会把
 * controller 的 checked 置位（boot 检查算一次有效检查，跳转分栏后可直接「下载并更新」）。
 */
export function bootNoticeFromCheckView(view: DesktopUpdateCheckView): DesktopUpdateNotice | null {
  if (view.error !== null || !view.updateAvailable || view.latestVersion === null) return null
  return { version: view.latestVersion, releaseNotes: view.releaseNotes }
}

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
  /**
   * 拒绝＝下载失败（渲染端可重试）；resolve＝下载完成。
   * DL-HANG-01：可选中止句柄（尽力中止——electron-updater 链转 CancellationToken；
   * 网络层挂死时底层可能不响应，看门狗在 controller 层独立收敛，不依赖本参数生效）。
   */
  downloadUpdate(cancellation?: DownloadCancellation): Promise<{ version: string }>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
  onDownloadProgress(callback: (progress: { percent: number, transferred: number, total: number, bytesPerSecond: number }) => void): void
}

/**
 * DL-HANG-01（UPD-DL-WATCHDOG）：下载中止句柄——controller 看门狗触发时 cancel；
 * 适配层消费 whenCancelled 转底层取消机制。cancelled 标志供各层快速判定。
 */
export interface DownloadCancellation {
  readonly cancelled: boolean
  readonly whenCancelled: Promise<void>
  cancel(): void
}

export function createDownloadCancellation(): DownloadCancellation {
  let resolveCancelled: () => void = () => {}
  const whenCancelled = new Promise<void>(resolve => { resolveCancelled = resolve })
  let cancelled = false
  return {
    get cancelled() { return cancelled },
    whenCancelled,
    cancel() {
      if (cancelled) return
      cancelled = true
      resolveCancelled()
    },
  }
}

/** DL-HANG-01：停滞看门狗缺省阈值（90 秒无任何进度事件；proposed_default 待追认） */
export const DOWNLOAD_STALL_TIMEOUT_MS = 90_000

/**
 * 阈值解析：env TRAINER_DESKTOP_DL_STALL_MS（正整数毫秒）可覆盖（测试/诊断注入小值）；
 * 空/非数字/0/负一律回默认——坏 env 不允许关掉看门狗（fail-safe）。
 */
export function resolveDownloadStallTimeoutMs(env: NodeJS.ProcessEnv, defaultMs: number = DOWNLOAD_STALL_TIMEOUT_MS): number {
  const raw = typeof env.TRAINER_DESKTOP_DL_STALL_MS === 'string' ? env.TRAINER_DESKTOP_DL_STALL_MS.trim() : ''
  if (raw === '') return defaultMs
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return defaultMs
}

/** 停滞失败人话（含已等待总时长＋网络提示＋重试指引；文案＝proposed_default） */
export function downloadStallMessage(waitedMs: number): string {
  const seconds = Math.max(1, Math.ceil(waitedMs / 1000))
  return `下载停滞：已等待 ${seconds} 秒没有任何进度。可能是网络不稳定或更新源暂时无法访问，请检查网络后重试`
}

export interface DesktopUpdateControllerDeps {
  adapter: DesktopUpdaterAdapter
  /** 当前版本（main 侧＝app.getVersion()＝包根 package.json version；测试注入常量） */
  getCurrentVersion: () => string | null
  sendEvent: (event: DesktopUpdateEvent) => void
  /** 下载完成后发起「排空→安装」请求（main 侧绑定退出管线；controller 绝不直接 quitAndInstall） */
  requestInstallWithDrain: () => void
  logger: { error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void }
  /**
   * DL-HANG-01（UPD-DL-WATCHDOG）：停滞看门狗阈值毫秒（缺省 resolveDownloadStallTimeoutMs
   * ＝90s 或 env 覆盖；测试注入小值——时间可注入，不真等 90s）。
   */
  stallTimeoutMs?: number
}

/** 看门狗运行态（一次 downloadAndInstall 一份；progress 推进即重置定时器） */
interface StallWatchdogState {
  startedAt: number
  lastActivityAt: number
  timer: ReturnType<typeof setTimeout> | null
  fired: boolean
  rejectStall: ((error: Error) => void) | null
  pendingDownload: Promise<{ version: string }> | null
  cancellation: DownloadCancellation
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
  const stallTimeoutMs = deps.stallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS
  let checked = false
  let downloading = false
  let watchdog: StallWatchdogState | null = null

  function stopStallWatchdog(): void {
    if (watchdog !== null && watchdog.timer !== null) {
      clearTimeout(watchdog.timer)
    }
    watchdog = null
  }

  function fireStall(state: StallWatchdogState): void {
    if (state.fired || watchdog !== state) return
    state.fired = true
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    // 尽力中止底层下载（electron-updater 链经 cancellation→CancellationToken；网络层
    // 挂死不响应时看门狗仍独立收敛——不依赖本调用生效）
    state.cancellation.cancel()
    state.rejectStall?.(new Error(downloadStallMessage(Date.now() - state.startedAt)))
  }

  adapter.onDownloadProgress(progress => {
    sendEvent({ type: 'download-progress', ...progress })
    // DL-HANG-01：进度推进即重置看门狗（字节在走＝没停滞）
    if (watchdog !== null && !watchdog.fired && watchdog.timer !== null) {
      watchdog.lastActivityAt = Date.now()
      clearTimeout(watchdog.timer)
      watchdog.timer = setTimeout(() => fireStall(watchdog as StallWatchdogState), stallTimeoutMs)
    }
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
      // UPD-DL-RETRY-AFTER-STALL：清上一轮残留（定时器/中止句柄引用），重走完整链
      stopStallWatchdog()
      const cancellation = createDownloadCancellation()
      const state: StallWatchdogState = {
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        timer: null,
        fired: false,
        rejectStall: null,
        pendingDownload: null,
        cancellation,
      }
      watchdog = state
      // UPD-DL-START-CONFIRM：进入即发启动事件＋日志观测缝（「下载未开始」可区分；
      // 不等下载完成，事件毫秒级到达渲染端）
      sendEvent({ type: 'download-started' })
      logger.info(`[desktop-updates] download started (stall watchdog ${stallTimeoutMs}ms)`)
      const stallPromise = new Promise<never>((_, reject) => { state.rejectStall = reject })
      state.timer = setTimeout(() => fireStall(state), stallTimeoutMs)
      try {
        const downloadPromise = adapter.downloadUpdate(cancellation)
        state.pendingDownload = downloadPromise
        // 停滞已判后的晚到 settle 兜底吞掉＋记日志（绝不 unhandledRejection）
        void downloadPromise.then(
          outcome => {
            if (state.fired) logger.warn(`[desktop-updates] stalled download settled late (version ${outcome.version}); result ignored`)
          },
          error => {
            if (state.fired) logger.warn(`[desktop-updates] stalled download rejected late: ${error instanceof Error ? error.message : String(error)}`)
          },
        )
        // 看门狗独立收敛：stall reject 不依赖 downloadUpdate settle（真机挂起形态的根治点）
        const outcome = await Promise.race([downloadPromise, stallPromise])
        sendEvent({ type: 'downloaded', version: outcome.version })
        // 安装统一走排空退出管线（design §3.2）：controller 不直接 quitAndInstall
        requestInstallWithDrain()
        return { ok: true }
      } catch (error) {
        if (state.fired) {
          const message = error instanceof Error ? error.message : downloadStallMessage(Date.now() - state.startedAt)
          sendEvent({ type: 'error', message: message.slice(0, 500) })
          logger.error(`[desktop-updates] ${message}`)
          return { ok: false, error: message.slice(0, 500) }
        }
        const message = error instanceof Error ? error.message : String(error)
        sendEvent({ type: 'error', message: message.slice(0, 500) })
        return { ok: false, error: message.slice(0, 500) }
      } finally {
        if (watchdog === state) stopStallWatchdog()
        downloading = false
      }
    },
  }
}
