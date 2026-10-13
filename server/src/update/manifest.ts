// UPD-01 更新清单源（矩阵行 UPD-CHECK-* / UPD-MANIFEST-INJECTABLE）。
// 清单源 URL 优先级：env TRAINER_UPDATE_MANIFEST_URL > trainer.config.json 的
// update.manifest_url > release.json publicURL 推导的 GitHub latest API > 仓库常量。
// 清单拉取器（fetchText）可整体注入——测试与离线场景指向本地 fixture，
// 任何测试不得访问 api.github.com。
// CN-FEED-01（2026-10-13）：新增 resolveManifestPlan 有序尝试计划（env/config 注入即单源
// 不回退＞三态设置＞内置默认 auto＝国内镜像 manifest.json 优先、失败回退 GitHub）。
// 清单 fetch 的逐源回退执行在 api.ts（check/apply 两处）。

import { readFile } from 'node:fs/promises'
import { safeGetText } from './safe-http.js'
import { normalizeTagVersion } from './version.js'
import type { UpdateSourceSetting } from './update-source.js'

export const DEFAULT_REPO = 'm1kuStark/a-share-kline-trainer'
export const DEFAULT_MANIFEST_URL = `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`

/**
 * 国内镜像 base URL（单一事实源；v1.3.2 起 W4 已填入——CloudBase 静态托管
 * https://k-line-trainer-…-1505768275.tcloudbaseapp.com/feed，架构师 2026-10-13 上线）。
 * 空串＝镜像未上线（UPD-CN-FALLBACK-HTTP 的 auto 计划退化为纯 GitHub，行为安全）。
 * desktop 链（desktop/src/cn-feed.ts）经
 * 编译产物 import 同一常量——改这里＋重跑 npm run build:server 即两链同时生效；
 * 产物文件名（manifest.json/latest.yml）由 desktop/scripts/sync-feed-lib.mjs 生成，
 * desktop/scripts/sync-feed.mjs 是其发布侧对端。
 */
export const CN_MIRROR_BASE = 'https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed'

/** 尾斜杠归一的 URL 拼接 */
function joinUrl(base: string, fileName: string): string {
  return `${base.replace(/\/+$/, '')}/${fileName}`
}

/** zip HTTP 链的镜像 manifest URL（<base>/manifest.json，与 sync 脚本产出文件名一致） */
export function cnMirrorManifestUrl(base: string = CN_MIRROR_BASE): string {
  return joinUrl(base, 'manifest.json')
}

/** 清单计划条目（按序尝试；url＝清单请求地址，source＝来源标签） */
export interface ManifestPlanEntry {
  url: string
  source: 'env' | 'config' | 'custom' | 'official' | 'cn-mirror' | 'release' | 'default'
}

const ZIP_ASSET_PATTERN = /^kline-trainer-v\d+\.\d+\.\d+-windows-x64\.zip$/
const GITHUB_PUBLIC_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
export const RELEASE_NOTES_LIMIT = 4_000

export interface UpdateManifestAsset {
  name: string
  url: string
  size: number | null
}

export interface UpdateManifest {
  tagName: string
  version: string
  notes: string | null
  zip: UpdateManifestAsset
  checksums: UpdateManifestAsset | null
}

export type ManifestFetchText = (url: string) => Promise<string>

export type ManifestResult =
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; error: string }

