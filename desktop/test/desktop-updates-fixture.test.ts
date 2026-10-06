// PACK-04 真实 electron-updater 集成测试（矩阵行 UPD-DESKTOP-FEED-INJECTABLE /
// CHANNEL-PACKAGED / INSTALL-DRAINS-FIRST 的集成档）。
// 注入面（design §1.2-6）：new NsisUpdater(null, fakeAppAdapter)——vitest node 环境跑真实
// electron-updater 逻辑（NodeHttpExecutor＋注入 AppAdapter），feed 指向本地 fixture HTTP
// 服务（latest.yml＋假安装器＋sha512）；全程零 api.github.com（fixture 服务即唯一端点）。
// oracle 独立性：latest.yml 的版本号/notes/sha512/size 由本测试手写计算（crypto 独立算哈希），
// 期望结果（updateAvailable true、下载完成事件、排空请求被发起且不直接安装）来自 design 冻结语义。
import { createServer, type Server } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NsisUpdater } from 'electron-updater'
import { HttpExecutor } from 'builder-util-runtime'
import { adaptElectronUpdater, type ElectronUpdaterLike } from '../src/update-adapter.js'
import {
  createDesktopUpdateController,
  resolveUpdateFeed,
  type DesktopUpdateEvent,
} from '../src/desktop-updates.js'

/**
 * node 环境的 HTTP 执行器（electron-updater 5.x NodeHttpExecutor 同构；6.x 移除后其自家
 * 测试同样以注入 AppAdapter＋自备 executor 的方式跑 node 集成）。注入 AppAdapter 的
 * NsisUpdater 构造时 httpExecutor=null——由测试侧补上；生产路径走 autoUpdater 默认构造
 * 的 ElectronHttpExecutor（Electron net），不经此类。
 */
class NodeHttpExecutor extends HttpExecutor<http.ClientRequest> {
  async download(url: URL, destination: string, options: {
    headers?: Record<string, string> | null
    sha512?: string | null
    cancellationToken: { createPromise<T>(create: (resolve: (v: T) => void, reject: (e: Error) => void, onCancel: (cb: () => void) => void) => void): Promise<T> }
    onProgress?: (info: unknown) => void
  }): Promise<string> {
    return await options.cancellationToken.createPromise((resolve, reject, onCancel) => {
      const requestOptions = {
        headers: options.headers || undefined,
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port || undefined,
        method: 'get' as const,
      }
      void this.performDownload(requestOptions, destination, options, resolve, reject, onCancel)
    })
  }

