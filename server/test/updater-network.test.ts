// P0-4（PORT-UPD-01）主进程内更新域默认网络层·真实 http 端到端（调用点级）。
// 矩阵行：UPD-NET-ROBUST-PROCESS-WIDE（planned → 本文件提供绑定面）。
// 与既有 updater-* 用例的区别：那些用例对 manifestFetch/downloadFetch/control 等
// IO 边界全注入桩（正是漏过用户真机崩溃的原因）；本文件刻意走默认实现 × 真实
// node http server，复现「用户网络对 GitHub 不稳 → 响应流截断」场景，锁：
//   - server/src/update/manifest.ts 默认清单拉取（fetchUpdateManifest 不注入 fetchText）
//   - server/src/update/api.ts 默认 manifestFetch＋downloadFetch（/api/update/check 与
//     /api/update/apply 的下载链）
//   - server/src/update/updater.ts 默认控制面 postControl（经 runFromPlan 真实入口）
// 截断必须转人话错误（含已收/应收字节）受控返回，绝不外溢网络层内部异常。
// 本机 Node 24 的 undici（全局 fetch）对同类截断呈现为裸 TypeError「terminated」
// （无字节信息）——RED 即此形态；Electron 44 真机则弹主进程崩溃窗（P0-3 已证）。
// oracle 独立性：截断字节数与期望消息中的数值全部测试侧手写；清单/包夹具复用
// helpers/updater-fixtures.ts（构造工具，非被测实现回显）。

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { registerUpdateApi } from '../src/update/api.js'
import { fetchUpdateManifest } from '../src/update/manifest.js'
import { defaultDeps, runFromPlan } from '../src/update/updater.js'
import type { UpdatePlan } from '../src/update/updater-core.js'
import { makeTmpDir, writeMiniPackage } from './helpers/updater-fixtures.js'

const CURRENT_VERSION = '1.2.7'
const NEW_VERSION = '1.2.8'
const ZIP_NAME = `kline-trainer-v${NEW_VERSION}-windows-x64.zip`

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

/** GitHub Releases latest API 形状清单（测试侧手写，URL 指向本测试 server） */
function manifestBody(base: string): string {
  return JSON.stringify({
    tag_name: `v${NEW_VERSION}`,
    body: `release notes for ${NEW_VERSION}`,
    assets: [
      { name: ZIP_NAME, browser_download_url: `${base}/files/${ZIP_NAME}`, size: 100_000 },
      { name: 'SHA256SUMS', browser_download_url: `${base}/files/SHA256SUMS`, size: 96 },
    ],
  })
}

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

function track(server: Server): void {
  closers.push(() => closeServer(server))
}

// ===== manifest.ts 默认清单拉取（用户网络对 GitHub 不稳的主崩源） =====
describe('UPD-NET-ROBUST-PROCESS-WIDE: manifest.ts 默认清单拉取（不注入 fetchText）', () => {
  it('截断的 latest 清单（声明 N 实发 N−k 后 FIN）→ 人话错误含已收/应收字节（不外溢网络层内部异常）', async () => {
    const full = manifestBody('http://127.0.0.1:1')
    const N = Buffer.byteLength(full)
    const K = 120
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': N })
      res.write(Buffer.from(full, 'utf8').subarray(0, N - K), () => res.end())
    })
    server.keepAliveTimeout = 300
    const base = await listen(server)
    track(server)
    // 不注入 fetchText → 默认实现（P0-4 后＝safe-http；之前＝全局 fetch/undici）
    const result = await fetchUpdateManifest(`${base}/latest.json`)
    expect(result.ok).toBe(false)
    // 期望数值测试侧独立计算：N−K 已收 / N 应收；undici 形态为「terminated」（无字节）＝ RED
    expect(result.ok === false && result.error).toMatch(/已收 \d+\/\d+ 字节/)
  })

  it('HTTP 503 的清单服务 → 人话错误含 HTTP 503（不崩不裸抛）', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-length': 0 })
      res.end()
    })
    const base = await listen(server)
    track(server)
    const result = await fetchUpdateManifest(`${base}/latest.json`)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('HTTP 503')
  })
})

