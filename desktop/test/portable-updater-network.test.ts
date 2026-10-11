// PORT-UPD-01 默认网络层·真实 http 端到端（P0-3 修复绑定）。
// 背景（用户真机确认的崩溃证据）：便携 exe 下载 117MB 更新时响应流确定性截断
// （feed 少发 100,500 字节）→ 全局 fetch（undici）在 socket 异常结束路径抛
// AssertionError [ERR_ASSERTION] assert(this.paused)（Parser.finish→Socket.onHttpSocketEnd）
// → Electron 主进程 uncaught exception 弹 Error 窗。undici 内部断言经异步路径抛出，
// 任何 try/catch 均不可拦，故修复＝网络层换 Node 原生 http/https。
// 本文件不注入 fetchText/downloadToFile 桩——走 createPortableUpdaterAdapter 默认实现
// × 真实 node http server（真实入口边界；既有用例全部桩注入，正是漏过本 bug 的原因）。
// oracle 独立性：截断字节数、sha512、期望消息中的已收/应收数值全部测试侧手写计算
//（真机证据：Content-Length 117083674 vs 实收 116983174，差 100,500 字节）；
// 服务器以「声明 Content-Length=N 实发 N−k 后 FIN（py http.server 确定性少发形态）/
// destroy socket（RST 形态）」复现截断。
import { describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortableUpdaterAdapter, portableArtifactName } from '../src/portable-updater.js'
import type { UpdateFeed } from '../src/desktop-updates.js'

const sha512Base64 = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

