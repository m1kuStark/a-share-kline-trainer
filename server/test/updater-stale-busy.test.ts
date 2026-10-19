// UPD-BUSY-HEAL-01（矩阵行 UPD-STALE-BUSY-SELFHEAL）：zip 更新链陈旧 busy 状态无感自愈。
// 场景＝冷审 G1（docs/verification/2026-10/U5-BRIEF/cold-review.md）：更新器/服务在
// 五 busy 态任一被杀（杀软误杀 detached 更新器、断电等已知根因）后，状态文件残留
// busy——修复前 apply 永久 409 UPDATE_IN_PROGRESS（在线更新通道自锁）。
// 期望（oracle＝用户 2026-10-19 批复 2 原话：已知根因的报错应当能够通过重试机制自动
// 诊断和处理，用户不希望看到报错）：
//   - 陈旧 busy（updatedAt 超阈值且无活跃 attempt）→ apply 复位 failed（人话原因落日志）
//     ＋同一请求内重试放行（202，用户看到正常流程而非 409）；
//   - 真 busy（新鲜状态，含缺 updatedAt 的旧形态文件）→ 仍 409 UPDATE_IN_PROGRESS；
//   - 阈值缺省 30 分钟（proposed_default），env TRAINER_UPDATE_STALE_BUSY_MS 可覆盖，
//     非法值回默认（fail-closed：坏 env 不放宽守卫）；
//   - 服务启动期 reconcile 同步复位陈旧 busy，不误伤 restarting→completed 既有路径。
// 纪律：陈旧形态状态文件直写 JSON（writeUpdateStatus 会把 updatedAt 刷新为现在，
// 无法构造陈旧时间戳）；期望独立于实现（边界 29/31 分钟手算，非读常量）。

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { registerUpdateApi } from '../src/update/api.js'
import { APP_ID, STATUS_FILE, UPDATE_STATES, type UpdateState } from '../src/update/status.js'
import { startTrainerServer, type StartedTrainerServer } from '../src/index.js'
import type { UpdatePlan } from '../src/update/updater-core.js'
import { runFromPlan } from '../src/update/updater.js'
import {
  buildReleaseZip, fakeBufferResponse, fakeTextResponse, makeTmpDir, sha256Bytes, writeMiniPackage,
} from './helpers/updater-fixtures.js'

const OLD_VERSION = '1.2.7'
const NEW_VERSION = '1.2.8'
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

/** 直写状态文件（绕过 writeUpdateStatus 的 updatedAt=now 刷新），构造指定年龄的记录。 */
async function writeRawStatus(dataDir: string, record: Record<string, unknown>, ageMs: number | null): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const body: Record<string, unknown> = {
    version: 1,
    appId: APP_ID,
    attemptId: 'update-dead-beef',
    state: 'applying',
    progress: null,
    error: null,
    fromVersion: '1.2.6',
    targetVersion: '1.2.7',
    ...record,
  }
  if (ageMs !== null) body.updatedAt = new Date(Date.now() - ageMs).toISOString()
  await writeFile(join(dataDir, STATUS_FILE), `${JSON.stringify(body, null, 2)}\n`)
}

interface Harness {
  app: FastifyInstance
  oldRoot: string
  dataDir: string
  tracked: Promise<unknown>[]
  logs: string[]
}

