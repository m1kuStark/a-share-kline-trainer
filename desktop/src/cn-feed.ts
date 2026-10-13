// CN-FEED-01（矩阵行 UPD-CN-FALLBACK-DESKTOP / UPD-FEED-SETTING desktop 侧）：国内镜像
// feed 优先＋回退官方 GitHub 的 electron-updater 链（纯决策＋适配器包装层，不 import
// electron；真实 NsisUpdater 行为零改动——本层只在检查前逐源 setFeedURL）。
// 用户拍板（2026-10-13）：不能依赖 github 链接提供下载资源，应提供纯国内网络也能正常
// 更新的发布路径；镜像常量未上线（空串）时回退链退化为纯 GitHub（行为安全）。
// 常量同源：CN_MIRROR_BASE 唯一落点＝server/src/update/manifest.ts（编译产物 import，
// 沿 desktop-updates.ts 引 server/dist/update/version.js 先例）；W4 填一处两链生效。
// 镜像 latest.yml 与 zip 链 manifest.json 的产出侧＝desktop/scripts/sync-feed-lib.mjs。
import { CN_MIRROR_BASE } from '../../server/dist/update/manifest.js'
import { readUpdateSourceSetting, type UpdateSourceSetting } from '../../server/dist/update/update-source.js'
import { DEFAULT_GITHUB_FEED, type DesktopUpdaterAdapter, type UpdateFeed } from './desktop-updates.js'

export { CN_MIRROR_BASE }
export type { UpdateSourceSetting }
export { readUpdateSourceSetting }

/** 尝试计划条目标签：env＝环境变量注入；cn-mirror＝国内镜像；github＝官方；custom＝用户自定义；external＝外部 setFeedURL 直设 */
export type FeedPlanLabel = 'env' | 'cn-mirror' | 'github' | 'custom' | 'external'

export interface FeedPlanEntry {
  label: FeedPlanLabel
  feed: UpdateFeed
}

/** 观测缝记录（boot-check.json sources 字段载荷，形状=proposed_default） */
export interface FeedAttemptRecord {
  label: string
  url: string
  outcome: 'ok' | 'failed'
  error: string | null
}

/** 尾斜杠归一的 URL 拼接（与 server 侧 cnMirrorManifestUrl 同口径） */
function joinUrl(base: string, fileName: string): string {
  return `${base.replace(/\/+$/, '')}/${fileName}`
}

/** electron-updater 镜像 feed 地址＝<base>/latest.yml（与 sync 脚本产出文件名一致） */
export function cnMirrorLatestYmlUrl(mirrorBase: string = CN_MIRROR_BASE): string {
  return joinUrl(mirrorBase, 'latest.yml')
}

/**
 * 有序 feed 尝试计划（UPD-CN-FALLBACK-DESKTOP）：
 * env TRAINER_DESKTOP_UPDATE_FEED 注入 → 单源不回退（UPD-DESKTOP-FEED-INJECTABLE 冻结
 * 口径零破坏）；三态设置（UPD-FEED-SETTING，读 <dataDir>/update-source.json）：official →
 * 仅 GitHub、custom（http(s)）→ 单源；其余（auto/未配置/custom URL 非法 fail-safe）→
 * 镜像 base 非空时 [镜像 latest.yml, GitHub]（镜像失败回退官方一次），空串＝未上线退化
 * 为纯 GitHub。
 */
