// CN-FEED-01（矩阵行 UPD-CN-FALLBACK-HTTP / UPD-FEED-SETTING）：zip HTTP 更新链国内镜像
// manifest 优先回退 GitHub＋更新源三态设置（GET/PUT /api/update/source＋resolveManifestPlan
// 优先级＋web 接线源码契约）。
// oracle 独立性：镜像 base/各 URL/清单文本（tag_name、zip 资产名、notes）全部手写 fixture；
// GitHub 常量 URL 来自矩阵行 UPD-MANIFEST-INJECTABLE 冻结描述；优先级顺序来自派发简报
// （env > 既有 config 注入 > 用户三态设置 > 内置默认 auto）。测试零 api.github.com 访问
// （manifestFetch 全注入；计划断言为纯函数期望值）。
import Fastify from 'fastify'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { registerUpdateApi } from '../src/update/api.js'
import { CN_MIRROR_BASE, cnMirrorManifestUrl, resolveManifestPlan } from '../src/update/manifest.js'
import { parseUpdateSourceSetting, readUpdateSourceSetting, UPDATE_SOURCE_FILE_NAME } from '../src/update/update-source.js'
import { makeTmpDir, writeMiniPackage } from './helpers/updater-fixtures.js'

const CURRENT_VERSION = '1.2.7'
const MIRROR_BASE = 'https://cn.example/pub'
const GITHUB_LATEST = 'https://api.github.com/repos/m1kuStark/a-share-kline-trainer/releases/latest'

/** 手写 GitHub Releases latest 形状清单（同 UPD-01 消费契约 §2.1） */
function githubManifestText(tag: string): string {
  const version = tag.replace(/^v/, '')
  return JSON.stringify({
    tag_name: tag,
    name: `release ${tag}`,
    body: '镜像回退后的官方清单',
    assets: [
      {
        name: `kline-trainer-v${version}-windows-x64.zip`,
        browser_download_url: `https://github.com/m1kuStark/a-share-kline-trainer/releases/download/${tag}/kline-trainer-v${version}-windows-x64.zip`,
        size: 234_567,
      },
      { name: 'SHA256SUMS', browser_download_url: `https://github.com/m1kuStark/a-share-kline-trainer/releases/download/${tag}/SHA256SUMS`, size: 96 },
    ],
  })
}

const suites: Array<() => Promise<void>> = []