/** 确定性伪随机字节（LCG，测试侧独立构造，非实现回显） */
function deterministicBytes(total: number): Buffer {
  const buffer = Buffer.alloc(total)
  let seed = 0x2a7f03c1
  for (let i = 0; i < total; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    buffer[i] = seed >>> 24
  }
  return buffer
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('listen: 未拿到端口')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** 测试侧手写 latest.yml（形状＝release-desktop-lib.mjs renderLatestYml 冻结形状，与主测试文件同源） */
function latestYml(version: string, portableName: string, size: number, sha512: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${portableName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    "releaseDate: '2026-10-11T00:00:00.000Z'",
    '',
  ].join('\n')
}

/** 适配器依赖：网络/spawn 全默认（真实网络层入口），feed 指向测试 server，fs 走真实临时目录 */
function makeRealNetDeps(feedBase: string, dataDir: string) {
  const calls = { applyFailures: [] as string[] }
  return {
    deps: {
      exePath: join(tmpdir(), 'apps', 'K线训练器.exe'),
      env: {},
      getDataDir: () => dataDir,
      getCurrentVersion: () => '1.2.7',
      feed: { provider: 'generic', url: feedBase } satisfies UpdateFeed,
      quitApp: () => { /* 网络用例不触达 apply 分支 */ },
      pid: 4242,
      onApplyFailure: (message: string) => { calls.applyFailures.push(message) },
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    },
    calls,
  }
}

// ===== P0-3 核心：截断响应必须以受控人话 Error 冒泡，绝不让网络层内部异常外溢 =====
// 真机形态（Electron 44 / undici）：本场景以主进程 AssertionError 崩溃呈现；
// 本机 Node 24 纯 undici 呈现为受控 TypeError「terminated」（无已收/应收信息）——
// 两种 RED 形态都不可接受：缺少字节信息即无法诊断，崩溃即主进程死亡。
describe('PORT-UPD-01 默认网络层·响应截断（真机崩溃场景回放）', () => {
  it('下载截断（声明 N 实发 N−500 后 FIN，py http.server 少发形态）→ 受控 Error 含已收/应收字节，staging 部分文件清理，进程不崩', async () => {
    const N = 100_000, K = 500
    const bytes = deterministicBytes(N)
    const version = '9.9.9'
    const name = portableArtifactName(version)
    const server = createServer((req, res) => {
      if (req.url === '/feed/latest.yml') {
        const yml = latestYml(version, name, N, sha512Base64(bytes))
        res.writeHead(200, { 'content-length': Buffer.byteLength(yml) })
        res.end(yml)
        return
      }
      if (req.url === `/feed/${name}`) {
        res.writeHead(200, { 'content-length': N })
        res.write(bytes.subarray(0, N - K), () => res.end())
        return
      }
      res.writeHead(404).end('not found')
    })
    // node http server 对 content-length 缺口响应的 end() 不立即断连，而是等
    // keepAliveTimeout（默认 5s）才关连接——收紧到 300ms 让提前结束在 vitest 5s
    // 预算内可见（客户端契约不变：无论服务端何时断，截断必须转人话 Error）。
    server.keepAliveTimeout = 300
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      await mkdir(dataDir, { recursive: true })
      const { deps } = makeRealNetDeps(`${base}/feed`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      // 期望数值测试侧独立计算：N−K = 99500 已收 / 100000 应收（真机 116983174/117083674 同构）
      await expect(adapter.downloadUpdate()).rejects.toThrow(/已收 99500\/100000 字节/)
      // fail-closed 保持：部分下载文件不留在 staging
      expect(await readdir(join(dataDir, 'update-staging'))).not.toContain(name)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })

  it('下载截断（实发 N−500 后 destroy socket，RST 形态）→ 受控 Error 含已收/应收字节', async () => {
    const N = 100_000, K = 500
    const bytes = deterministicBytes(N)
    const version = '9.9.9'
    const name = portableArtifactName(version)
    const server = createServer((req, res) => {
      if (req.url === '/feed/latest.yml') {
        const yml = latestYml(version, name, N, sha512Base64(bytes))
        res.writeHead(200, { 'content-length': Buffer.byteLength(yml) })
        res.end(yml)
        return
      }
      if (req.url === `/feed/${name}`) {
        res.writeHead(200, { 'content-length': N })
        res.write(bytes.subarray(0, N - K), () => { res.socket?.destroy() })
        return
      }
      res.writeHead(404).end('not found')
    })
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      await mkdir(dataDir, { recursive: true })
      const { deps } = makeRealNetDeps(`${base}/feed`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      // RST 下已收字节数不保证精确（在途数据可能被丢），锁「已收 <数字>/100000 字节」形态
      await expect(adapter.downloadUpdate()).rejects.toThrow(/已收 \d+\/100000 字节/)
      expect(await readdir(join(dataDir, 'update-staging'))).not.toContain(name)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })

  it('latest.yml 拉取截断（声明 2048 实发 1948 后 FIN）→ checkForUpdates 受控 reject（含已收/应收字节）', async () => {
    const yml = latestYml('9.9.9', portableArtifactName('9.9.9'), 1, sha512Base64(new Uint8Array([1])))
    const N = Buffer.byteLength(yml)
    const K = 100
    const ymlBytes = Buffer.from(yml, 'utf8')
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-length': N })
      res.write(ymlBytes.subarray(0, N - K), () => res.end())
    })
    // 同上：收紧 keepAliveTimeout 让 FIN 在测试预算内到达
    server.keepAliveTimeout = 300
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      const { deps } = makeRealNetDeps(`${base}/feed`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      await expect(adapter.checkForUpdates()).rejects.toThrow(/已收 \d+\/\d+ 字节/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })
})

// ===== 非 2xx 与正常路径回归 =====
describe('PORT-UPD-01 默认网络层·状态码与正常路径', () => {
  it('HTTP 503 → 人话 HTTP 503（不抛裸异常）', async () => {
    const server = createServer((req, res) => {
      res.writeHead(503, { 'content-length': 0 })
      res.end()
    })
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      const { deps } = makeRealNetDeps(`${base}/feed`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      await expect(adapter.checkForUpdates()).rejects.toThrow(/HTTP 503/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })

  it('完整响应：落盘字节逐一致、进度回调单调递增且 total＝content-length、下载校验通过', async () => {
    const N = 300_000
    const bytes = deterministicBytes(N)
    const version = '9.9.9'
    const name = portableArtifactName(version)
    const server = createServer((req, res) => {
      if (req.url === '/feed/latest.yml') {
        const yml = latestYml(version, name, N, sha512Base64(bytes))
        res.writeHead(200, { 'content-length': Buffer.byteLength(yml) })
        res.end(yml)
        return
      }
      if (req.url === `/feed/${name}`) {
        res.writeHead(200, { 'content-length': N })
        res.end(bytes)
        return
      }
      res.writeHead(404).end('not found')
    })
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      await mkdir(dataDir, { recursive: true })
      const { deps } = makeRealNetDeps(`${base}/feed`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      const progress: Array<{ transferred: number, total: number }> = []
      adapter.onDownloadProgress(p => { progress.push({ transferred: p.transferred, total: p.total }) })
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).resolves.toEqual({ version: '9.9.9' })
      expect(progress.length).toBeGreaterThan(0)
      expect(progress.at(-1)).toEqual({ transferred: N, total: N })
      for (const p of progress) expect(p.total).toBe(N)
      for (let i = 1; i < progress.length; i++) expect(progress[i].transferred).toBeGreaterThan(progress[i - 1].transferred)
      expect((await readFile(join(dataDir, 'update-staging', name))).equals(bytes)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })

  it('content-length 缺失（chunked）→ total=0 语义保持，仍可完整下载校验通过', async () => {
    const N = 150_000
    const bytes = deterministicBytes(N)
    const version = '9.9.9'
    const name = portableArtifactName(version)
    const server = createServer((req, res) => {
      if (req.url === '/feed/latest.yml') {
        const yml = latestYml(version, name, N, sha512Base64(bytes))
        res.writeHead(200, { 'content-length': Buffer.byteLength(yml) })
        res.end(yml)
        return
      }
      if (req.url === `/feed/${name}`) {
        res.writeHead(200)
        res.end(bytes)
        return
      }
      res.writeHead(404).end('not found')
    })
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      await mkdir(dataDir, { recursive: true })
      const { deps } = makeRealNetDeps(`${base}/feed`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      const progress: Array<{ transferred: number, total: number }> = []
      adapter.onDownloadProgress(p => { progress.push({ transferred: p.transferred, total: p.total }) })
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).resolves.toEqual({ version: '9.9.9' })
      expect(progress.at(-1)).toEqual({ transferred: N, total: 0 })
      expect((await readFile(join(dataDir, 'update-staging', name))).equals(bytes)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })

  it('重定向（GitHub releases/latest/download 302 → CDN 形态）→ 跟随重定向完成下载（不把 302 当错误）', async () => {
    const N = 100_000
    const bytes = deterministicBytes(N)
    const version = '9.9.9'
    const name = portableArtifactName(version)
    const server = createServer((req, res) => {
      if (req.url === '/redirect/latest.yml' || req.url === `/redirect/${name}`) {
        res.writeHead(302, { location: `/real${req.url.slice('/redirect'.length)}` })
        res.end()
        return
      }
      if (req.url === '/real/latest.yml') {
        const yml = latestYml(version, name, N, sha512Base64(bytes))
        res.writeHead(200, { 'content-length': Buffer.byteLength(yml) })
        res.end(yml)
        return
      }
      if (req.url === `/real/${name}`) {
        res.writeHead(200, { 'content-length': N })
        res.end(bytes)
        return
      }
      res.writeHead(404).end('not found')
    })
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'portable-net-'))
    try {
      const dataDir = join(root, 'data')
      await mkdir(dataDir, { recursive: true })
      const { deps } = makeRealNetDeps(`${base}/redirect`, dataDir)
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).resolves.toEqual({ version: '9.9.9' })
      expect((await readFile(join(dataDir, 'update-staging', name))).equals(bytes)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })
})