export function resolveDesktopFeedPlan(
  env: NodeJS.ProcessEnv,
  setting: UpdateSourceSetting | null,
  mirrorBase: string = CN_MIRROR_BASE,
): FeedPlanEntry[] {
  const injected = typeof env.TRAINER_DESKTOP_UPDATE_FEED === 'string' ? env.TRAINER_DESKTOP_UPDATE_FEED.trim() : ''
  if (injected !== '') return [{ label: 'env', feed: { provider: 'generic', url: injected } }]
  if (setting?.source === 'official') return [{ label: 'github', feed: { ...DEFAULT_GITHUB_FEED } }]
  if (setting?.source === 'custom' && setting.customUrl !== null && /^https?:\/\/\S+$/.test(setting.customUrl)) {
    return [{ label: 'custom', feed: { provider: 'generic', url: setting.customUrl } }]
  }
  const base = mirrorBase.trim()
  if (base !== '') {
    return [
      { label: 'cn-mirror', feed: { provider: 'generic', url: cnMirrorLatestYmlUrl(base) } },
      { label: 'github', feed: { ...DEFAULT_GITHUB_FEED } },
    ]
  }
  return [{ label: 'github', feed: { ...DEFAULT_GITHUB_FEED } }]
}

/** 观测 URL：generic＝feed 地址；github＝github:<owner>/<repo> */
function feedDisplayUrl(feed: UpdateFeed): string {
  return feed.provider === 'generic' ? feed.url : `github:${feed.owner}/${feed.repo}`
}

function messageOf(error: unknown): string {
  // UPD-QUIT-TYPEERROR-GUARD 同口径：undefined/非 Error 输入字符串化，绝不升级 TypeError
  return error instanceof Error ? error.message : String(error)
}

export interface FeedFallbackAdapterDeps {
  inner: DesktopUpdaterAdapter
  /** 每次检查重取计划（读最新用户设置；镜像/官方顺序由 resolveDesktopFeedPlan 决定） */
  getPlan: () => Promise<FeedPlanEntry[]>
  logger: { warn(...args: unknown[]): void }
}

/**
 * 回退适配器：包装既有 DesktopUpdaterAdapter 同一面（controller/IPC/渲染端零改动）。
 * checkForUpdates 逐源 setFeedURL→check：成功即返回且此后不再换源——**下载沿用最终
 * check 成功的源**（electron-updater feed 同源语义）；失败（404/超时/拒连等一切
 * checkForUpdates 拒绝形态，不做内容嗅探）记录后继续下一源；全部失败抛**最后一次**
 * 的原始错误对象（人话化归 controller 的 normalizeUpdaterError）。外部 setFeedURL
 * 直设＝显式单源覆盖（注入即不回退）。
 */
export function createFeedFallbackAdapter(deps: FeedFallbackAdapterDeps): DesktopUpdaterAdapter & { lastAttempts(): FeedAttemptRecord[] } {
  const { inner, getPlan, logger } = deps
  let attempts: FeedAttemptRecord[] = []
  let externalFeed: UpdateFeed | null = null

  return {
    setFeedURL(feed: UpdateFeed): void {
      externalFeed = feed
    },

    async checkForUpdates() {
      attempts = []
      const plan = externalFeed !== null
        ? [{ label: 'external' as const, feed: externalFeed }]
        : await getPlan()
      if (plan.length === 0) throw new Error('没有可用的更新源（更新源计划为空）')
      let lastError: unknown = new Error('没有可用的更新源')
      for (const entry of plan) {
        inner.setFeedURL(entry.feed)
        try {
          const result = await inner.checkForUpdates()
          attempts.push({ label: entry.label, url: feedDisplayUrl(entry.feed), outcome: 'ok', error: null })
          return result
        } catch (error) {
          const message = messageOf(error)
          attempts.push({ label: entry.label, url: feedDisplayUrl(entry.feed), outcome: 'failed', error: message })
          logger.warn(`[desktop-updates] 更新源 ${entry.label}（${feedDisplayUrl(entry.feed)}）检查失败：${message}`)
          lastError = error
        }
      }
      throw lastError
    },

    async downloadUpdate() {
      return await inner.downloadUpdate()
    },

    quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
      inner.quitAndInstall(isSilent, isForceRunAfter)
    },

    onDownloadProgress(callback): void {
      inner.onDownloadProgress(callback)
    },

    lastAttempts(): FeedAttemptRecord[] {
      return attempts
    },
  }
}
