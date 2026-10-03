// SETUP-01 首次接入接线端点：select-directory / inspect / save-choice / apply /
// restart-status。全部经 validateSetupRequest 防护；测试注入合成 stub（picker/
// inspect/applyRestart），文件落盘一律走临时目录；不读取真实通达信，不打印令牌。
import Fastify, { type FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import { registerApi, type SetupRestartAttempt } from '../src/api.js'
import type { AppConfig } from '../src/config.js'

// 满载并行下真实 I/O 用例可数倍于串行耗时（集成门禁第二轮曾在 :196 以默认
// 5000ms 超时失败，串行绿）。与 docs-tooling（20s）/review-profile（30s）/
// worktree-tools（90s）/settings-training（20s，fd575f5）/setup-api、drawings
// （20s，7e2509f）同一先例：时间预算放宽到 20s，断言不变（wt/D-M4-01 返修
// 记录归属升级给集成人，集成层应用同款单行修法）。
vi.setConfig({ testTimeout: 20_000 })
import type { SavedTdxChoice } from '../src/setup/saved-choice.js'
import type { TdxCandidateCheck } from '../src/tdx/inspect.js'

const TOKEN = 'e2e-onboarding-token'

const activeRoots = new Set<string>()

afterEach(async () => {
  for (const root of Array.from(activeRoots)) {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
  activeRoots.clear()
})

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'setup-onboarding-'))
  activeRoots.add(dir)
  return dir
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8787,
    host: '127.0.0.1',
    databasePath: ':memory:',
    tdxRoot: null,
    tdxSource: null,
    dataDir: null,
    controlToken: TOKEN,
    ...overrides,
  }
}

function makeCheck(root: string, overrides: Partial<TdxCandidateCheck> = {}): TdxCandidateCheck {
  return {
    root,
    recognized: true,
    readable: true,
    dailyFileCount: 42,
    latestDate: '2026-09-24',
    hasAdjustment: true,
    hasNames: true,
    hasBenchmark: false,
    problems: [],
    ...overrides,
  }
}

interface StubSetup {
  directoryPicker?: () => Promise<{ status: string; path?: string; reason?: string }>
  inspectOne?: (root: string) => Promise<TdxCandidateCheck>
  inspect?: (roots: readonly string[]) => Promise<TdxCandidateCheck[]>
  applyRestart?: (attempt: SetupRestartAttempt) => Promise<{ started: boolean }>
}

async function buildApp(
  stubs: StubSetup = {},
  configOverrides: Partial<AppConfig> = {},
  env: Record<string, string | undefined> = {},
): Promise<FastifyInstance> {
  const previous: Array<[string, string | undefined]> = []
  for (const [key, value] of Object.entries(env)) previous.push([key, process.env[key]])
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const app = Fastify()
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  await registerApi(app, makeConfig(configOverrides), database, {
    setup: {
      directoryPicker: stubs.directoryPicker,
      inspect: stubs.inspect ?? (async roots => roots.map(root => makeCheck(root))),
      inspectOne: stubs.inspectOne,
      applyRestart: stubs.applyRestart,
    },
  })
  app.addHook('onClose', async () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  return app
}

const BROWSER_HEADERS = {
  host: '127.0.0.1:8787',
  origin: 'http://127.0.0.1:8787',
  'sec-fetch-site': 'same-origin',
}

describe('POST /api/setup/select-directory', () => {
  it('returns the picker result without auto-adopting anything', async () => {
    const app = await buildApp({ directoryPicker: async () => ({ status: 'selected', path: 'D:\\new_tdx' }) })
    try {
      const response = await app.inject({ method: 'POST', url: '/api/setup/select-directory', headers: BROWSER_HEADERS })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'selected', path: 'D:\\new_tdx' })
    } finally { await app.close() }
  })

  it('treats cancellation as a normal result and needs no token for the browser path', async () => {
    const app = await buildApp({ directoryPicker: async () => ({ status: 'cancelled' }) })
    try {
      const response = await app.inject({ method: 'POST', url: '/api/setup/select-directory', headers: BROWSER_HEADERS })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'cancelled' })
    } finally { await app.close() }
  })

  it('picker failure surfaces as unavailable without leaking internals', async () => {
    const app = await buildApp({ directoryPicker: async () => { throw new Error('boom') } })
    try {
      const response = await app.inject({ method: 'POST', url: '/api/setup/select-directory', headers: BROWSER_HEADERS })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.status).toBe('unavailable')
      expect(body.reason).toContain('目录选择组件调用失败')
    } finally { await app.close() }
  })

  it('rejects cross-origin browser requests via the shared guard', async () => {
    const app = await buildApp({ directoryPicker: async () => ({ status: 'selected', path: 'D:\\new_tdx' }) })
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/select-directory',
        headers: { host: '127.0.0.1:8787', origin: 'http://evil.example:8787' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error).toBe('ORIGIN_MISMATCH')
    } finally { await app.close() }
  })
})

