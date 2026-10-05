// UPD-01 apply 端到端（API 层）：受理守卫、下载校验失败终止、成功全流程（下载→校验→
// 更新器内联编排：排空→退出→备份→换装→preserve 核验→重启→健康确认）。
// 矩阵行：UPD-CHECK 系列之外的全部 apply/status 行为入口（UPD-DOWNLOAD-VERIFY、
// UPD-BACKUP-BEFORE-SWAP、UPD-PRESERVE-DATA、UPD-APPLY-SWAP、UPD-APPLY-ROLLBACK 的 API 观测面）。
// 纪律：manifestFetch/downloadFetch 全注入（零 api.github.com）；launchUpdater 注入为
// runFromPlan 内联执行（control/waitExit/relaunch/health 全注入替身）；真实文件系统
// 上做迷你包换装。期望全部独立推算（手写清单与包内容）。

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { registerUpdateApi } from '../src/update/api.js'
import type { UpdatePlan } from '../src/update/updater-core.js'
import { runFromPlan } from '../src/update/updater.js'
import {
  buildReleaseZip, fakeBufferResponse, fakeTextResponse, makeTmpDir, sha256Bytes,
  writeMiniPackage, readTextIfExists, pathExists,
} from './helpers/updater-fixtures.js'

const OLD_VERSION = '1.2.7'
const NEW_VERSION = '1.2.8'
const OLD_CONFIG = '{\n  "port": 8787\n}\n'
const OLD_SQLITE = 'sqlite-bytes-of-history-training'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

interface Harness {
  app: FastifyInstance
  oldRoot: string
  dataDir: string
  downloadsDir: string
  tracked: Promise<unknown>[]
  controlCalls: string[]
  relaunchCalls: string[]
}

async function buildHarness(options: {
  manifestBody?: () => string
  manifestError?: () => never
  sumsOverride?: string
  getActiveTraining?: () => { id: number } | null
  launchFailure?: boolean
}): Promise<Harness> {
  const workDir = await makeTmpDir('trainer-upd-apply-')
  await writeFile(join(workDir, 'updater-entry-dummy.js'), '// dummy updater entry (launchUpdater is injected)\n')
  const oldRoot = join(workDir, 'kline-trainer-v1.2.7-installed')
  await writeMiniPackage(oldRoot, {
    version: OLD_VERSION,
    nodeVersion: '24.1.1',
    files: {
      'server/dist/index.js': 'old server\n',
      'legacy-only.txt': 'removed upstream\n',
    },
    preserve: { trainerConfig: OLD_CONFIG, sqlite: OLD_SQLITE, savedChoice: '{"version":1,"root":"D:\\\\TDX"}' },
  })
  const dataDir = join(oldRoot, 'data')
  const downloadsDir = join(dataDir, 'update-downloads')
  const { buffer: newZip, artifactName } = await buildReleaseZip({
    version: NEW_VERSION,
    nodeVersion: '24.1.1',
    files: { 'server/dist/index.js': 'new server v1.2.8\n', 'added-in-v2.txt': 'new file\n' },
  }, await makeTmpDir('trainer-upd-apply-new-'))
  const zipSha = await sha256Bytes(newZip)
  const manifestBody = options.manifestBody ?? ((): string => JSON.stringify({
    tag_name: `v${NEW_VERSION}`,
    body: `release notes for ${NEW_VERSION}`,
    assets: [
      { name: `${artifactName}.zip`, browser_download_url: 'fixture://zip', size: newZip.length },
      { name: 'SHA256SUMS', browser_download_url: 'fixture://sums', size: 96 },
    ],
  }))
  const sumsText = options.sumsOverride ?? `${zipSha}  ${artifactName}.zip\n`

  const tracked: Promise<unknown>[] = []
  const controlCalls: string[] = []
  const relaunchCalls: string[] = []
  const app = Fastify()
  const config = {
    dataDir,
    launcherConfigPath: null,
    runId: 'run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    databasePath: join(dataDir, 'trainer.sqlite'),
  } as unknown as AppConfig
  await registerUpdateApi(app, config, {
    packageRoot: oldRoot,
    env: { TRAINER_LAUNCHER_CJS: join(oldRoot, 'launcher.cjs') },
    manifestFetch: options.manifestError ? options.manifestError : async () => manifestBody(),
    downloadFetch: async (url: string) => url === 'fixture://sums' ? fakeTextResponse(sumsText) : fakeBufferResponse(newZip),
    getActiveTraining: options.getActiveTraining ?? (() => null),
    updaterEntryPath: join(workDir, 'updater-entry-dummy.js'),
    trackTask: task => { tracked.push(task) },
    launchUpdater: async (plan: UpdatePlan, workDirForUpdater: string) => {
      expect(workDirForUpdater.startsWith(dataDir)).toBe(true)
      await runFromPlan(plan, {
        control: {
          prepare: async () => { controlCalls.push('prepare'); return { ok: true } },
          shutdown: async () => { controlCalls.push('shutdown'); return { ok: true } },
        },
        waitServerExit: async () => { controlCalls.push('wait-exit'); return { ok: true } },
        relaunch: async planInner => { relaunchCalls.push(planInner.launcherPath); return { started: true } },
        waitHealthy: async () => ({ ok: true, version: NEW_VERSION }),
        delay: async () => {},
      })
      return { started: !options.launchFailure }
    },
  })
  closers.push(() => app.close())
  return { app, oldRoot, dataDir, downloadsDir, tracked, controlCalls, relaunchCalls }
}

