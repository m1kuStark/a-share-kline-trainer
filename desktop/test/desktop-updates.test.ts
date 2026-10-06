// PACK-04 桌面更新通道·纯决策与载荷层单测（矩阵行 UPD-DESKTOP-CHANNEL-PACKAGED /
// CHANNEL-DEV-UNCHANGED / FEED-INJECTABLE / INSTALL-DRAINS-FIRST）。
// oracle 独立性：期望值手写自 PACK-04 派发简报冻结决策与 design.md（docs/verification/2026-10/PACK-04/design.md），
// 不从实现回显；版本比较期望（9.9.9>1.2.7、1.2.7==1.2.7、1.2.6<1.2.7）为独立常识序，
// 与 server version.ts 三段十进制口径一致（UPD-01 已锁定该口径本身）。
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  createDesktopUpdateController,
  mapCheckView,
  normalizeUpdaterError,
  resolveInstallActionOnExit,
  resolveUpdateChannel,
  resolveUpdateFeed,
  type DesktopUpdaterAdapter,
  type DesktopUpdateEvent,
} from '../src/desktop-updates.js'

function fakeAdapter(overrides: Partial<DesktopUpdaterAdapter> = {}): DesktopUpdaterAdapter & {
  calls: { quitAndInstall: number; download: number; check: number; feeds: unknown[] }
} {
  const calls = { quitAndInstall: 0, download: 0, check: 0, feeds: [] as unknown[] }
  const progressListeners: Array<(p: { percent: number, transferred: number, total: number, bytesPerSecond: number }) => void> = []
  const adapter: DesktopUpdaterAdapter = {
    setFeedURL: feed => { calls.feeds.push(feed) },
    checkForUpdates: async () => { calls.check++; return { updateAvailable: true, version: '9.9.9', releaseNotes: 'fixture notes' } },
    downloadUpdate: async () => { calls.download++; return { version: '9.9.9' } },
    quitAndInstall: () => { calls.quitAndInstall++ },
    onDownloadProgress: callback => { progressListeners.push(callback) },
    ...overrides,
  }
  return Object.assign(adapter, { calls, __progressListeners: progressListeners })
}