// ===== api.ts 默认 manifestFetch / downloadFetch（/api/update/check 与 apply 下载链） =====
describe('UPD-NET-ROBUST-PROCESS-WIDE: api.ts 默认网络实现（不注入 manifestFetch/downloadFetch）', () => {
  it('check 端点对截断的清单服务 → 200＋人话 error 含已收/应收字节（不 5xx、不崩进程）', async () => {
    const full = manifestBody('http://127.0.0.1:1')
    const N = Buffer.byteLength(full)
    const K = 80
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': N })
      res.write(Buffer.from(full, 'utf8').subarray(0, N - K), () => res.end())
    })
    server.keepAliveTimeout = 300
    const base = await listen(server)
    track(server)
    const packageRoot = await makeTmpDir('trainer-net-pkg-')
    await writeMiniPackage(packageRoot, { version: CURRENT_VERSION })
    const app = Fastify()
    const config = { dataDir: null, launcherConfigPath: null, runId: null } as unknown as AppConfig
    await registerUpdateApi(app, config, { packageRoot, manifestUrl: `${base}/latest.json` })
    closers.push(() => app.close())
    const response = await app.inject({ method: 'GET', url: '/api/update/check' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.updateAvailable).toBe(false)
    expect(body.error).toMatch(/无法检查更新/)
    expect(body.error).toMatch(/已收 \d+\/\d+ 字节/)
  })

  it('apply 下载链对截断的 zip 资产服务 → 状态机 failed 且 error 含已收/应收字节（不崩进程）', async () => {
    const N = 100_000, K = 500
    const sumsText = `${'a'.repeat(64)}  ${ZIP_NAME}\n`
    const server = createServer((req, res) => {
      if (req.url === '/latest.json') {
        const manifest = manifestBody(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
        res.writeHead(200, { 'content-length': Buffer.byteLength(manifest) })
        res.end(manifest)
        return
      }
      if (req.url === '/files/SHA256SUMS') {
        res.writeHead(200, { 'content-length': Buffer.byteLength(sumsText) })
        res.end(sumsText)
        return
      }
      if (req.url === `/files/${ZIP_NAME}`) {
        // 截断：声明 100000 实发 99500 后 FIN（py http.server 少发形态）
        res.writeHead(200, { 'content-length': N })
        res.write(Buffer.alloc(N - K, 7), () => res.end())
        return
      }
      res.writeHead(404).end('not found')
    })
    server.keepAliveTimeout = 300
    const base = await listen(server)
    track(server)
    const packageRoot = await makeTmpDir('trainer-net-apply-')
    await writeMiniPackage(packageRoot, { version: CURRENT_VERSION })
    const dataDir = join(packageRoot, 'data')
    const app = Fastify()
    const config = { dataDir, launcherConfigPath: null, runId: 'run-net-test' } as unknown as AppConfig
    const tracked: Promise<unknown>[] = []
    await registerUpdateApi(app, config, {
      packageRoot,
      manifestUrl: `${base}/latest.json`,
      env: { TRAINER_LAUNCHER_CJS: join(packageRoot, 'launcher.cjs') },
      getActiveTraining: () => null,
      trackTask: task => { tracked.push(task) },
      updaterEntryPath: join(packageRoot, 'server', 'dist', 'update', 'updater.js'),
    })
    closers.push(() => app.close())
    const accepted = await app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(accepted.statusCode).toBe(202)
    await Promise.all(tracked)
    const statusResponse = await app.inject({ method: 'GET', url: '/api/update/status' })
    expect(statusResponse.statusCode).toBe(200)
    const status = statusResponse.json()
    expect(status.state).toBe('failed')
    // 期望数值测试侧独立计算：99500 已收 / 100000 应收；undici 形态为「terminated」＝ RED
    expect(status.error).toMatch(/已收 \d+\/100000 字节/)
  })
})