async function buildApp(options: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}): Promise<Fastify.FastifyInstance> {
  const app = Fastify()
  const packageRoot = await makeTmpDir('cnfeed-pkg-')
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

describe('CN-FEED-01 清单计划（resolveManifestPlan 纯函数）', () => {
  it('UPD-CN-FALLBACK-HTTP: 未注入且镜像已配置 → 镜像 manifest.json 优先 GitHub 兜底（尾斜杠归一）', async () => {
    const plan = await resolveManifestPlan({ env: {}, launcherConfigPath: null, releasePublicURL: null, mirrorBase: `${MIRROR_BASE}/` })
    expect(plan).toEqual([
      { url: `${MIRROR_BASE}/manifest.json`, source: 'cn-mirror' },
      { url: GITHUB_LATEST, source: 'default' },
    ])
    expect(await resolveManifestPlan({ env: {}, launcherConfigPath: null, releasePublicURL: null, mirrorBase: MIRROR_BASE })).toEqual(plan)
  })

  it('UPD-CN-FALLBACK-HTTP: 镜像未配置（空串）→ 计划退化为纯 GitHub 默认（镜像未上线行为安全）', async () => {
    expect(await resolveManifestPlan({ env: {}, launcherConfigPath: null, releasePublicURL: null, mirrorBase: '' }))
      .toEqual([{ url: GITHUB_LATEST, source: 'default' }])
    // 未传 mirrorBase 使用内置常量（v1.3.2 起镜像已上线：常量非空，auto 计划＝镜像优先 GitHub 兜底）
    expect(await resolveManifestPlan({ env: {}, launcherConfigPath: null, releasePublicURL: null }))
      .toEqual([
        { url: 'https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed/manifest.json', source: 'cn-mirror' },
        { url: GITHUB_LATEST, source: 'default' },
      ])
  })

  it('UPD-FEED-SETTING: 优先级 env > trainer.config manifest_url > 三态设置 > 内置默认（逐级断言）', async () => {
    const workDir = await makeTmpDir('cnfeed-url-')
    const configPath = join(workDir, 'trainer.config.json')
    await writeFile(configPath, JSON.stringify({ update: { manifest_url: 'https://cfg.example/manifest' } }), 'utf8')
    const custom = { source: 'custom' as const, customUrl: 'https://setting.example/feed' }
    const official = { source: 'official' as const, customUrl: null }

    // env 胜一切（注入即不回退）
    expect(await resolveManifestPlan({
      env: { TRAINER_UPDATE_MANIFEST_URL: 'https://env.example/m' },
      launcherConfigPath: configPath, setting: custom, mirrorBase: MIRROR_BASE,
    })).toEqual([{ url: 'https://env.example/m', source: 'env' }])
    // 既有 config 注入胜三态设置（UPD-MANIFEST-INJECTABLE 冻结口径不降级）
    expect(await resolveManifestPlan({
      env: {}, launcherConfigPath: configPath, setting: custom, mirrorBase: MIRROR_BASE,
    })).toEqual([{ url: 'https://cfg.example/manifest', source: 'config' }])
    // 设置 custom → 单源（不回退）
    expect(await resolveManifestPlan({
      env: {}, launcherConfigPath: null, setting: custom, mirrorBase: MIRROR_BASE,
    })).toEqual([{ url: 'https://setting.example/feed', source: 'custom' }])
    // 设置 official → 仅 GitHub（source 标签=official，区别于默认 auto 的下落）
    expect(await resolveManifestPlan({
      env: {}, launcherConfigPath: null, setting: official, mirrorBase: MIRROR_BASE,
    })).toEqual([{ url: GITHUB_LATEST, source: 'official' }])
    // 无任何注入与设置 → auto（镜像优先 GitHub 兜底）
    expect(await resolveManifestPlan({
      env: {}, launcherConfigPath: null, mirrorBase: MIRROR_BASE,
    })).toEqual([
      { url: `${MIRROR_BASE}/manifest.json`, source: 'cn-mirror' },
      { url: GITHUB_LATEST, source: 'default' },
    ])
  })

  it('UPD-CN-FALLBACK-HTTP: cnMirrorManifestUrl 拼接（与 sync 脚本产出文件名一致）＋内置常量当前为空串', () => {
    expect(cnMirrorManifestUrl(MIRROR_BASE)).toBe(`${MIRROR_BASE}/manifest.json`)
    expect(cnMirrorManifestUrl(`${MIRROR_BASE}/`)).toBe(`${MIRROR_BASE}/manifest.json`)
    // 镜像已上线（v1.3.2 W4 填入 CloudBase 静态托管真实 URL；原"空串＝未上线"断言随常量同步更新）
    expect(CN_MIRROR_BASE).toBe('https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed')
  })
})

describe('CN-FEED-01 check 端点回退（注入 manifestFetch 路由）', () => {
  it('UPD-CN-FALLBACK-HTTP: 镜像清单失败回退 GitHub——结果取 GitHub，manifestUrl=实际成功源', async () => {
    const fetched: string[] = []
    const app = await buildApp({
      mirrorBase: MIRROR_BASE,
      manifestFetch: async (url: string) => {
        fetched.push(url)
        if (url.startsWith(MIRROR_BASE)) throw new Error('HTTP 404 (mirror manifest missing)')
        return githubManifestText('v9.9.9')
      },
    })
    const response = await app.inject({ method: 'GET', url: '/api/update/check' })
    expect(response.statusCode).toBe(200)
    const body = response.json() as Record<string, unknown>
    expect(body.updateAvailable).toBe(true)
    expect(body.latestVersion).toBe('9.9.9')
    expect(body.releaseNotes).toBe('镜像回退后的官方清单')
    expect(body.manifestUrl).toBe(GITHUB_LATEST)
    expect(body.error).toBeNull()
    // 逐源尝试顺序：先镜像后 GitHub
    expect(fetched).toEqual([`${MIRROR_BASE}/manifest.json`, GITHUB_LATEST])
  })

  it('UPD-CN-FALLBACK-HTTP: env 注入失败不回退——fetcher 恰一次且 URL=env 源', async () => {
    let fetchCalls = 0
    const envUrl = 'https://env.example/m'
    const app = await buildApp({
      env: { TRAINER_UPDATE_MANIFEST_URL: envUrl },
      mirrorBase: MIRROR_BASE,
      manifestFetch: async (url: string) => {
        fetchCalls += 1
        expect(url).toBe(envUrl)
        throw new Error('env source unreachable')
      },
    })
    const response = await app.inject({ method: 'GET', url: '/api/update/check' })
    expect(response.statusCode).toBe(200)
    const body = response.json() as Record<string, unknown>
    expect(body.updateAvailable).toBe(false)
    expect(body.latestVersion).toBeNull()
    expect(String(body.error)).toContain('env source unreachable')
    expect(body.manifestUrl).toBe(envUrl)
    expect(fetchCalls).toBe(1)
  })
})

describe('CN-FEED-01 更新源设置端点（GET/PUT /api/update/source；真实 fs）', () => {
  it('UPD-FEED-SETTING: PUT 校验与原子持久化＋GET 回读（origin=setting、mirrorConfigured 如实）', async () => {
    const dataDir = await makeTmpDir('cnfeed-setting-')
    const app = await buildApp({}, { dataDir })
    const customUrl = 'https://mirror.example/feed/'

    // custom 必须带 http(s) URL
    expect((await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'custom' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'custom', customUrl: 'ftp://bad/x' } })).statusCode).toBe(400)
    // 非三态 source 拒绝
    expect((await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'weird' } })).statusCode).toBe(400)
    // official 时不得携带 customUrl
    expect((await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'official', customUrl: customUrl } })).statusCode).toBe(400)

    // 合法 custom：200＋落盘＋回读
    const saved = await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'custom', customUrl } })
    expect(saved.statusCode).toBe(200)
    const savedBody = saved.json() as Record<string, unknown>
    expect(savedBody.source).toBe('custom')
    expect(savedBody.customUrl).toBe(customUrl)
    expect(savedBody.origin).toBe('setting')
    const written = JSON.parse(await readFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), 'utf8')) as Record<string, unknown>
    expect(written).toEqual({ source: 'custom', customUrl })

    const view = await app.inject({ method: 'GET', url: '/api/update/source' })
    expect(view.statusCode).toBe(200)
    const viewBody = view.json() as Record<string, unknown>
    expect(viewBody.source).toBe('custom')
    expect(viewBody.customUrl).toBe(customUrl)
    expect(viewBody.origin).toBe('setting')
    // v1.3.2 起常量已填入真实镜像 URL——mirrorConfigured 如实为 true
    expect(viewBody.mirrorConfigured).toBe(true)

    // official / auto 同理落盘
    expect((await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'official' } })).statusCode).toBe(200)
    expect(((await app.inject({ method: 'GET', url: '/api/update/source' })).json() as Record<string, unknown>).source).toBe('official')
    expect((await app.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'auto' } })).statusCode).toBe(200)
    const afterAuto = JSON.parse(await readFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), 'utf8')) as Record<string, unknown>
    expect(afterAuto).toEqual({ source: 'auto', customUrl: null })
  })

  it('UPD-FEED-SETTING: env 注入（两链任一）→ GET origin=env；无 dataDir → PUT 409 不伪装成功', async () => {
    const dataDir = await makeTmpDir('cnfeed-origin-')
    const fromManifestEnv = await buildApp({ env: { TRAINER_UPDATE_MANIFEST_URL: 'https://env.example/m' } }, { dataDir })
    const manifestEnvView = await fromManifestEnv.inject({ method: 'GET', url: '/api/update/source' })
    expect((manifestEnvView.json() as Record<string, unknown>).origin).toBe('env')

    const fromDesktopFeedEnv = await buildApp({ env: { TRAINER_DESKTOP_UPDATE_FEED: 'http://env.example/feed/' } }, { dataDir })
    const desktopEnvView = await fromDesktopFeedEnv.inject({ method: 'GET', url: '/api/update/source' })
    expect((desktopEnvView.json() as Record<string, unknown>).origin).toBe('env')

    const noDataDir = await buildApp()
    const refused = await noDataDir.inject({ method: 'PUT', url: '/api/update/source', payload: { source: 'official' } })
    expect(refused.statusCode).toBe(409)
  })

  it('UPD-FEED-SETTING: 未设置时 GET 默认视图（source=auto、origin=default）', async () => {
    const dataDir = await makeTmpDir('cnfeed-default-')
    const app = await buildApp({}, { dataDir })
    const view = await app.inject({ method: 'GET', url: '/api/update/source' })
    expect(view.statusCode).toBe(200)
    expect(view.json()).toEqual({ source: 'auto', customUrl: null, origin: 'default', mirrorConfigured: true })
  })
})