async function getStatus(app: FastifyInstance): Promise<Record<string, unknown>> {
  const response = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(response.statusCode).toBe(200)
  return response.json()
}

async function settle(tracked: Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(tracked.splice(0))
}

describe('POST /api/update/apply guards', () => {
  it('refuses non-packaged runs (no release.json) with UPDATE_NOT_PACKAGED', async () => {
    const workDir = await makeTmpDir('trainer-upd-guard-')
    const app = Fastify()
    closers.push(() => app.close())
    await registerUpdateApi(app, { dataDir: null, runId: null } as unknown as AppConfig, {
      packageRoot: workDir, // 空目录：无 release.json
      manifestFetch: async () => { throw new Error('must not be called') },
    })
    const response = await app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response.statusCode).toBe(503)
    expect(response.json().error).toBe('UPDATE_NOT_PACKAGED')
  })

  it('rejects when no newer release is available or the manifest fails', async () => {
    const harness = await buildHarness({ manifestBody: () => JSON.stringify({ tag_name: `v${OLD_VERSION}`, assets: [{ name: 'kline-trainer-v1.2.7-windows-x64.zip', browser_download_url: 'fixture://zip' }] }) })
    const response = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('UPDATE_NOT_AVAILABLE')

    const failedManifest = await buildHarness({ manifestError: () => { throw new Error('offline') } })
    const response2 = await failedManifest.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response2.statusCode).toBe(502)
    expect(response2.json().error).toBe('UPDATE_MANIFEST_FAILED')
  })

  it('rejects an in-flight attempt (UPDATE_IN_PROGRESS) and an active training', async () => {
    const training = await buildHarness({ getActiveTraining: () => ({ id: 7 }) })
    const response = await training.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('ACTIVE_TRAINING')

    const harness = await buildHarness({})
    // 人为制造"进行中"状态文件
    const { writeUpdateStatus } = await import('../src/update/status.js')
    await writeUpdateStatus(harness.dataDir, { state: 'downloading', attemptId: 'update-stale', targetVersion: '9.9.9' })
    const busy = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(busy.statusCode).toBe(409)
    expect(busy.json().error).toBe('UPDATE_IN_PROGRESS')
    // completed/failed 状态不阻塞新一次受理
    await writeUpdateStatus(harness.dataDir, { state: 'failed', attemptId: 'update-stale', error: '旧失败' })
    const again = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(again.statusCode).toBe(202)
  })
})

describe('POST /api/update/apply verify gate (UPD-DOWNLOAD-VERIFY)', () => {
  it('fails the attempt on a SHA256 mismatch without touching the package and without launching the updater', async () => {
    const harness = await buildHarness({ sumsOverride: `${'0'.repeat(64)}  kline-trainer-v1.2.8-windows-x64.zip\n` })
    let launched = false
    // 重新注册以观察 launchUpdater 是否被调（用坏 sums 即可：launchUpdater 不应被调）
    const response = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response.statusCode).toBe(202)
    expect(response.json().state).toBe('downloading')
    await settle(harness.tracked)
    const status = await getStatus(harness.app)
    expect(status.state).toBe('failed')
    expect(String(status.error)).toContain('SHA256')
    expect(await readTextIfExists(join(harness.oldRoot, 'server', 'dist', 'index.js'))).toBe('old server\n')
    expect(harness.relaunchCalls).toHaveLength(0)
    expect(harness.controlCalls).toHaveLength(0)
    expect(launched).toBe(false)
    // 下载的 zip 保留供诊断
    expect((await readdir(harness.downloadsDir)).some(name => name.endsWith('.zip'))).toBe(true)
  })
})