describe('PACK-04 desktop 更新通道', () => {
  it('UPD-DESKTOP-CHANNEL-PACKAGED: resolveUpdateChannel maps isPackaged to packaged / dev', () => {
    expect(resolveUpdateChannel({ isPackaged: true })).toBe('packaged')
    expect(resolveUpdateChannel({ isPackaged: false })).toBe('dev')
  })

  it('UPD-DESKTOP-FEED-INJECTABLE: env feed beats the frozen GitHub default; blank env is unset', () => {
    // 缺省＝GitHub provider 常量（与 package.json repository 同源，design §3.1）
    expect(resolveUpdateFeed({})).toEqual({ provider: 'github', owner: 'm1kuStark', repo: 'a-share-kline-trainer' })
    expect(resolveUpdateFeed({ TRAINER_DESKTOP_UPDATE_FEED: '   ' })).toEqual({ provider: 'github', owner: 'm1kuStark', repo: 'a-share-kline-trainer' })
    // 注入＝generic provider（本地 fixture / 自建源）；URL 原样保留
    expect(resolveUpdateFeed({ TRAINER_DESKTOP_UPDATE_FEED: 'http://127.0.0.1:3999/' })).toEqual({ provider: 'generic', url: 'http://127.0.0.1:3999/' })
    expect(resolveUpdateFeed({ TRAINER_DESKTOP_UPDATE_FEED: '  https://example.test/feed  ' })).toEqual({ provider: 'generic', url: 'https://example.test/feed' })
  })

  it('UPD-DESKTOP-CHANNEL-PACKAGED: mapCheckView computes updateAvailable with the shared triple-decimal oracle', () => {
    // 新版（9.9.9 > 1.2.7）→ updateAvailable true＋版本原样＋notes 透传
    expect(mapCheckView({ currentVersion: '1.2.7', latestVersion: '9.9.9', releaseNotes: 'n' })).toEqual({
      currentVersion: '1.2.7', latestVersion: '9.9.9', updateAvailable: true, releaseNotes: 'n', error: null,
    })
    // 平版/旧版 → false（与 UPD-CHECK-NO-UPDATE 同口径）
    expect(mapCheckView({ currentVersion: '1.2.7', latestVersion: '1.2.7', releaseNotes: null }).updateAvailable).toBe(false)
    expect(mapCheckView({ currentVersion: '1.2.7', latestVersion: '1.2.6', releaseNotes: null }).updateAvailable).toBe(false)
    // v 前缀容忍（normalizeTagVersion 口径，'v9.9.9'≈'9.9.9'）
    expect(mapCheckView({ currentVersion: '1.2.7', latestVersion: 'v9.9.9', releaseNotes: null }).updateAvailable).toBe(true)
    // 三段十进制（1.2.10 > 1.2.9——锁「不得两套口径」）
    expect(mapCheckView({ currentVersion: '1.2.9', latestVersion: '1.2.10', releaseNotes: null }).updateAvailable).toBe(true)
  })

  it('UPD-DESKTOP-CHANNEL-PACKAGED: mapCheckView maps errors to a human view without partial interpretation', () => {
    // error 优先：不做 updateAvailable 判读（对齐 UPD-CHECK-OFFLINE「不部分解读坏清单」）
    const view = mapCheckView({ currentVersion: '1.2.7', latestVersion: '9.9.9', releaseNotes: 'n', error: '无法检查更新：网络错误' })
    expect(view).toEqual({
      currentVersion: '1.2.7', latestVersion: null, updateAvailable: false, releaseNotes: null, error: '无法检查更新：网络错误',
    })
    // 不可解析版本 → 人话 error，不猜
    const badVersion = mapCheckView({ currentVersion: '1.2.7', latestVersion: 'release-9.9.9', releaseNotes: null })
    expect(badVersion.updateAvailable).toBe(false)
    expect(badVersion.error).toContain('无法比较')
    // currentVersion 缺失 → 不判可用（无从比较），error 说明
    const noCurrent = mapCheckView({ currentVersion: null, latestVersion: '9.9.9', releaseNotes: null })
    expect(noCurrent.updateAvailable).toBe(false)
    expect(noCurrent.error).toBeTruthy()
  })

  it('UPD-DESKTOP-CHANNEL-PACKAGED: normalizeUpdaterError maps known electron-updater codes to human text', () => {
    expect(normalizeUpdaterError(new Error('Cannot find latest.yml in the latest release artifacts (url): boom'))).toContain('latest.yml')
    const normalizedNetwork = normalizeUpdaterError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }))
    expect(normalizedNetwork).toContain('网络')
    expect(normalizeUpdaterError(new Error('boom'))).toBe('boom')
    expect(normalizeUpdaterError('plain string')).toBe('plain string')
  })

  it('UPD-DESKTOP-INSTALL-DRAINS-FIRST: resolveInstallActionOnExit never installs on a forced exit', () => {
    // 排空超时/外层超时（forced）→ plain-quit：绝不带病安装（更新留缓存可重试）
    expect(resolveInstallActionOnExit({ installPending: true, forced: true })).toBe('plain-quit')
    // 正常收敛退出＋有待装更新 → quit-and-install（排空完成后才可能到这一档）
    expect(resolveInstallActionOnExit({ installPending: true, forced: false })).toBe('quit-and-install')
    // 无待装更新 → 正常退出
    expect(resolveInstallActionOnExit({ installPending: false, forced: false })).toBe('plain-quit')
    expect(resolveInstallActionOnExit({ installPending: false, forced: true })).toBe('plain-quit')
  })

  it('UPD-DESKTOP-INSTALL-DRAINS-FIRST: controller routes a finished download through the drain pipeline, never straight to quitAndInstall', async () => {
    const adapter = fakeAdapter()
    const events: DesktopUpdateEvent[] = []
    const drains: number[] = []
    const controller = createDesktopUpdateController({
      getCurrentVersion: () => '1.2.7',
      adapter,
      sendEvent: event => { events.push(event) },
      requestInstallWithDrain: () => { drains.push(1) },
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    const check = await controller.checkForUpdates()
    expect(check.updateAvailable).toBe(true)
    expect(check.latestVersion).toBe('9.9.9')
    expect(check.error).toBeNull()

    const install = await controller.downloadAndInstall()
    expect(install).toEqual({ ok: true })
    // 下载完成 → downloaded 事件＋排空请求被发起；quitAndInstall 从未被 controller 调用（安装只经排空退出管线）
    expect(drains).toHaveLength(1)
    expect(adapter.calls.quitAndInstall).toBe(0)
    expect(events).toContainEqual({ type: 'downloaded', version: '9.9.9' })
  })

  it('UPD-DESKTOP-INSTALL-DRAINS-FIRST: download failures emit error and stay retryable', async () => {
    let failures = 0
    const adapter = fakeAdapter({
      downloadUpdate: async () => { failures++; throw new Error('HTTP 500') },
    })
    const events: DesktopUpdateEvent[] = []
    const drains: number[] = []
    const controller = createDesktopUpdateController({
      getCurrentVersion: () => '1.2.7',
      adapter,
      sendEvent: event => { events.push(event) },
      requestInstallWithDrain: () => { drains.push(1) },
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    await controller.checkForUpdates()
    const first = await controller.downloadAndInstall()
    expect(first.ok).toBe(false)
    expect(first.error).toBe('HTTP 500')
    expect(events).toContainEqual({ type: 'error', message: 'HTTP 500' })
    expect(drains).toHaveLength(0)
    // 可重试：失败后再次调用放行（同 attempt 内不重复拒绝）
    adapter.downloadUpdate = async () => ({ version: '9.9.9' })
    const second = await controller.downloadAndInstall()
    expect(second).toEqual({ ok: true })
    expect(drains).toHaveLength(1)
  })

  it('UPD-DESKTOP-INSTALL-DRAINS-FIRST: concurrent download requests are rejected with a human guard, and an unchecked apply is refused', async () => {
    const adapter = fakeAdapter({ downloadUpdate: () => new Promise(resolve => { setTimeout(() => resolve({ version: '9.9.9' }), 30) }) })
    const controller = createDesktopUpdateController({
      getCurrentVersion: () => '1.2.7',
      adapter,
      sendEvent: () => {},
      requestInstallWithDrain: () => {},
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    // 未检查过 → 拒绝（electron-updater 无 updateInfoAndProvider，自己也不许猜）
    const unchecked = await controller.downloadAndInstall()
    expect(unchecked.ok).toBe(false)
    expect(unchecked.error).toContain('检查更新')
    await controller.checkForUpdates()
    const first = controller.downloadAndInstall()
    const second = await controller.downloadAndInstall()
    expect(second.ok).toBe(false)
    expect(second.error).toContain('进行中')
    expect((await first).ok).toBe(true)
  })

  it('UPD-DESKTOP-CHANNEL-PACKAGED: check failures map to the human error view without throwing', async () => {
    const adapter = fakeAdapter({
      checkForUpdates: async () => { throw Object.assign(new Error('Cannot find latest.yml in the latest release artifacts (http://x/latest.yml): boom'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }) },
    })
    const controller = createDesktopUpdateController({
      getCurrentVersion: () => '1.2.7',
      adapter,
      sendEvent: () => {},
      requestInstallWithDrain: () => {},
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    const view = await controller.checkForUpdates()
    expect(view.updateAvailable).toBe(false)
    expect(view.latestVersion).toBeNull()
    expect(view.error).toContain('latest.yml')
  })
})

describe('PACK-04 主进程粘合源码契约（main.ts / preload.cts）', () => {
  async function readMainSource(): Promise<string> {
    return readFile(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
  }
  async function readPreloadSource(): Promise<string> {
    // sandboxed preload＝CJS 源（.cts，Electron ESM 文档限制），契约对象是源文件本体
    return readFile(fileURLToPath(new URL('../src/preload.cts', import.meta.url)), 'utf8')
  }

  it('UPD-DESKTOP-INSTALL-DRAINS-FIRST: main.ts installs only through resolveInstallActionOnExit inside the quit exit branch', async () => {
    const source = await readMainSource()
    // 安装动作只出现在退出管线的 exit 分支（排空收敛之后）
    expect(source).toMatch(/resolveInstallActionOnExit/)
    expect(source).toMatch(/quitAndInstall/)
    // quitAndInstall 的调用点必须由 resolveInstallActionOnExit 的 'quit-and-install' 分支配守（非直接无条件调用）
    expect(source).toMatch(/quit-and-install[\s\S]{0,200}quitAndInstall/)
  })

  it('UPD-DESKTOP-IPC-MINIMAL: preload exposes a single desktopUpdates object via contextBridge and nothing else', async () => {
    const source = await readPreloadSource()
    expect(source).toMatch(/contextBridge\.exposeInMainWorld\(\s*'desktopUpdates'/)
    // 只暴露一次（无第二个 exposeInMainWorld 面）
    expect(source.match(/exposeInMainWorld/g)?.length).toBe(1)
    // 四成员窄接口
    for (const member of ['channel', 'checkForUpdates', 'downloadAndInstall', 'onUpdateEvent']) {
      expect(source).toContain(member)
    }
  })
})