describe('POST /api/setup/inspect', () => {
  it('returns only the selected root check without scanning nearby directories', async () => {
    const parent = 'D:\\选错的上层'
    const inspected: string[] = []
    const app = await buildApp({
      inspectOne: async root => {
        inspected.push(root)
        return makeCheck(root, { recognized: false, readable: true, problems: ['未发现通达信结构'] })
      },
    })
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/inspect', headers: BROWSER_HEADERS,
        payload: { root: parent },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.check.recognized).toBe(false)
      expect(body.check.problems.length).toBeGreaterThan(0)
      expect(body.suggestions).toEqual([])
      expect(inspected).toEqual([parent])
    } finally { await app.close() }
  })

  it('a recognized root skips suggestions entirely', async () => {
    const app = await buildApp({
      inspectOne: async root => makeCheck(root),
      inspect: async () => { throw new Error('must not be called') },
    })
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/inspect', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx' },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.check.recognized).toBe(true)
      expect(body.suggestions).toEqual([])
    } finally { await app.close() }
  })

  it('rejects missing/oversized root with 400 before any inspection', async () => {
    let calls = 0
    const app = await buildApp({ inspectOne: async root => { calls++; return makeCheck(root) } })
    try {
      for (const payload of [undefined, {}, { root: '' }, { root: 'x'.repeat(501) }, { root: 42 }]) {
        const response = await app.inject({
          method: 'POST', url: '/api/setup/inspect', headers: BROWSER_HEADERS,
          payload: payload as Record<string, unknown>,
        })
        expect(response.statusCode).toBe(400)
      }
      expect(calls).toBe(0)
    } finally { await app.close() }
  })
})

describe('POST /api/setup/save-choice', () => {
  it('saves the confirmed root into dataDir after re-inspection and reports apply availability', async () => {
    const dataDir = await tempDataDir()
    const app = await buildApp(
      { inspectOne: async root => makeCheck(root) },
      { dataDir, runId: 'run-00000000-0000-0000-0000-000000000001', tdxSource: 'auto-discovered', tdxRoot: 'D:\\old' },
      { TRAINER_LAUNCHER_CJS: join(dataDir, 'launcher.cjs') },
    )
    try {
      await writeFile(join(dataDir, 'launcher.cjs'), '// fixture launcher')
      const response = await app.inject({
        method: 'POST', url: '/api/setup/save-choice', headers: BROWSER_HEADERS,
        payload: { root: ' D:\\new_tdx ' },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.saved).toBe(true)
      expect(body.root).toBe('D:\\new_tdx')
      expect(body.apply).toEqual({ available: true })
      const stored = JSON.parse(await readFile(join(dataDir, 'saved-tdx-choice.json'), 'utf8')) as SavedTdxChoice
      expect(stored.version).toBe(1)
      expect(stored.root).toBe('D:\\new_tdx')
    } finally { await app.close() }
  })

  it('keeps the previous choice file and returns 400 when re-inspection fails', async () => {
    const dataDir = await tempDataDir()
    await writeFile(join(dataDir, 'saved-tdx-choice.json'), JSON.stringify({
      version: 1, root: 'D:\\old_tdx', savedAt: '2026-09-28T10:00:00.000Z', inspectedAt: '2026-09-28T10:00:00.000Z',
    }))
    let fail = true
    const app = await buildApp(
      { inspectOne: async root => fail ? makeCheck(root, { recognized: false, readable: false, problems: ['坏目录'] }) : makeCheck(root) },
      { dataDir },
    )
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/save-choice', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\bad_tdx' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toContain('未保存新选择')
      const stored = JSON.parse(await readFile(join(dataDir, 'saved-tdx-choice.json'), 'utf8')) as SavedTdxChoice
      expect(stored.root).toBe('D:\\old_tdx')
    } finally { await app.close() }
  })

  it('refuses to save without a dataDir instead of guessing a location', async () => {
    const app = await buildApp({ inspectOne: async root => makeCheck(root) }, { dataDir: null })
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/save-choice', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx' },
      })
      expect(response.statusCode).toBe(503)
      expect(response.json().error).toBe('SETUP_SAVE_UNAVAILABLE')
    } finally { await app.close() }
  })
})