/** 复刻 updater-apply.test.ts 的注入面 harness（零网络、更新器内联编排）。 */
async function buildApplyHarness(options: { env?: Record<string, string | undefined> } = {}): Promise<Harness> {
  const workDir = await makeTmpDir('trainer-upd-stale-')
  await writeFile(join(workDir, 'updater-entry-dummy.js'), '// dummy updater entry (launchUpdater is injected)\n')
  const oldRoot = join(workDir, 'kline-trainer-v1.2.7-installed')
  await writeMiniPackage(oldRoot, {
    version: OLD_VERSION,
    nodeVersion: '24.1.1',
    files: { 'server/dist/index.js': 'old server\n' },
    preserve: { trainerConfig: '{\n  "port": 8787\n}\n', sqlite: 'sqlite-bytes' },
  })
  const dataDir = join(oldRoot, 'data')
  const { buffer: newZip, artifactName } = await buildReleaseZip({
    version: NEW_VERSION,
    nodeVersion: '24.1.1',
    files: { 'server/dist/index.js': 'new server v1.2.8\n' },
  }, await makeTmpDir('trainer-upd-stale-new-'))
  const sumsText = `${await sha256Bytes(newZip)}  ${artifactName}.zip\n`
  const manifestBody = JSON.stringify({
    tag_name: `v${NEW_VERSION}`,
    body: `release notes for ${NEW_VERSION}`,
    assets: [
      { name: `${artifactName}.zip`, browser_download_url: 'fixture://zip', size: newZip.length },
      { name: 'SHA256SUMS', browser_download_url: 'fixture://sums', size: 96 },
    ],
  })
  const tracked: Promise<unknown>[] = []
  const logs: string[] = []
  const app = Fastify()
  const config = {
    dataDir,
    launcherConfigPath: null,
    runId: 'run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    databasePath: join(dataDir, 'trainer.sqlite'),
  } as unknown as AppConfig
  await registerUpdateApi(app, config, {
    packageRoot: oldRoot,
    env: { TRAINER_LAUNCHER_CJS: join(oldRoot, 'launcher.cjs'), ...options.env },
    manifestFetch: async () => manifestBody,
    downloadFetch: async (url: string) => url === 'fixture://sums' ? fakeTextResponse(sumsText) : fakeBufferResponse(newZip),
    getActiveTraining: () => null,
    updaterEntryPath: join(workDir, 'updater-entry-dummy.js'),
    trackTask: task => { tracked.push(task) },
    log: { error: (...args: unknown[]) => { logs.push(args.map(value => String(value)).join(' ')) } },
    launchUpdater: async (plan: UpdatePlan) => {
      await runFromPlan(plan, {
        control: {
          prepare: async () => ({ ok: true }),
          shutdown: async () => ({ ok: true }),
        },
        waitServerExit: async () => ({ ok: true }),
        relaunch: async () => ({ started: true }),
        waitHealthy: async () => ({ ok: true, version: NEW_VERSION }),
        delay: async () => {},
      })
      return { started: true }
    },
  })
  closers.push(() => app.close())
  return { app, oldRoot, dataDir, tracked, logs }
}

/** 轻量 harness：只挂 GET /api/update/status（不需要下载/换装注入面）。 */
async function buildStatusHarness(options: { env?: Record<string, string | undefined> } = {}): Promise<{ app: FastifyInstance, dataDir: string }> {
  const workDir = await makeTmpDir('trainer-upd-stale-st-')
  await writeMiniPackage(workDir, { version: '2.0.0', includeRuntime: false })
  const dataDir = join(workDir, 'data')
  const app = Fastify()
  await registerUpdateApi(app, { dataDir, runId: 'run-x' } as unknown as AppConfig, {
    packageRoot: workDir,
    env: options.env,
  })
  closers.push(() => app.close())
  return { app, dataDir }
}

async function getStatusJson(app: FastifyInstance): Promise<Record<string, unknown>> {
  const response = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(response.statusCode).toBe(200)
  return response.json()
}

async function readStatusFile(dataDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, STATUS_FILE), 'utf8')) as Record<string, unknown>
}