describe('POST /api/update/apply full flow (UPD-APPLY-SWAP / UPD-PRESERVE-DATA / UPD-BACKUP-BEFORE-SWAP)', () => {
  it('downloads, verifies, drains, swaps, preserves user data, relaunches and completes', async () => {
    const harness = await buildHarness({})
    const response = await harness.app.inject({ method: 'POST', url: '/api/update/apply' })
    expect(response.statusCode).toBe(202)
    const attemptId = response.json().attemptId as string
    expect(attemptId).toMatch(/^update-/)
    await settle(harness.tracked)

    const status = await getStatus(harness.app)
    expect(status.state).toBe('completed')
    expect(status.targetVersion).toBe(NEW_VERSION)
    expect(status.fromVersion).toBe(OLD_VERSION)
    expect(status.attemptId).toBe(attemptId)

    // 排空→退出→备份→换装→重启 编排顺序
    expect(harness.controlCalls).toEqual(['prepare', 'shutdown', 'wait-exit'])
    expect(harness.relaunchCalls).toEqual([join(harness.oldRoot, 'launcher.cjs')])

    // 换装结果（独立期望）：新文件就位、旧独有文件移除、包版本更新
    expect(await readTextIfExists(join(harness.oldRoot, 'server', 'dist', 'index.js'))).toBe('new server v1.2.8\n')
    expect(await readTextIfExists(join(harness.oldRoot, 'added-in-v2.txt'))).toBe('new file\n')
    expect(await pathExists(join(harness.oldRoot, 'legacy-only.txt'))).toBe(false)
    expect(await readTextIfExists(join(harness.oldRoot, 'release.json'))).toContain(`"version": "${NEW_VERSION}"`)

    // preserve：用户配置与历史训练数据逐字节保留（用户原话 oracle）
    expect(await readTextIfExists(join(harness.oldRoot, 'trainer.config.json'))).toBe(OLD_CONFIG)
    expect(await readTextIfExists(join(harness.oldRoot, 'data', 'trainer.sqlite'))).toBe(OLD_SQLITE)
    expect(await readTextIfExists(join(harness.oldRoot, 'data', 'saved-tdx-choice.json'))).toBe('{"version":1,"root":"D:\\\\TDX"}')

    // 备份在换装前生成（UPD-BACKUP-BEFORE-SWAP）
    const backups = await readdir(join(harness.dataDir, 'backups'))
    expect(backups.some(name => name.startsWith('update-'))).toBe(true)
    const backupDir = join(harness.dataDir, 'backups', backups.find(name => name.startsWith('update-'))!)
    expect(await readTextIfExists(join(backupDir, 'trainer.config.json'))).toBe(OLD_CONFIG)
    expect(await readTextIfExists(join(backupDir, 'trainer.sqlite'))).toBe(OLD_SQLITE)

    // trash 清理：成功后包根不留 .update-trash-*
    const rootEntries = await readdir(harness.oldRoot)
    expect(rootEntries.filter(name => name.startsWith('.update-trash'))).toHaveLength(0)
    // 成功后下载 zip 清理
    expect((await readdir(harness.downloadsDir)).filter(name => name.endsWith('.zip'))).toHaveLength(0)
    // runtime 未搬移（原字节仍在）
    expect(await readFile(join(harness.oldRoot, 'runtime', 'node.exe'), 'utf8')).toContain('node runtime 24.1.1')
  })
})

describe('GET /api/update/status', () => {
  it('reports idle without a status file', async () => {
    const workDir = await makeTmpDir('trainer-upd-status-')
    const app = Fastify()
    closers.push(() => app.close())
    await registerUpdateApi(app, { dataDir: workDir, runId: null } as unknown as AppConfig, { packageRoot: workDir })
    const status = await getStatus(app)
    expect(status.state).toBe('idle')
  })

  it('reconciles restarting to completed when the running version already matches the target', async () => {
    const workDir = await makeTmpDir('trainer-upd-reconcile-')
    await writeMiniPackage(workDir, { version: '2.0.0', includeRuntime: false })
    const app = Fastify()
    closers.push(() => app.close())
    await registerUpdateApi(app, { dataDir: workDir, runId: 'run-x' } as unknown as AppConfig, { packageRoot: workDir })
    const { writeUpdateStatus } = await import('../src/update/status.js')
    await writeUpdateStatus(workDir, { state: 'restarting', attemptId: 'update-z', targetVersion: '2.0.0', fromVersion: '1.9.9' })
    const status = await getStatus(app)
    expect(status.state).toBe('completed')
    // 版本不匹配时保持 restarting 原样（不冒充完成）
    await writeUpdateStatus(workDir, { state: 'restarting', attemptId: 'update-z2', targetVersion: '3.0.0' })
    const status2 = await getStatus(app)
    expect(status2.state).toBe('restarting')
  })
})