describe('CN-FEED-01 update-source.json 读写器（真实 fs，fail-open 到 auto）', () => {
  it('UPD-FEED-SETTING: 缺失/损坏/非法内容一律 null；合法 custom 回读', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cnfeed-reader-'))
    // 缺失 → null
    expect(await readUpdateSourceSetting(dataDir)).toBeNull()
    // dataDir null → null（无处可读）
    expect(await readUpdateSourceSetting(null)).toBeNull()
    // 损坏 JSON → null
    await writeFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), '{not json', 'utf8')
    expect(await readUpdateSourceSetting(dataDir)).toBeNull()
    // 非三态 source → null（不猜）
    await writeFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), JSON.stringify({ source: 'weird' }), 'utf8')
    expect(await readUpdateSourceSetting(dataDir)).toBeNull()
    // custom 缺 URL → null（fail-open 到 auto 下落）
    await writeFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), JSON.stringify({ source: 'custom', customUrl: null }), 'utf8')
    expect(await readUpdateSourceSetting(dataDir)).toBeNull()
    // 合法 custom → 回读
    const valid = { source: 'custom', customUrl: 'https://x.example/feed/' }
    await writeFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), JSON.stringify(valid), 'utf8')
    expect(await readUpdateSourceSetting(dataDir)).toEqual(valid)
    // 纯函数：official/auto 形状合法
    expect(parseUpdateSourceSetting({ source: 'official' })).toEqual({ source: 'official', customUrl: null })
    expect(parseUpdateSourceSetting({ source: 'auto', customUrl: null })).toEqual({ source: 'auto', customUrl: null })
  })
})

