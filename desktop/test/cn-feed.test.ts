// CN-FEED-01（矩阵行 UPD-CN-FALLBACK-DESKTOP / UPD-FEED-SETTING desktop 侧）：
// 国内镜像 feed 优先＋回退官方 GitHub 的桌面更新链。
// oracle 独立性：期望计划顺序/URL/label/错误信息全部手写（镜像 base 与 GitHub owner/repo
// 为测试自备 fixture 值，GitHub 常量口径来自矩阵行 UPD-DESKTOP-FEED-INJECTABLE 冻结描述），
// 非实现回显；回退执行断言基于注入桩 inner 适配器（setFeedURL/checkForUpdates 调用序），
// 真实 electron-updater 集成归 desktop-updates-fixture.test.ts 既有档（本任务不改其行为）。
// MIRROR-URL-FIX（v1.3.3 热修）：镜像 feed URL 断言从「桩回显」（等于实现自身产出）升级为
// electron-updater 真实库代码 oracle——node_modules/electron-updater/out/util.js 的
// newBaseUrl/newUrlFromBase/getChannelFilename，即 out/providers/GenericProvider.js
// constructor（baseUrl=newBaseUrl(configuration.url)）与 getLatestVersion
// （channelUrl=newUrlFromBase(getChannelFilename(channel), baseUrl)）的同一拼装路径。
// W-D 真机实证（2026-10-13）：目录形态 <base>/ 2.3s 成功发现 v1.3.2（三次稳定）；
// 全 URL …/feed/latest.yml 被库解析为 …/feed/latest.yml/latest.yml（双拼 404）。
// 用户拍板（2026-10-13）：不能依赖 github 链接提供下载资源，应提供纯国内网络也能正常
// 更新的发布路径；镜像常量未上线（空串）时回退链退化为纯 GitHub（行为安全）。
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { access, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  cnMirrorFeedUrl,
  createFeedFallbackAdapter,
  resolveDesktopFeedPlan,
  type FeedAttemptRecord,
  type FeedPlanEntry,
} from '../src/cn-feed.js'
import type { DesktopUpdaterAdapter, UpdateFeed } from '../src/desktop-updates.js'
import { registerUpdateIpc } from '../src/update-ipc.js'

/**
 * electron-updater 真实 URL 解析函数（MIRROR-URL-FIX oracle）：createRequire 深层引
 * node_modules/electron-updater/out/util.js 运行时导出（out/util.d.ts 未声明 newBaseUrl，
 * 走 require 免类型摩擦）——与 GenericProvider 的 baseUrl 建立与 latest.yml 拼接同源。
 */
const requireEu = createRequire(import.meta.url)
const { newBaseUrl, newUrlFromBase, getChannelFilename } = requireEu('electron-updater/out/util.js') as {
  newBaseUrl: (url: string) => URL
  newUrlFromBase: (pathname: string, baseUrl: URL, addRandomQueryToAvoidCaching?: boolean) => URL
  getChannelFilename: (channel: string) => string
}

/** GenericProvider.getLatestVersion 的 channelFile 拼装（updater 未设 channel → 'latest'） */
function resolveChannelUrlThroughRealLibrary(feedUrl: string): string {
  return newUrlFromBase(getChannelFilename('latest'), newBaseUrl(feedUrl)).href
}

/** 手写期望：GitHub provider 常量（矩阵行 UPD-DESKTOP-FEED-INJECTABLE 冻结口径） */
const EXPECTED_GITHUB_FEED: UpdateFeed = { provider: 'github', owner: 'm1kuStark', repo: 'a-share-kline-trainer' }
const MIRROR_BASE = 'https://cn.example/pub'