export interface ResolvedManifestUrl {
  url: string
  source: 'env' | 'config' | 'release' | 'default'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 从 release.json 的 publicURL 推导 GitHub latest API；不匹配时退回仓库常量。 */
export function githubLatestApiUrl(publicURL: string | null | undefined): string {
  const match = GITHUB_PUBLIC_URL.exec((publicURL ?? '').trim())
  if (!match) return DEFAULT_MANIFEST_URL
  return `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`
}

export async function resolveManifestUrl(options: {
  env?: Record<string, string | undefined>
  launcherConfigPath?: string | null
  releasePublicURL?: string | null
}): Promise<ResolvedManifestUrl> {
  const env = options.env ?? process.env
  const fromEnv = typeof env.TRAINER_UPDATE_MANIFEST_URL === 'string' ? env.TRAINER_UPDATE_MANIFEST_URL.trim() : ''
  if (fromEnv) return { url: fromEnv, source: 'env' }
  if (options.launcherConfigPath) {
    try {
      const raw = JSON.parse(await readFile(options.launcherConfigPath, 'utf8')) as {
        update?: { manifest_url?: unknown }
      }
      const configured = raw?.update?.manifest_url
      if (typeof configured === 'string' && configured.trim() !== '') {
        return { url: configured.trim(), source: 'config' }
      }
    } catch {
      // 配置缺失/非 JSON：按未配置下落，不猜测
    }
  }
  const publicURL = (options.releasePublicURL ?? '').trim()
  if (publicURL && GITHUB_PUBLIC_URL.test(publicURL)) {
    return { url: githubLatestApiUrl(publicURL), source: 'release' }
  }
  return { url: DEFAULT_MANIFEST_URL, source: 'default' }
}

/**
 * CN-FEED-01 清单尝试计划（有序）：env 注入 → 单源不回退（UPD-MANIFEST-INJECTABLE
 * 冻结口径零破坏）；trainer.config.json update.manifest_url → 单源不回退（同上）；
 * 三态设置（UPD-FEED-SETTING）：custom → 单源、official → 仅 GitHub；其余（auto/未配置，
 * 含设置文件损坏/非法的下落）→ 镜像 base 非空时 [镜像 manifest.json, GitHub 默认]
 * （UPD-CN-FALLBACK-HTTP 镜像优先失败回退，回退一次、错误取最终源），空串＝未上线退化为
 * 纯 GitHub 默认。GitHub 默认 URL＝既有 release publicURL 推导→repo 常量（同一实现）。
 */
export async function resolveManifestPlan(options: {
  env?: Record<string, string | undefined>
  launcherConfigPath?: string | null
  releasePublicURL?: string | null
  setting?: UpdateSourceSetting | null
  mirrorBase?: string
}): Promise<ManifestPlanEntry[]> {
  const fromEnv = await resolveManifestUrl({ env: options.env, launcherConfigPath: null, releasePublicURL: null })
  if (fromEnv.source === 'env') return [{ url: fromEnv.url, source: 'env' }]
  const fromConfig = await resolveManifestUrl({ env: {}, launcherConfigPath: options.launcherConfigPath ?? null, releasePublicURL: null })
  if (fromConfig.source === 'config') return [{ url: fromConfig.url, source: 'config' }]
  const setting = options.setting ?? null
  if (setting?.source === 'custom' && setting.customUrl !== null) {
    return [{ url: setting.customUrl, source: 'custom' }]
  }
  const githubDefault = await resolveManifestUrl({ env: {}, launcherConfigPath: null, releasePublicURL: options.releasePublicURL ?? null })
  if (setting?.source === 'official') {
    return [{ url: githubDefault.url, source: 'official' }]
  }
  const mirrorBase = (options.mirrorBase ?? CN_MIRROR_BASE).trim()
  if (mirrorBase !== '') {
    return [{ url: cnMirrorManifestUrl(mirrorBase), source: 'cn-mirror' }, { url: githubDefault.url, source: githubDefault.source }]
  }
  return [{ url: githubDefault.url, source: githubDefault.source }]
}

/** 真实清单拉取（GitHub API 需要 User-Agent；15 秒超时）。P0-4：换 safe-http 原生
 * 网络层——全局 fetch（undici）在响应流截断时从内部异步抛断言崩溃 Electron 主进程
 * （server 内嵌于主进程运行），原生层把截断转为含已收/应收字节的人话 Error。 */
async function defaultManifestFetch(url: string): Promise<string> {
  return safeGetText(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'a-share-kline-trainer-updater' },
    timeoutMs: 15_000,
    timeoutMessage: '检查更新超时（15 秒）',
  })
}

function assetUrl(asset: unknown): string | null {
  if (!asset || typeof asset !== 'object') return null
  const url = (asset as { browser_download_url?: unknown }).browser_download_url
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : null
}

/**
 * 拉取并解析 GitHub Releases latest 形状的清单。
 * 任何失败（网络/非 JSON/缺 tag_name/版本标签不可识别/无 zip 资产）都返回人话
 * 中文错误（不抛出），供 /api/update/check 以 200＋error 形态呈现。
 */
export async function fetchUpdateManifest(url: string, fetchText?: ManifestFetchText): Promise<ManifestResult> {
  const fetcher = fetchText ?? defaultManifestFetch
  let text: string
  try {
    text = await fetcher(url)
  } catch (error) {
    return { ok: false, error: `无法检查更新：访问更新清单失败（${messageOf(error)}）` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '无法检查更新：更新清单不是有效 JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '无法检查更新：更新清单不是 JSON 对象' }
  }
  const value = parsed as Record<string, unknown>
  if (typeof value.tag_name !== 'string' || value.tag_name.trim() === '') {
    return { ok: false, error: '无法检查更新：更新清单缺少 tag_name' }
  }
  const version = normalizeTagVersion(value.tag_name)
  if (!version) {
    return { ok: false, error: `无法检查更新：无法识别的版本标签 ${value.tag_name}` }
  }
  const assets = Array.isArray(value.assets) ? value.assets : []
  const zipEntry = assets.find(asset =>
    asset && typeof (asset as { name?: unknown }).name === 'string'
    && ZIP_ASSET_PATTERN.test((asset as { name: string }).name))
  const zipUrl = assetUrl(zipEntry)
  if (!zipEntry || !zipUrl) {
    return { ok: false, error: '无法检查更新：清单里找不到 Windows x64 发布包（kline-trainer-v<版本>-windows-x64.zip）资产' }
  }
  const checksumsEntry = assets.find(asset =>
    asset && (asset as { name?: unknown }).name === 'SHA256SUMS')
  const checksumsUrl = assetUrl(checksumsEntry)
  const sizeOf = (entry: unknown): number | null => {
    const size = (entry as { size?: unknown } | null)?.size
    return typeof size === 'number' && Number.isFinite(size) ? size : null
  }
  const body = typeof value.body === 'string' ? value.body : null
  return {
    ok: true,
    manifest: {
      tagName: value.tag_name,
      version,
      notes: body ? body.slice(0, RELEASE_NOTES_LIMIT) : null,
      zip: { name: (zipEntry as { name: string }).name, url: zipUrl, size: sizeOf(zipEntry) },
      checksums: checksumsEntry && checksumsUrl
        ? { name: 'SHA256SUMS', url: checksumsUrl, size: sizeOf(checksumsEntry) }
        : null,
    },
  }
}