describe('CN-FEED-01 web 更新源 UI 源码契约（TrainingSettings.vue；沿 updater-notice 先例）', () => {
  const readVue = async (): Promise<string> =>
    readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')

  it('UPD-FEED-SETTING: 更新源三态接线——GET/PUT /api/update/source＋三选项＋custom URL 输入', async () => {
    const source = await readVue()
    // GET 加载与 PUT 保存都打到 /api/update/source
    expect(source).toMatch(/fetch\('\/api\/update\/source'\)/)
    expect(source).toMatch(/fetch\('\/api\/update\/source',\s*\{\s*method:\s*'PUT'/)
    // 三态选项（auto/official/custom radio 值）
    expect(source).toMatch(/update-source[\s\S]{0,400}value="auto"[\s\S]{0,400}value="official"[\s\S]{0,400}value="custom"/)
    // custom 时 URL 输入框
    expect(source).toMatch(/update-source-url/)
    // 保存动作与状态呈现（错误/成功提示类名）
    expect(source).toMatch(/update-source-(saved|error)/)
  })

  it('UPD-FEED-SETTING: env 覆盖与镜像未上线提示文案（origin=env 时不伪装可配置）', async () => {
    const source = await readVue()
    expect(source).toMatch(/更新源已由环境变量注入/)
    expect(source).toMatch(/国内镜像/)
    expect(source).toMatch(/update-source-origin/)
  })
})