describe('CN-FEED-01 桌面更新源计划（resolveDesktopFeedPlan）', () => {
  it('UPD-CN-FALLBACK-DESKTOP: auto 加镜像已配置 → 镜像 latest.yml 优先 GitHub 兜底（有序双源，尾斜杠归一）', () => {
    const plan = resolveDesktopFeedPlan({}, null, `${MIRROR_BASE}/`)
    const expected: FeedPlanEntry[] = [
      // MIRROR-URL-FIX：feed URL＝目录形态 <base>/（尾斜杠归一）——electron-updater
      // GenericProvider 把 configuration.url 作 baseUrl 再拼 latest.yml，全 URL 会双拼 404
      { label: 'cn-mirror', feed: { provider: 'generic', url: `${MIRROR_BASE}/` } },
      { label: 'github', feed: EXPECTED_GITHUB_FEED },
    ]
    expect(plan).toEqual(expected)
    // 无尾斜杠同值（URL 归一）
    expect(resolveDesktopFeedPlan({}, null, MIRROR_BASE)).toEqual(expected)
    // 经真实库解析命中的 channel 文件＝<base>/latest.yml（与 sync 脚本产出文件名一致）
    const firstFeed = plan[0]?.feed
    expect(firstFeed !== undefined && isGeneric(firstFeed) ? resolveChannelUrlThroughRealLibrary(firstFeed.url) : '（首源非 generic）').toBe(`${MIRROR_BASE}/latest.yml`)
  })

  it('UPD-CN-FALLBACK-DESKTOP: 镜像未配置（空串）→ auto 计划退化为纯 GitHub 单源（镜像未上线行为安全）', () => {
    expect(resolveDesktopFeedPlan({}, null, '')).toEqual([{ label: 'github', feed: EXPECTED_GITHUB_FEED }])
    // 未传 mirrorBase 时使用内置常量（v1.3.2 起镜像已上线：常量非空，auto 计划＝镜像优先 GitHub 兜底）
    // MIRROR-URL-FIX：内置常量拼出的 feed URL 同为目录形态 …/feed/（经真实库解析命中 …/feed/latest.yml）
    expect(resolveDesktopFeedPlan({}, null)).toEqual([
      { label: 'cn-mirror', feed: { provider: 'generic', url: 'https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed/' } },
      { label: 'github', feed: EXPECTED_GITHUB_FEED },
    ])
  })

  it('UPD-CN-FALLBACK-DESKTOP: env 注入时不回退——计划仅含 env 单源，空串 env 视为未设置', () => {
    const injected = 'http://127.0.0.1:9999/feed/'
    expect(resolveDesktopFeedPlan({ TRAINER_DESKTOP_UPDATE_FEED: injected }, null, MIRROR_BASE))
      .toEqual([{ label: 'env', feed: { provider: 'generic', url: injected } }])
    // 空白 env → 回到 auto 计划（镜像优先）
    expect(resolveDesktopFeedPlan({ TRAINER_DESKTOP_UPDATE_FEED: '   ' }, null, MIRROR_BASE)).toHaveLength(2)
  })

  it('UPD-FEED-SETTING: 三态映射——official 单源 GitHub、custom 单源 generic、custom URL 非法按 auto 下落', () => {
    expect(resolveDesktopFeedPlan({}, { source: 'official', customUrl: null }, MIRROR_BASE))
      .toEqual([{ label: 'github', feed: EXPECTED_GITHUB_FEED }])
    const customUrl = 'https://my.example/feed/'
    expect(resolveDesktopFeedPlan({}, { source: 'custom', customUrl }, MIRROR_BASE))
      .toEqual([{ label: 'custom', feed: { provider: 'generic', url: customUrl } }])
    // custom 但 URL 非 http(s) → fail-safe 落回 auto（镜像优先 GitHub 兜底）
    expect(resolveDesktopFeedPlan({}, { source: 'custom', customUrl: 'ftp://bad.example/x' }, MIRROR_BASE)).toHaveLength(2)
  })

  it('MIRROR-URL-FIX: cnMirrorFeedUrl＝目录形态 feed URL，经 electron-updater 真实解析命中 <base>/latest.yml 而非双拼', () => {
    // MIRROR-URL-FIX RED→GREEN：旧断言＝桩回显（cnMirrorLatestYmlUrl 产出等于
    // cnMirrorLatestYmlUrl 产出），未经库拼接；升级为独立 oracle——函数产出的 feed URL
    // 必须是 electron-updater GenericProvider 的合法 baseUrl（目录形态），经真实
    // newBaseUrl＋newUrlFromBase＋getChannelFilename 拼装后命中 <base>/latest.yml。
    const feedUrl = cnMirrorFeedUrl(MIRROR_BASE)
    expect(feedUrl).toBe(`${MIRROR_BASE}/`)
    // 尾斜杠/多斜杠归一（同一目录形态）
    expect(cnMirrorFeedUrl(`${MIRROR_BASE}//`)).toBe(`${MIRROR_BASE}/`)
    // GenericProvider constructor：baseUrl=newBaseUrl(configuration.url)（pathname 无尾斜杠则补）
    expect(newBaseUrl(feedUrl).href).toBe(`${MIRROR_BASE}/`)
    // GenericProvider.getLatestVersion：channelUrl=newUrlFromBase(getChannelFilename('latest'), baseUrl)
    expect(resolveChannelUrlThroughRealLibrary(feedUrl)).toBe(`${MIRROR_BASE}/latest.yml`)
    // 根因反例锁定（v1.3.2 缺陷形态）：全 URL feed 经同一真实库解析＝双拼 404 路径——
    // W-D 真机复现的 …/feed/latest.yml/latest.yml 404 即此形态
    expect(resolveChannelUrlThroughRealLibrary(`${MIRROR_BASE}/latest.yml`)).toBe(`${MIRROR_BASE}/latest.yml/latest.yml`)
  })
})