describe('POST /api/update/apply 陈旧 busy 自愈（UPD-STALE-BUSY-SELFHEAL）', () => {
  it('apply heals a stale applying status to failed with a human reason logged and retries through in the same request', async () => {
    const harness = await buildApplyHarness()
    await writeRawStatus(harness.dataDir, { state: 'applying' }, 2 * HOUR_MS)
    const response = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    // 用户原话 oracle：不希望看到报错——同一请求内放行（202），不是 409
    expect(response.statusCode).toBe(202)
    const attemptId = response.json().attemptId as string
    expect(attemptId).not.toBe('update-dead-beef')
    await Promise.allSettled(harness.tracked.splice(0))
    const status = await getStatusJson(harness.app)
    expect(status.state).toBe('completed')
    expect(status.targetVersion).toBe(NEW_VERSION)
    // 人话原因落 server 日志（自动诊断证据）
    expect(harness.logs.join('\n')).toContain('复位')
    expect(harness.logs.join('\n')).toContain('applying')
  })

  it('keeps UPDATE_IN_PROGRESS for a fresh applying status and for a legacy file without updatedAt', async () => {
    const harness = await buildApplyHarness()
    // 新鲜 busy（刚刚写入）：真守卫不破
    await writeRawStatus(harness.dataDir, { state: 'applying' }, 0)
    const fresh = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(fresh.statusCode).toBe(409)
    expect(fresh.json().error).toBe('UPDATE_IN_PROGRESS')
    // 旧形态文件（无 updatedAt）：不可判定年龄 → fail-closed 视为新鲜，仍守卫
    await writeRawStatus(harness.dataDir, { state: 'applying' }, null)
    const legacy = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(legacy.statusCode).toBe(409)
    expect(legacy.json().error).toBe('UPDATE_IN_PROGRESS')
  })

  it('default staleness threshold is 30 minutes - 29 minutes stays guarded and 31 minutes heals', async () => {
    const harness = await buildApplyHarness()
    await writeRawStatus(harness.dataDir, { state: 'downloading' }, 29 * MINUTE_MS)
    const guarded = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(guarded.statusCode).toBe(409)
    expect(guarded.json().error).toBe('UPDATE_IN_PROGRESS')
    await writeRawStatus(harness.dataDir, { state: 'downloading' }, 31 * MINUTE_MS)
    const healed = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(healed.statusCode).toBe(202)
    await Promise.allSettled(harness.tracked.splice(0))
    expect((await getStatusJson(harness.app)).state).toBe('completed')
  })

  it('env TRAINER_UPDATE_STALE_BUSY_MS overrides the threshold', async () => {
    const harness = await buildApplyHarness({ env: { TRAINER_UPDATE_STALE_BUSY_MS: String(MINUTE_MS) } })
    await writeRawStatus(harness.dataDir, { state: 'verifying' }, 5 * MINUTE_MS)
    const response = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response.statusCode).toBe(202)
    await Promise.allSettled(harness.tracked.splice(0))
    expect((await getStatusJson(harness.app)).state).toBe('completed')
  })

  it('invalid TRAINER_UPDATE_STALE_BUSY_MS values fall back to the 30 minute default (fail-closed)', async () => {
    for (const invalid of ['abc', '0', '-1000']) {
      const harness = await buildApplyHarness({ env: { TRAINER_UPDATE_STALE_BUSY_MS: invalid } })
      // 5 分钟旧：默认阈值下仍新鲜 → 守卫不放（坏 env 不放宽守卫）
      await writeRawStatus(harness.dataDir, { state: 'backing_up' }, 5 * MINUTE_MS)
      const guarded = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
      expect(guarded.statusCode, `env=${invalid}`).toBe(409)
      expect(guarded.json().error).toBe('UPDATE_IN_PROGRESS')
      await closers.pop()!()
    }
    // 回退是回默认（30 分钟）而非禁用自愈：2 小时旧仍会愈
    const harness = await buildApplyHarness({ env: { TRAINER_UPDATE_STALE_BUSY_MS: 'abc' } })
    await writeRawStatus(harness.dataDir, { state: 'backing_up' }, 2 * HOUR_MS)
    const healed = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(healed.statusCode).toBe(202)
    await Promise.allSettled(harness.tracked.splice(0))
    expect((await getStatusJson(harness.app)).state).toBe('completed')
  })
})

