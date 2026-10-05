// UPD-01 检查更新端点与清单源注入。矩阵行：UPD-CHECK-LATEST / UPD-CHECK-OFFLINE /
// UPD-CHECK-NO-UPDATE / UPD-MANIFEST-INJECTABLE / UPD-VERSION-EXPOSE。
// oracle 独立性：期望版本号/URL/笔记全部来自本文件手写 fixture（非实现回显）；
// 版本比较期望（1.2.10 > 1.2.9）为十进制常识独立推算，不 import 服务端比较函数。

import Fastify from 'fastify'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { registerUpdateApi } from '../src/update/api.js'
import { fetchUpdateManifest, resolveManifestUrl } from '../src/update/manifest.js'
import { compareVersions, normalizeTagVersion, serverVersion } from '../src/update/version.js'
import { makeTmpDir, writeMiniPackage } from './helpers/updater-fixtures.js'

const CURRENT_VERSION = '1.2.7'
const NEWER_TAG = 'v9.9.9'

function manifestText(tag: string, options: { noZipAsset?: boolean, noSums?: boolean } = {}): string {
  const version = tag.replace(/^v/, '')
  const assets: Array<Record<string, unknown>> = []
  if (!options.noZipAsset) {
    assets.push({
      name: `kline-trainer-v${version}-windows-x64.zip`,
      browser_download_url: `https://example.invalid/releases/${tag}/kline-trainer-v${version}-windows-x64.zip`,
      size: 123_456,
    })
  }
  if (!options.noSums) {
    assets.push({ name: 'SHA256SUMS', browser_download_url: `https://example.invalid/releases/${tag}/SHA256SUMS`, size: 96 })
  }
  return JSON.stringify({ tag_name: tag, name: `release ${tag}`, body: '修复了若干问题\n新增在线版本更新', draft: false, prerelease: false, assets })
}

const suites: Array<() => Promise<void>> = []

async function buildApp(options: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}): Promise<Fastify.FastifyInstance> {
  const app = Fastify()
  const packageRoot = await makeTmpDir('trainer-upd-check-pkg-')
  await writeMiniPackage(packageRoot, { version: CURRENT_VERSION })
  const config = {
    dataDir: null,
    launcherConfigPath: null,
    runId: null,
    ...configOverrides,
  } as unknown as AppConfig
  await registerUpdateApi(app, config, { packageRoot, ...options })
  suites.push(() => app.close())
  return app
}

afterEach(async () => {
  while (suites.length) await suites.pop()!()
})

