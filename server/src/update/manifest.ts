// UPD-01 更新清单源（矩阵行 UPD-CHECK-* / UPD-MANIFEST-INJECTABLE）。
// 清单源 URL 优先级：env TRAINER_UPDATE_MANIFEST_URL > trainer.config.json 的
// update.manifest_url > release.json publicURL 推导的 GitHub latest API > 仓库常量。
// 清单拉取器（fetchText）可整体注入——测试与离线场景指向本地 fixture，
// 任何测试不得访问 api.github.com。

import { readFile } from 'node:fs/promises'
import { normalizeTagVersion } from './version.js'

export const DEFAULT_REPO = 'm1kuStark/a-share-kline-trainer'
export const DEFAULT_MANIFEST_URL = `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`

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

/** 真实清单拉取（GitHub API 需要 User-Agent；15 秒超时）。 */
async function defaultManifestFetch(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'a-share-kline-trainer-updater' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.text()
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