describe('GET /api/update/status 陈旧 busy reconcile', () => {
  it('status GET heals every stale busy state to failed with a human-readable reason', async () => {
    const busyStates = UPDATE_STATES.filter(state => state !== 'idle' && state !== 'completed' && state !== 'failed' && state !== 'restarting') as UpdateState[]
    expect(busyStates).toEqual(['downloading', 'verifying', 'backing_up', 'applying'])
    for (const state of busyStates) {
      const { app, dataDir } = await buildStatusHarness()
      await writeRawStatus(dataDir, { state }, 2 * HOUR_MS)
      const status = await getStatusJson(app)
      expect(status.state, `state=${state}`).toBe('failed')
      expect(String(status.error)).toContain('复位')
      expect(String(status.error)).toContain('更新')
      await closers.pop()!()
    }
  })

  it('reconcile keeps restarting to completed intact even when stale and heals stale restarting only when the version does not match', async () => {
    // 版本匹配（运行 2.0.0＝目标）：即使陈旧也先走既有 completed 路径，不误伤
    const matching = await buildStatusHarness()
    await writeRawStatus(matching.dataDir, { state: 'restarting', targetVersion: '2.0.0' }, 2 * HOUR_MS)
    expect((await getStatusJson(matching.app)).state).toBe('completed')
    await closers.pop()!()
    // 版本不匹配＋新鲜：保持 restarting 原样（既有语义）
    const freshMismatch = await buildStatusHarness()
    await writeRawStatus(freshMismatch.dataDir, { state: 'restarting', targetVersion: '3.0.0' }, 5 * MINUTE_MS)
    expect((await getStatusJson(freshMismatch.app)).state).toBe('restarting')
    await closers.pop()!()
    // 版本不匹配＋陈旧：复位 failed（换装后重启失败且久无进展的残留）
    const staleMismatch = await buildStatusHarness()
    await writeRawStatus(staleMismatch.dataDir, { state: 'restarting', targetVersion: '3.0.0' }, 2 * HOUR_MS)
    const healed = await getStatusJson(staleMismatch.app)
    expect(healed.state).toBe('failed')
    expect(String(healed.error)).toContain('复位')
    await closers.pop()!()
  })

  it('status GET leaves a fresh busy state untouched', async () => {
    const { app, dataDir } = await buildStatusHarness()
    await writeRawStatus(dataDir, { state: 'applying' }, 0)
    const status = await getStatusJson(app)
    expect(status.state).toBe('applying')
  })
})

describe('服务启动期 reconcile（startTrainerServer 接线）', () => {
  it('boot resets a stale busy status file to failed and keeps restarting to completed when the version matches', async () => {
    const runVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version
    const bootEnv = (root: string): void => {
      process.env.TRAINER_RUN_ID = `run-busyheal-${Date.now()}`
      process.env.TRAINER_DB = join(root, 'trainer.sqlite')
      process.env.TRAINER_DATA_DIR = join(root, 'data')
      process.env.TRAINER_STATIC_DIR = join(root, 'static')
      process.env.TRAINER_READY_FILE = join(root, 'ready.json')
      process.env.TRAINER_CONTROL_TOKEN = 'tok-busyheal'
      process.env.TDX_ROOT = ''
      process.env.OPEN_BROWSER = '0'
      process.env.HOST = '127.0.0.1'
      process.env.PORT = '0'
    }
    const booted: StartedTrainerServer[] = []
    try {
      // 启动期复位：陈旧 applying → failed（人话原因直接落状态文件）
      const rootA = await makeTmpDir('trainer-upd-boot-a-')
      await mkdir(join(rootA, 'static'), { recursive: true })
      await writeFile(join(rootA, 'static', 'index.html'), '<!doctype html><title>busyheal</title>', 'utf8')
      bootEnv(rootA)
      await writeRawStatus(join(rootA, 'data'), { state: 'applying' }, 2 * HOUR_MS)
      booted.push(await startTrainerServer())
      const healedFile = await readStatusFile(join(rootA, 'data'))
      expect(healedFile.state).toBe('failed')
      expect(String(healedFile.error)).toContain('复位')

      // 不误伤：restarting＋版本匹配（即使陈旧）→ completed
      const rootB = await makeTmpDir('trainer-upd-boot-b-')
      await mkdir(join(rootB, 'static'), { recursive: true })
      await writeFile(join(rootB, 'static', 'index.html'), '<!doctype html><title>busyheal</title>', 'utf8')
      bootEnv(rootB)
      await writeRawStatus(join(rootB, 'data'), { state: 'restarting', targetVersion: runVersion }, 2 * HOUR_MS)
      booted.push(await startTrainerServer())
      const completedFile = await readStatusFile(join(rootB, 'data'))
      expect(completedFile.state).toBe('completed')
    } finally {
      for (const server of booted) await server.shutdown().catch(() => {})
      for (const name of ['TRAINER_RUN_ID', 'TRAINER_DB', 'TRAINER_DATA_DIR', 'TRAINER_STATIC_DIR', 'TRAINER_READY_FILE', 'TRAINER_CONTROL_TOKEN', 'TDX_ROOT', 'OPEN_BROWSER', 'HOST', 'PORT']) {
        delete process.env[name]
      }
    }
  })
})