describe('GET /api/update/check', () => {
  it('UPD-CHECK-LATEST: reports a newer release with notes, size and the zip download URL', async () => {
    const manifestUrl = 'https://example.invalid/releases/latest'
    const app = await buildApp({
      manifestFetch: async () => manifestText(NEWER_TAG),
      manifestUrl,
    })
    const response = await app.inject({ method: 'GET', url: '/api/update/check' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.currentVersion).toBe(CURRENT_VERSION)
    expect(body.latestVersion).toBe('9.9.9')
    expect(body.updateAvailable).toBe(true)
    expect(body.downloadUrl).toBe(`https://example.invalid/releases/${NEWER_TAG}/kline-trainer-v9.9.9-windows-x64.zip`)
    expect(body.downloadSize).toBe(123_456)
    expect(body.releaseNotes).toContain('在线版本更新')
    expect(body.manifestUrl).toBe(manifestUrl)
    expect(body.error).toBeNull()
  })

  it('UPD-CHECK-OFFLINE: network failure returns a human-readable error without 5xx', async () => {
    const app = await buildApp({
      manifestFetch: async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com') },
    })
    const response = await app.inject({ method: 'GET', url: '/api/update/check' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.updateAvailable).toBe(false)
    expect(body.latestVersion).toBeNull()
    expect(body.downloadUrl).toBeNull()
    expect(body.error).toContain('无法检查更新')
    expect(body.currentVersion).toBe(CURRENT_VERSION)
  })

  it('UPD-CHECK-OFFLINE: unusable manifests (bad JSON / missing tag_name / no zip asset) report distinct reasons', async () => {
    const cases: Array<{ label: string, text: string | Error, expect: string }> = [
      { label: 'bad-json', text: '<html>not json</html>', expect: '不是有效 JSON' },
      { label: 'no-tag', text: JSON.stringify({ assets: [] }), expect: '缺少 tag_name' },
      { label: 'no-zip-asset', text: manifestText('v2.0.0', { noZipAsset: true }), expect: '找不到' },
    ]
    for (const item of cases) {
      const app = await buildApp({
        manifestFetch: async () => item.text instanceof Error ? Promise.reject(item.text) : item.text,
      })
      const response = await app.inject({ method: 'GET', url: '/api/update/check' })
      expect(response.statusCode, item.label).toBe(200)
      const body = response.json()
      expect(body.updateAvailable, item.label).toBe(false)
      expect(body.error, item.label).toContain('无法检查更新')
      expect(body.error, item.label).toContain(item.expect)
    }
  })

  it('UPD-CHECK-NO-UPDATE: an equal or older tag reports no update and no download URL', async () => {
    for (const tag of ['v1.2.7', 'v1.2.6', 'v1.0.0']) {
      const app = await buildApp({ manifestFetch: async () => manifestText(tag) })
      const response = await app.inject({ method: 'GET', url: '/api/update/check' })
      expect(response.statusCode, tag).toBe(200)
      const body = response.json()
      expect(body.updateAvailable, tag).toBe(false)
      expect(body.downloadUrl, tag).toBeNull()
      expect(body.latestVersion, tag).toBe(tag.replace(/^v/, ''))
      expect(body.error, tag).toBeNull()
    }
  })
})

describe('resolveManifestUrl / fetchUpdateManifest', () => {
  it('UPD-MANIFEST-INJECTABLE: env beats config file beats release publicURL beats repo default', async () => {
    const workDir = await makeTmpDir('trainer-upd-url-')
    const configPath = join(workDir, 'trainer.config.json')
    await writeFile(configPath, JSON.stringify({ update: { manifest_url: 'https://cfg.example/manifest' } }), 'utf8')

    const fromEnv = await resolveManifestUrl({ env: { TRAINER_UPDATE_MANIFEST_URL: 'https://env.example/m' }, launcherConfigPath: configPath, releasePublicURL: 'https://github.com/foo/bar' })
    expect(fromEnv.url).toBe('https://env.example/m')
    expect(fromEnv.source).toBe('env')

    const fromConfig = await resolveManifestUrl({ env: {}, launcherConfigPath: configPath, releasePublicURL: 'https://github.com/foo/bar' })
    expect(fromConfig.url).toBe('https://cfg.example/manifest')
    expect(fromConfig.source).toBe('config')

    const fromRelease = await resolveManifestUrl({ env: {}, launcherConfigPath: null, releasePublicURL: 'https://github.com/foo/bar' })
    expect(fromRelease.url).toBe('https://api.github.com/repos/foo/bar/releases/latest')
    expect(fromRelease.source).toBe('release')

    const fallback = await resolveManifestUrl({ env: {}, launcherConfigPath: null, releasePublicURL: null })
    expect(fallback.url).toBe('https://api.github.com/repos/m1kuStark/a-share-kline-trainer/releases/latest')
    expect(fallback.source).toBe('default')

    // 环境变量为空串视为未设置（trim 口径）
    const emptyEnv = await resolveManifestUrl({ env: { TRAINER_UPDATE_MANIFEST_URL: '  ' }, launcherConfigPath: configPath, releasePublicURL: null })
    expect(emptyEnv.source).toBe('config')
  })

  it('fetchUpdateManifest returns a parsed manifest with the zip and SHA256SUMS assets classified', async () => {
    const result = await fetchUpdateManifest('https://example.invalid/latest', async () => manifestText('v2.0.0'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.version).toBe('2.0.0')
    expect(result.manifest.zip?.name).toBe('kline-trainer-v2.0.0-windows-x64.zip')
    expect(result.manifest.checksums?.name).toBe('SHA256SUMS')
    expect(result.manifest.notes).toContain('在线版本更新')
  })
})

describe('UPD-VERSION-EXPOSE version source', () => {
  it('serverVersion reads the package-root package.json version (build-time written)', async () => {
    const workDir = await makeTmpDir('trainer-upd-ver-')
    await writeMiniPackage(workDir, { version: '3.4.5', includeRuntime: false })
    expect(serverVersion(workDir)).toBe('3.4.5')
    expect(serverVersion(join(workDir, 'no-such-root'))).toBeNull()
  })

  it('index.ts wires currentVersion into /api/health without touching the three identity fields', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/app\.get\('\/api\/health'[\s\S]*?currentVersion:\s*serverVersion\(\)/)
    expect(source).toMatch(/app\.get\('\/api\/health'[\s\S]*?status:\s*'ok'/)
    expect(source).toMatch(/app\.get\('\/api\/health'[\s\S]*?runId:\s*config\.runId \?\? null/)
    expect(source).toMatch(/app\.get\('\/api\/health'[\s\S]*?pid:\s*process\.pid/)
  })

  it('version helpers compare dotted triples decimally and normalize v-prefixes', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
    expect(compareVersions('1.2.9', '1.2.10')).toBe(-1)
    expect(compareVersions('v1.2.7', '1.2.7')).toBe(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
    expect(normalizeTagVersion('v1.2.8')).toBe('1.2.8')
    expect(normalizeTagVersion('1.2.8')).toBe('1.2.8')
    expect(normalizeTagVersion('release-1.2.8')).toBeNull()
  })
})