function buildAttempt(attempt: Partial<SetupRestartAttempt> = {}): SetupRestartAttempt {
  return {
    version: 1,
    appId: 'a-share-kline-trainer',
    attemptId: randomUUID(),
    createdAt: '2026-09-29T10:00:00.000Z',
    old: {
      runId: 'run-00000000-0000-0000-0000-000000000001',
      pid: process.pid,
      port: 8787,
      databasePath: join('D:', 'data', 'trainer.sqlite'),
      origin: 'http://127.0.0.1:8787',
      dataDir: 'D:\\data',
    },
    planned: {
      dataDir: 'D:\\data',
      databasePath: join('D:', 'data', 'trainer.sqlite'),
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      tdxRoot: 'D:\\new_tdx',
      source: 'explicit-env',
    },
    target: { runId: 'run-00000000-0000-0000-0000-000000000002', port: 8787, origin: 'http://127.0.0.1:8787' },
    previousSavedChoice: null,
    oldEffective: { tdxRoot: 'D:\\old_tdx', source: 'auto-discovered' },
    ...attempt,
  }
}

describe('POST /api/setup/apply', () => {
  it('requires a saved choice that matches the request root (no implicit save)', async () => {
    const dataDir = await tempDataDir()
    const launcherPath = join(dataDir, 'launcher.cjs')
    await writeFile(launcherPath, '// fixture')
    const app = await buildApp(
      {},
      { dataDir, runId: 'run-00000000-0000-0000-0000-000000000001', tdxSource: 'auto-discovered' },
      { TRAINER_LAUNCHER_CJS: launcherPath },
    )
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: randomUUID() },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error).toBe('SETUP_SAVE_MISMATCH')
    } finally { await app.close() }
  })

  it('refuses explicit env/config sources with 409 and dev sessions with 503', async () => {
    const dataDir = await tempDataDir()
    const app = await buildApp(
      {},
      { dataDir, runId: 'run-00000000-0000-0000-0000-000000000001', tdxSource: 'env' },
    )
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: randomUUID() },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error).toBe('SETUP_SOURCE_EXPLICIT')
    } finally { await app.close() }

    const devApp = await buildApp({}, { dataDir, runId: undefined, tdxSource: 'auto-discovered' })
    try {
      const response = await devApp.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: randomUUID() },
      })
      expect(response.statusCode).toBe(503)
      expect(response.json().error).toBe('SETUP_RESTART_UNAVAILABLE')
    } finally { await devApp.close() }
  })

  it('persists the attempt handoff, spawns the supervisor once, and returns 202', async () => {
    const dataDir = await tempDataDir()
    await writeFile(join(dataDir, 'saved-tdx-choice.json'), JSON.stringify({
      version: 1, root: 'D:\\new_tdx', savedAt: '2026-09-29T10:00:00.000Z', inspectedAt: '2026-09-29T10:00:00.000Z',
    }))
    const launcherPath = join(dataDir, 'launcher.cjs')
    await writeFile(launcherPath, '// fixture')
    const attempts: SetupRestartAttempt[] = []
    const app = await buildApp(
      {
        applyRestart: async attempt => { attempts.push(attempt); return { started: true } },
        inspectOne: async root => makeCheck(root),
      },
      { dataDir, runId: 'run-00000000-0000-0000-0000-000000000001', tdxSource: 'auto-discovered', tdxRoot: 'D:\\old_tdx' },
      { TRAINER_LAUNCHER_CJS: launcherPath },
    )
    try {
      // 先保存一次让 in-memory lastSavedChoice 与磁盘一致
      const save = await app.inject({
        method: 'POST', url: '/api/setup/save-choice', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx' },
      })
      expect(save.statusCode).toBe(200)
      const response = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: 'attempt-1' },
      })
      expect(response.statusCode).toBe(202)
      expect(response.json()).toMatchObject({ phase: 'restart-initiated', attemptId: 'attempt-1' })
      expect(attempts.length).toBe(1)
      expect(attempts[0].planned.tdxRoot).toBe('D:\\new_tdx')
      expect(attempts[0].target.runId).not.toBe(attempts[0].old.runId)
      // 交接文件不含控制令牌
      const attemptRaw = await readFile(join(dataDir, 'setup-restart-attempt.json'), 'utf8')
      expect(attemptRaw).not.toContain(TOKEN)
      const statusRaw = await readFile(join(dataDir, 'setup-restart-status.json'), 'utf8')
      expect(statusRaw).not.toContain(TOKEN)
      expect(JSON.parse(statusRaw)).toMatchObject({ attemptId: 'attempt-1', done: false })
    } finally { await app.close() }
  })

  it('rejects a second apply while the first is still running (202 without done)', async () => {
    const dataDir = await tempDataDir()
    await writeFile(join(dataDir, 'saved-tdx-choice.json'), JSON.stringify({
      version: 1, root: 'D:\\new_tdx', savedAt: '2026-09-29T10:00:00.000Z', inspectedAt: '2026-09-29T10:00:00.000Z',
    }))
    const launcherPath = join(dataDir, 'launcher.cjs')
    await writeFile(launcherPath, '// fixture')
    const app = await buildApp(
      {
        applyRestart: async () => ({ started: true }),
        inspectOne: async root => makeCheck(root),
      },
      { dataDir, runId: 'run-00000000-0000-0000-0000-000000000001', tdxSource: 'auto-discovered' },
      { TRAINER_LAUNCHER_CJS: launcherPath },
    )
    try {
      await app.inject({ method: 'POST', url: '/api/setup/save-choice', headers: BROWSER_HEADERS, payload: { root: 'D:\\new_tdx' } })
      const first = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: 'attempt-1' },
      })
      expect(first.statusCode).toBe(202)
      const second = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: 'attempt-2' },
      })
      expect(second.statusCode).toBe(409)
      expect(second.json().error).toBe('CONTROL_BUSY')
    } finally { await app.close() }
  })

  it('allows a new apply after the previous attempt reached a terminal state', async () => {
    const dataDir = await tempDataDir()
    await writeFile(join(dataDir, 'saved-tdx-choice.json'), JSON.stringify({
      version: 1, root: 'D:\\new_tdx', savedAt: '2026-09-29T10:00:00.000Z', inspectedAt: '2026-09-29T10:00:00.000Z',
    }))
    const launcherPath = join(dataDir, 'launcher.cjs')
    await writeFile(launcherPath, '// fixture')
    let started = 0
    const app = await buildApp(
      {
        applyRestart: async () => ({ started: ++started > 0 }),
        inspectOne: async root => makeCheck(root),
      },
      { dataDir, runId: 'run-00000000-0000-0000-0000-000000000001', tdxSource: 'auto-discovered' },
      { TRAINER_LAUNCHER_CJS: launcherPath },
    )
    try {
      await app.inject({ method: 'POST', url: '/api/setup/save-choice', headers: BROWSER_HEADERS, payload: { root: 'D:\\new_tdx' } })
      const first = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: 'attempt-1' },
      })
      expect(first.statusCode).toBe(202)
      // 模拟监管进程写入终态
      await writeFile(join(dataDir, 'setup-restart-status.json'), JSON.stringify({
        version: 1, appId: 'a-share-kline-trainer', attemptId: 'attempt-1', phase: 'rolled-back', done: true,
      }))
      const second = await app.inject({
        method: 'POST', url: '/api/setup/apply', headers: BROWSER_HEADERS,
        payload: { root: 'D:\\new_tdx', attemptId: 'attempt-2' },
      })
      expect(second.statusCode).toBe(202)
      expect(second.json().attemptId).toBe('attempt-2')
    } finally { await app.close() }
  })
})