// ===== updater.ts 默认控制面与健康探测（runFromPlan 真实入口，仅注入不涉网络环节） =====
describe('UPD-NET-ROBUST-PROCESS-WIDE: updater.ts 默认 localhost 控制面与健康探测', () => {
  async function makePlan(dataDir: string, serverPort: number, serverPid: number): Promise<UpdatePlan> {
    return {
      version: 1,
      appId: 'a-share-kline-trainer',
      attemptId: 'update-net-test',
      createdAt: new Date().toISOString(),
      packageRoot: dataDir,
      dataDir,
      zipPath: join(dataDir, 'update-downloads', 'update-net-test.zip'),
      zipSha256: null,
      expectedVersion: NEW_VERSION,
      artifactName: ZIP_NAME,
      serverPid,
      serverPort,
      runId: 'run-net-test',
      launcherPath: 'C:/nowhere/launcher.cjs',
      nodePath: process.execPath,
      backupKeep: 5,
    }
  }

  it('控制面 503＋截断错误体 → postControl 受控失败，状态机 error 含已收/应收字节（经 runFromPlan 真实默认 control）', async () => {
    const N = 300, K = 100
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-length': N, 'content-type': 'application/json' })
      res.write(Buffer.alloc(N - K, 0x20), () => res.end())
    })
    server.keepAliveTimeout = 300
    const base = await listen(server)
    track(server)
    const port = Number(new URL(base).port)
    const dataDir = await makeTmpDir('trainer-net-ctl-')
    const plan = await makePlan(dataDir, port, process.pid)
    const previousToken = process.env.TRAINER_CONTROL_TOKEN
    process.env.TRAINER_CONTROL_TOKEN = 'token-net-test'
    try {
      await runFromPlan(plan) // 不注入任何 deps → control.prepare 走默认 postControl
    } finally {
      if (previousToken === undefined) delete process.env.TRAINER_CONTROL_TOKEN
      else process.env.TRAINER_CONTROL_TOKEN = previousToken
    }
    const status = JSON.parse(await readFile(join(dataDir, 'update-status.json'), 'utf8')) as { state: string, error: string }
    expect(status.state).toBe('failed')
    // 旧实现（fetch）：截断体被 postControl 内层 catch 吞掉 → 裸「HTTP 503」（无字节）＝ RED
    expect(status.error).toMatch(/已收 \d+\/300 字节/)
  })

  it('控制面 503＋完整 JSON 错误体 → 失败原因呈现 body.error 码（既有语义不回退）', async () => {
    const bodyText = JSON.stringify({ error: 'ACTIVE_TRAINING' })
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(bodyText)
    })
    const base = await listen(server)
    track(server)
    const port = Number(new URL(base).port)
    const dataDir = await makeTmpDir('trainer-net-ctl2-')
    const plan = await makePlan(dataDir, port, process.pid)
    const previousToken = process.env.TRAINER_CONTROL_TOKEN
    process.env.TRAINER_CONTROL_TOKEN = 'token-net-test'
    try {
      await runFromPlan(plan)
    } finally {
      if (previousToken === undefined) delete process.env.TRAINER_CONTROL_TOKEN
      else process.env.TRAINER_CONTROL_TOKEN = previousToken
    }
    const status = JSON.parse(await readFile(join(dataDir, 'update-status.json'), 'utf8')) as { state: string, error: string }
    expect(status.state).toBe('failed')
    expect(status.error).toContain('ACTIVE_TRAINING')
  })

  it('waitServerExit 默认实现：端口已无服务（ECONNREFUSED）→ 立即 ok（拒绝形态不误判占用）', async () => {
    const holder = createServer()
    const base = await listen(holder)
    const port = Number(new URL(base).port)
    await closeServer(holder)
    // 死 pid：spawn 一个立即退出的进程并等它结束
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    const deadPid = child.pid ?? process.pid
    await new Promise<void>(resolve => child.once('exit', () => resolve()))
    const plan = await makePlan(await makeTmpDir('trainer-net-exit-'), port, deadPid)
    const outcome = await defaultDeps.waitServerExit(plan)
    expect(outcome).toEqual({ ok: true })
  })

  it('waitHealthy 默认实现：健康 200 且版本匹配 → 立即确认（默认 GET＋JSON 解析保持）', async () => {
    const bodyText = JSON.stringify({ status: 'ok', runId: 'run-net-test', pid: 4321, currentVersion: NEW_VERSION })
    const server = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyText) })
        res.end(bodyText)
        return
      }
      res.writeHead(404).end()
    })
    const base = await listen(server)
    track(server)
    const port = Number(new URL(base).port)
    const plan = await makePlan(await makeTmpDir('trainer-net-hl-'), port, process.pid)
    const outcome = await defaultDeps.waitHealthy(plan, NEW_VERSION)
    expect(outcome.ok).toBe(true)
    expect(outcome.version).toBe(NEW_VERSION)
  })
})

// ===== 源码契约：主进程网络路径绝不再使用全局 fetch（undici） =====
describe('UPD-NET-ROBUST-PROCESS-WIDE: 主进程网络路径源码契约（无全局 fetch）', () => {
  async function readSource(relative: string): Promise<string> {
    return readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
  }

  it('manifest.ts / api.ts / updater.ts 源码不再出现全局 fetch 调用（换线到 safe-http）', async () => {
    for (const relative of ['../src/update/manifest.ts', '../src/update/api.ts', '../src/update/updater.ts']) {
      const source = await readSource(relative)
      // \b 排除 manifestFetch/downloadFetch 等标识符；调用式 fetch( 只允许出现在 safe-http.ts
      expect(source, relative).not.toMatch(/\bfetch\(/)
      expect(source, relative).toMatch(/safe-http\.js/)
    }
  })
})
