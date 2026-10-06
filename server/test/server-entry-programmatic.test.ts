// PACK-01（DESKTOP-SERVER-ENTRY-PROGRAMMATIC）：服务入口可编程启动验证。
// oracle 独立性：期望版本号读包根 package.json（非实现回显）；健康身份三字段口径来自
// PORT-02 冻结语义（status/runId/pid）；静态目录行为来自 @fastify/static 契约（测试自放 index.html）。
// 隔离约束：全部 TRAINER_* 指向临时目录，绝不触碰 %USERPROFILE%\.a-share-kline-trainer。
import { describe, expect, it, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { startTrainerServer, type StartedTrainerServer } from '../src/index.js'

const runId = `run-pack01-${process.pid}-${Date.now()}`
let isolatedRoot: string
let current: StartedTrainerServer | undefined

const EXPECTED_VERSION = (() => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  return pkg.version
})()

async function bootIsolated(): Promise<StartedTrainerServer> {
  isolatedRoot ??= await mkdtemp(join(tmpdir(), 'pack01-entry-'))
  const staticDir = join(isolatedRoot, 'static')
  await mkdir(staticDir, { recursive: true })
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>pack01</title>', 'utf8')
  process.env.TRAINER_RUN_ID = runId
  process.env.TRAINER_DB = join(isolatedRoot, 'trainer.sqlite')
  process.env.TRAINER_STATIC_DIR = staticDir
  process.env.TRAINER_READY_FILE = join(isolatedRoot, 'ready.json')
  process.env.TRAINER_CONTROL_TOKEN = 'tok-pack01'
  process.env.TDX_ROOT = ''
  process.env.OPEN_BROWSER = '0'
  process.env.HOST = '127.0.0.1'
  process.env.PORT = '0'
  return startTrainerServer()
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => { probe.close(() => resolve(true)) })
    probe.listen({ port, host: '127.0.0.1' })
  })
}

describe('DESKTOP-SERVER-ENTRY-PROGRAMMATIC：服务入口进程内可编程启动', () => {
  it('DESKTOP-SERVER-ENTRY-PROGRAMMATIC: startTrainerServer boots in-process on a temp DB and serves health with currentVersion', async () => {
    current = await bootIsolated()
    expect(current.port).toBeGreaterThan(0)
    const health = await fetch(`http://127.0.0.1:${current.port}/api/health`)
    expect(health.status).toBe(200)
    const body = await health.json() as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.runId).toBe(runId)
    expect(body.currentVersion).toBe(EXPECTED_VERSION)
    const page = await fetch(`http://127.0.0.1:${current.port}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>pack01</title>')
  }, 30_000)

  it('DESKTOP-SERVER-ENTRY-PROGRAMMATIC: shutdown closes the app and releases the port', async () => {
    expect(current).toBeTruthy()
    const port = current!.port
    await current!.shutdown()
    await expect(current!.shutdown()).resolves.toBeUndefined()
    expect(await canBindPort(port)).toBe(true)
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()
  }, 30_000)

  // PACK-02（优雅退出接线）：进程内宿主（桌面主进程）复用 SETUP-01 冻结排空控制器的通道。
  // oracle＝drain-controller 冻结合同（prepare(allowActiveTraining) → prepared；无活动训练时立即 prepared），
  // 不是从实现反推：期望 kind=prepared 由控制器语义独立给出。
  it('DESKTOP-SERVER-ENTRY-PROGRAMMATIC: exposes the frozen drain controller for in-process hosts (prepare resolves prepared)', async () => {
    current = await bootIsolated()
    expect(current.drain).toBeTruthy()
    expect(typeof current.drain.prepare).toBe('function')
    expect(typeof current.drain.cancel).toBe('function')
    expect(typeof current.drain.beginShutdown).toBe('function')
    const outcome = await current.drain.prepare('desktop-pack02-attempt', { allowActiveTraining: true })
    expect(outcome.kind).toBe('prepared')
    await current.shutdown()
    expect(await canBindPort(current.port)).toBe(true)
  }, 30_000)

  afterAll(async () => {
    try { await current?.shutdown() } catch { /* already closed */ }
    if (isolatedRoot) await rm(isolatedRoot, { recursive: true, force: true }).catch(() => {})
  })
})