describe('GET /api/setup/restart-status', () => {
  it('reports idle without a status file and bounds the reason text', async () => {
    const dataDir = await tempDataDir()
    const app = await buildApp({}, { dataDir })
    try {
      const idle = await app.inject({ method: 'GET', url: '/api/setup/restart-status', headers: BROWSER_HEADERS })
      expect(idle.statusCode).toBe(200)
      expect(idle.json()).toEqual({ phase: 'idle', done: false })

      await writeFile(join(dataDir, 'setup-restart-status.json'), JSON.stringify({
        version: 1, appId: 'a-share-kline-trainer', attemptId: 'attempt-9',
        phase: 'ready', stage: 'ready', reason: '受控重启完成', updatedAt: '2026-09-29T10:00:00.000Z', done: true,
      }))
      const ready = await app.inject({ method: 'GET', url: '/api/setup/restart-status', headers: BROWSER_HEADERS })
      expect(ready.statusCode).toBe(200)
      expect(ready.json()).toMatchObject({ attemptId: 'attempt-9', phase: 'ready', done: true })

      const chromiumGet = await app.inject({
        method: 'GET',
        url: '/api/setup/restart-status',
        headers: { host: '127.0.0.1:8787', 'sec-fetch-site': 'same-origin' },
      })
      expect(chromiumGet.statusCode).toBe(200)
      expect(chromiumGet.json()).toMatchObject({ attemptId: 'attempt-9', phase: 'ready', done: true })
    } finally { await app.close() }
  })

  it('never echoes the control token', async () => {
    const dataDir = await tempDataDir()
    const app = await buildApp({}, { dataDir, controlToken: TOKEN })
    try {
      const response = await app.inject({ method: 'GET', url: '/api/setup/restart-status', headers: BROWSER_HEADERS })
      expect(response.statusCode).toBe(200)
      expect(response.body).not.toContain(TOKEN)
    } finally { await app.close() }
  })
})