/** 注入桩：记录 setFeedURL 序列；checkForUpdates 按当前 feed 可配置行为 */
function stubInnerAdapter(check: (feed: UpdateFeed) => Promise<{ updateAvailable: boolean, version: string, releaseNotes: string | null }>): {
  adapter: DesktopUpdaterAdapter
  feedCalls: UpdateFeed[]
  downloadCalls: number
} {
  const feedCalls: UpdateFeed[] = []
  let current: UpdateFeed | null = null
  const adapter: DesktopUpdaterAdapter = {
    setFeedURL(feed) { feedCalls.push(feed); current = feed },
    async checkForUpdates() {
      if (current === null) throw new Error('stub: setFeedURL 未先于 checkForUpdates 调用')
      return await check(current)
    },
    async downloadUpdate() { return { version: 'stub' } },
    quitAndInstall() { /* 桩 */ },
    onDownloadProgress() { /* 桩 */ },
  }
  return { adapter, feedCalls, downloadCalls: 0 }
}

function isGeneric(feed: UpdateFeed): feed is { provider: 'generic', url: string } {
  return feed.provider === 'generic'
}

describe('CN-FEED-01 回退适配器（createFeedFallbackAdapter，注入桩）', () => {
  it('UPD-CN-FALLBACK-DESKTOP: 镜像失败回退 GitHub 成功——逐源 setFeedURL、结果取 GitHub、attempts 如实记录', async () => {
    const { adapter: inner, feedCalls } = stubInnerAdapter(async feed => {
      if (isGeneric(feed) && feed.url.includes('cn.example')) throw new Error('HTTP 404 fetching latest.yml')
      return { updateAvailable: true, version: '9.9.9', releaseNotes: null }
    })
    const fallback = createFeedFallbackAdapter({
      inner,
      getPlan: async () => resolveDesktopFeedPlan({}, null, MIRROR_BASE),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    const result = await fallback.checkForUpdates()
    // 结果取回退成功源（GitHub）的版本
    expect(result.version).toBe('9.9.9')
    expect(result.updateAvailable).toBe(true)
    // 逐源尝试：先镜像后 GitHub（第二次 setFeedURL 为 GitHub provider；MIRROR-URL-FIX：镜像 feed URL＝目录形态）
    expect(feedCalls).toHaveLength(2)
    expect(isGeneric(feedCalls[0]) ? feedCalls[0].url : '').toBe(`${MIRROR_BASE}/`)
    expect(feedCalls[1]).toEqual(EXPECTED_GITHUB_FEED)
    // 尝试记录如实：镜像 failed（原始 message）、GitHub ok
    const attempts = fallback.lastAttempts()
    expect(attempts).toEqual([
      { label: 'cn-mirror', url: `${MIRROR_BASE}/`, outcome: 'failed', error: 'HTTP 404 fetching latest.yml' },
      { label: 'github', url: 'github:m1kuStark/a-share-kline-trainer', outcome: 'ok', error: null },
    ] satisfies FeedAttemptRecord[])
  })

  it('UPD-CN-FALLBACK-DESKTOP: 镜像可用时不触碰 GitHub——单源尝试即成功', async () => {
    const { adapter: inner, feedCalls } = stubInnerAdapter(async feed => {
      if (!isGeneric(feed)) throw new Error('不应触碰 GitHub 源')
      return { updateAvailable: true, version: '8.8.8', releaseNotes: '镜像直连成功' }
    })
    const fallback = createFeedFallbackAdapter({
      inner,
      getPlan: async () => resolveDesktopFeedPlan({}, null, MIRROR_BASE),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    const result = await fallback.checkForUpdates()
    expect(result.version).toBe('8.8.8')
    expect(feedCalls).toHaveLength(1)
    expect(fallback.lastAttempts()).toEqual([
      { label: 'cn-mirror', url: `${MIRROR_BASE}/`, outcome: 'ok', error: null },
    ])
  })

  it('UPD-CN-FALLBACK-DESKTOP: 全部源失败 → 抛最后一次尝试的错误（错误取最终源），attempts 全 failed', async () => {
    const { adapter: inner } = stubInnerAdapter(async feed => {
      if (isGeneric(feed)) throw new Error('mirror connection refused')
      throw new Error('github request timeout')
    })
    const fallback = createFeedFallbackAdapter({
      inner,
      getPlan: async () => resolveDesktopFeedPlan({}, null, MIRROR_BASE),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    await expect(fallback.checkForUpdates()).rejects.toThrow('github request timeout')
    const attempts = fallback.lastAttempts()
    expect(attempts.map(attempt => attempt.outcome)).toEqual(['failed', 'failed'])
    expect(attempts[1]?.error).toBe('github request timeout')
  })

  it('UPD-CN-FALLBACK-DESKTOP: check 成功后下载沿用成功源——downloadUpdate 前无再次 setFeedURL', async () => {
    let downloads = 0
    const { adapter: inner, feedCalls } = stubInnerAdapter(async feed => {
      if (isGeneric(feed) && feed.url.includes('cn.example')) throw new Error('HTTP 502')
      return { updateAvailable: true, version: '9.9.9', releaseNotes: null }
    })
    const wrappedInner: DesktopUpdaterAdapter = {
      ...inner,
      async downloadUpdate() { downloads += 1; return { version: '9.9.9' } },
    }
    const fallback = createFeedFallbackAdapter({
      inner: wrappedInner,
      getPlan: async () => resolveDesktopFeedPlan({}, null, MIRROR_BASE),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    await fallback.checkForUpdates()
    const setFeedCountAfterCheck = feedCalls.length
    const outcome = await fallback.downloadUpdate()
    expect(outcome.version).toBe('9.9.9')
    expect(downloads).toBe(1)
    // 下载阶段不再改 feed（沿用最终 check 成功的源＝electron-updater 同源下载语义）
    expect(feedCalls.length).toBe(setFeedCountAfterCheck)
  })

  it('UPD-CN-FALLBACK-DESKTOP: 外部 setFeedURL 直设＝显式单源（注入即不回退）', async () => {
    const { adapter: inner, feedCalls } = stubInnerAdapter(async () => {
      throw new Error('env source down')
    })
    const fallback = createFeedFallbackAdapter({
      inner,
      getPlan: async () => resolveDesktopFeedPlan({}, null, MIRROR_BASE),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    fallback.setFeedURL({ provider: 'generic', url: 'http://env.example/feed/' })
    await expect(fallback.checkForUpdates()).rejects.toThrow('env source down')
    // 显式直设后计划只剩该单源（即便 getPlan 给的是双源计划）
    expect(feedCalls).toEqual([{ provider: 'generic', url: 'http://env.example/feed/' }])
    expect(fallback.lastAttempts()).toEqual([
      { label: 'external', url: 'http://env.example/feed/', outcome: 'failed', error: 'env source down' },
    ])
  })
})

describe('CN-FEED-01 boot-check sources 观测缝（update-ipc）', () => {
  /** 等可观测性缝产物落盘（沿 update-boot-check.test.ts waitForFile 口径） */
  async function waitForFile(path: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await access(path); return } catch { await new Promise(resolve => { setTimeout(resolve, 20) }) }
    }
    throw new Error(`可观测性缝产物未在预期时间内落盘：${path}`)
  }

  it('UPD-CN-FALLBACK-DESKTOP: boot-check.json 落盘 sources 尝试记录（label/url/outcome/error 形状）', async () => {
    const outPath = join(tmpdir(), `cnfeed-boot-${randomUUID()}.json`)
    const sources: FeedAttemptRecord[] = [
      { label: 'cn-mirror', url: `${MIRROR_BASE}/`, outcome: 'failed', error: 'HTTP 404 fetching latest.yml' },
      { label: 'github', url: 'github:m1kuStark/a-share-kline-trainer', outcome: 'ok', error: null },
    ]
    registerUpdateIpc({
      ipcMain: { handle: () => { /* 桩 */ } },
      controller: {
        checkForUpdates: async () => ({ currentVersion: '1.3.1', latestVersion: '9.9.9', updateAvailable: true, releaseNotes: null, error: null }),
        downloadAndInstall: async () => ({ ok: true as const }),
      },
      channelKind: 'packaged',
      runBootCheck: async () => ({ currentVersion: '1.3.1', latestVersion: '9.9.9', updateAvailable: true, releaseNotes: null, error: null }),
      bootCheckOutPath: outPath,
      bootCheckSources: () => sources,
      onBootNotice: () => { /* 桩 */ },
      logger: { error: vi.fn(), warn: vi.fn() },
    })
    await waitForFile(outPath)
    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>
    // 既有字段不受影响
    expect(written.channel).toBe('packaged')
    expect(written.latestVersion).toBe('9.9.9')
    // 新增 sources 尝试记录如实透传（W5 真机判断走了哪个源的观测面）
    expect(written.sources).toEqual(sources)
    await rm(outPath, { force: true })
  })
})