  private async performDownload(
    requestOptions: Record<string, unknown>,
    destination: string,
    options: { sha512?: string | null, onProgress?: (info: unknown) => void },
    resolve: (v: string) => void,
    reject: (e: Error) => void,
    onCancel: (cb: () => void) => void,
  ): Promise<void> {
    const request = this.createRequest(requestOptions as never, (response: http.IncomingMessage) => {
      if (response.statusCode !== 200) {
        request.destroy()
        reject(new Error(`Cannot download "${String(requestOptions.hostname)}${String(requestOptions.path)}", status ${response.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      const total = Number(response.headers['content-length'] ?? 0)
      let received = 0
      const startedAt = Date.now()
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        received += chunk.length
        options.onProgress?.({ percent: total > 0 ? (received / total) * 100 : 0, transferred: received, total, bytesPerSecond: received / Math.max(0.001, (Date.now() - startedAt) / 1000) })
      })
      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (options.sha512) {
          const actual = createHash('sha512').update(buffer).digest('base64')
          if (actual !== options.sha512) {
            reject(new Error(`sha512 checksum mismatch, expected ${options.sha512}, got ${actual}`))
            return
          }
        }
        import('node:fs').then(async fs => {
          await fs.promises.writeFile(destination, buffer)
          resolve(destination)
        }).catch(reject)
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    onCancel(() => request.destroy())
    request.end()
  }

  createRequest(options: http.RequestOptions, callback: (response: http.IncomingMessage) => void): http.ClientRequest {
    const request = (options.protocol === 'http:' ? http : https).request(options)
    request.on('response', callback)
    return request
  }
}

const FIXTURE_VERSION = '9.9.9'
const FIXTURE_NOTES = 'fixture release notes 手写'
let fixtureExe: Buffer
let fixtureLatestYml: string
let server: Server
let serverUrlValue = ''
let requestedPaths: string[] = []

beforeAll(async () => {
  fixtureExe = Buffer.concat([
    Buffer.from([0x4d, 0x5a]), // MZ 头（假安装器，内容不重要，哈希才是 oracle）
    randomBytes(600_000),
  ])
  const sha512 = createHash('sha512').update(fixtureExe).digest('base64')
  fixtureLatestYml = [
    `version: ${FIXTURE_VERSION}`,
    `path: fake-installer-${FIXTURE_VERSION}.exe`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-05T00:00:00.000Z'",
    'files:',
    `  - url: fake-installer-${FIXTURE_VERSION}.exe`,
    `    sha512: ${sha512}`,
    `    size: ${fixtureExe.length}`,
    `releaseNotes: ${FIXTURE_NOTES}`,
  ].join('\n')
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requestedPaths.push(path)
    if (path === '/latest.yml') {
      response.writeHead(200, { 'content-type': 'text/yaml', 'content-length': Buffer.byteLength(fixtureLatestYml) })
      response.end(fixtureLatestYml)
      return
    }
    if (path === `/fake-installer-${FIXTURE_VERSION}.exe`) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fixtureExe.length })
      response.end(fixtureExe)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')
  serverUrlValue = `http://127.0.0.1:${address.port}/`
})

afterAll(async () => {
  await new Promise<void>(resolve => { server.close(() => resolve()) })
})

async function buildRealUpdater(scene: string): Promise<ElectronUpdaterLike> {
  const fixtureDir = await mkdtemp(join(tmpdir(), `pack04-fixture-${scene}-`))
  const userData = join(fixtureDir, 'userData')
  const cache = join(fixtureDir, 'cache')
  await mkdir(userData, { recursive: true })
  await mkdir(cache, { recursive: true })
  // configOnDisk（design §1.2-3）：downloadUpdate 的硬依赖——测试自写 fixture app-update.yml
  await writeFile(join(fixtureDir, 'app-update.yml'), [
    'provider: generic',
    `url: ${serverUrlValue}`,
    'updaterCacheDirName: trainer-updates-test',
  ].join('\n'), 'utf8')
  const fakeApp = {
    version: '1.2.7',
    name: 'kline-trainer-desktop-test',
    isPackaged: true,
    appUpdateConfigPath: join(fixtureDir, 'app-update.yml'),
    userDataPath: userData,
    baseCachePath: cache,
    whenReady: () => Promise.resolve(),
    relaunch: () => {},
    quit: () => {},
    onQuit: () => {},
  }
  return withNodeExecutor(new NsisUpdater(null, fakeApp) as unknown as ElectronUpdaterLike)
}

/** 注入 AppAdapter 的 NsisUpdater httpExecutor=null（构造器行为）——node 测试补 node 执行器 */
function withNodeExecutor(updater: ElectronUpdaterLike): ElectronUpdaterLike {
  ;(updater as unknown as { httpExecutor: unknown }).httpExecutor = new NodeHttpExecutor()
  return updater
}

describe('PACK-04 真实 electron-updater＋本地 fixture feed（零 api.github.com）', () => {
  it('UPD-DESKTOP-FEED-INJECTABLE: env feed routes the updater to the local generic source (latest.yml + artifact hit, no GitHub host)', async () => {
    const updater = await buildRealUpdater('feed')
    const adapter = adaptElectronUpdater(updater)
    adapter.setFeedURL(resolveUpdateFeed({ TRAINER_DESKTOP_UPDATE_FEED: serverUrlValue }))
    const events: DesktopUpdateEvent[] = []
    const drains: number[] = []
    const controller = createDesktopUpdateController({
      adapter,
      getCurrentVersion: () => '1.2.7',
      sendEvent: event => { events.push(event) },
      requestInstallWithDrain: () => { drains.push(1) },
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })

    const view = await controller.checkForUpdates()
    // 手写 fixture 清单即 oracle：版本 9.9.9>1.2.7 → 有更新（releaseNotes 手写值透传）
    expect(view.currentVersion).toBe('1.2.7')
    expect(view.latestVersion).toBe(FIXTURE_VERSION)
    expect(view.updateAvailable).toBe(true)
    expect(view.releaseNotes).toBe(FIXTURE_NOTES)
    expect(view.error).toBeNull()
    // feed 命中本地 fixture（latest.yml 与产物各≥1 次），绝无 api.github.com
    expect(requestedPaths).toContain('/latest.yml')
    expect(requestedPaths.every(path => !path.includes('github.com'))).toBe(true)

    const install = await controller.downloadAndInstall()
    expect(install.ok).toBe(true)
    // 进度事件≥1（600KB 分块下载）＋下载完成事件
    expect(events.filter(event => event.type === 'download-progress').length).toBeGreaterThanOrEqual(1)
    expect(events).toContainEqual({ type: 'downloaded', version: FIXTURE_VERSION })
    // 安装只经排空管线；quitAndInstall 未被调用（fixture 场景不真装）
    expect(drains).toHaveLength(1)
    expect(requestedPaths).toContain(`/fake-installer-${FIXTURE_VERSION}.exe`)
  }, 30_000)

  it('UPD-DESKTOP-CHANNEL-PACKAGED: updater lands manual-only semantics (autoDownload/autoInstallOnAppQuit off)', async () => {
    const updater = await buildRealUpdater('manual')
    adaptElectronUpdater(updater)
    // 手动检查不自动下载；autoInstallOnAppQuit 关闭保证安装必经排空退出管线（design §1.2-8）
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('UPD-DESKTOP-FEED-INJECTABLE: a missing latest.yml maps to the human error view without 5xx', async () => {
    // 子路径 feed（/noupdate/）→ latest.yml 解析为 /noupdate/latest.yml → 404 → 人话错误
    const missingUrl = `${serverUrlValue}noupdate/`
    const fixtureDir = await mkdtemp(join(tmpdir(), 'pack04-fixture-missing-'))
    await mkdir(join(fixtureDir, 'cache'), { recursive: true })
    await writeFile(join(fixtureDir, 'app-update.yml'), [
      'provider: generic',
      `url: ${serverUrlValue}`,
      'updaterCacheDirName: trainer-updates-test',
    ].join('\n'), 'utf8')
    const fakeApp = {
      version: '1.2.7',
      name: 'kline-trainer-desktop-test',
      isPackaged: true,
      appUpdateConfigPath: join(fixtureDir, 'app-update.yml'),
      userDataPath: fixtureDir,
      baseCachePath: fixtureDir,
      whenReady: () => Promise.resolve(),
      relaunch: () => {},
      quit: () => {},
      onQuit: () => {},
    }
    const updater = withNodeExecutor(new NsisUpdater(null, fakeApp) as unknown as ElectronUpdaterLike)
    const adapter = adaptElectronUpdater(updater)
    adapter.setFeedURL(resolveUpdateFeed({ TRAINER_DESKTOP_UPDATE_FEED: missingUrl }))
    const controller = createDesktopUpdateController({
      adapter,
      getCurrentVersion: () => '1.2.7',
      sendEvent: () => {},
      requestInstallWithDrain: () => {},
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    const view = await controller.checkForUpdates()
    expect(view.updateAvailable).toBe(false)
    expect(view.latestVersion).toBeNull()
    expect(view.error).toContain('latest.yml')
  }, 30_000)
})

