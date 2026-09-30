// 兼容候选端点：自动检测已关闭，GET /api/setup/candidates 只返回迁移提示；
// 用户通过 /api/setup/select-directory 选择单个目录后再 inspect/save。
// 测试全程注入合成 processQuery/inspect stub，零真实进程/TDX 读取；不打印令牌。
import Fastify, { type FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import type { TdxCandidateCheck } from '../src/tdx/inspect'
import type { ProcessQueryResult } from '../src/tdx/process-clues'
import { migrateDatabase } from '../src/db.js'
import { registerApi } from '../src/api.js'
import type { AppConfig } from '../src/config.js'

// 每个用例都重建内存 SQLite＋迁移＋Fastify 全量注册，threads 池满载并行下整体耗时
// 可数倍于串行（本仓全量运行曾两次在不同用例上以默认 5000ms 超时失败，串行均绿）。
// 与 docs-tooling（20s）、review-profile（30s）、worktree-tools（90s）、settings-training
// （20s，fd575f5）同一先例：真实 I/O 预算放宽到 20s，断言不变——时间预算修正，
// 不是产品延迟 SLO（testing.md 同款口径）。
vi.setConfig({ testTimeout: 20_000 })

const TOKEN = 'e2e-control-token'
const TOKEN_NEVER_PRINT = 'e2e-control-token'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8787,
    host: '127.0.0.1',
    databasePath: ':memory:',
    tdxRoot: null,
    controlToken: TOKEN,
    ...overrides,
  }
}

function makeCheck(root: string): TdxCandidateCheck {
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
  }
}

interface SetupStubs {
  processQuery: () => Promise<ProcessQueryResult>
  inspect: (roots: readonly string[]) => Promise<TdxCandidateCheck[]>
}

interface RecordedCalls {
  queryCalls: number
  inspectInputs: string[][]
}

async function buildApp(
  stubs: Partial<SetupStubs>,
  configOverrides: Partial<AppConfig> = {},
  calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] },
): Promise<FastifyInstance> {
  const app = Fastify()
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  await registerApi(app, makeConfig(configOverrides), database, {
    setup: {
      processQuery: stubs.processQuery ?? (async () => {
        calls.queryCalls += 1
        const result: ProcessQueryResult = {
          exitCode: 0,
          stdout: 'D:\\new_tdx\\bin\\TdxW.exe',
          stderr: '',
          timedOut: false,
        }
        return result
      }),
      inspect: stubs.inspect ?? (async roots => roots.map(root => makeCheck(root))),
    },
  })
  return app
}

const BROWSER_HEADERS = {
  host: '127.0.0.1:8787',
  origin: 'http://127.0.0.1:8787',
  'sec-fetch-site': 'same-origin',
}

const HELPER_HEADERS = {
  host: '127.0.0.1:8787',
  'x-control-token': TOKEN,
}

describe('GET /api/setup/candidates', () => {
  it('browser same-origin request returns disabled status and never calls diagnostics', async () => {
    const calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] }
    const app = await buildApp({}, {}, calls)
    const response = await app.inject({ method: 'GET', url: '/api/setup/candidates', headers: BROWSER_HEADERS })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.processStatus).toBe('disabled')
    expect(body.candidates).toEqual([])
    expect(body.processReason).toContain('自动检测已关闭')
    expect(response.body).not.toContain(TOKEN_NEVER_PRINT)
    expect(calls.queryCalls).toBe(0)
  })

  it('helper request with the configured token succeeds', async () => {
    const calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] }
    const app = await buildApp({}, {}, calls)
    const response = await app.inject({ method: 'GET', url: '/api/setup/candidates', headers: HELPER_HEADERS })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.processStatus).toBe('disabled')
    expect(body.candidates).toEqual([])
  })

  it('helper request with a wrong token is rejected 401 and never calls diagnostics', async () => {
    const calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] }
    const app = await buildApp({}, {}, calls)
    const response = await app.inject({
      method: 'GET', url: '/api/setup/candidates',
      headers: { host: '127.0.0.1:8787', 'x-control-token': 'wrong' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('TOKEN_INVALID')
    expect(calls.queryCalls).toBe(0)
  })

  it('helper request without token when none configured is 401 TOKEN_UNCONFIGURED', async () => {
    const app = await buildApp({}, { controlToken: null })
    const response = await app.inject({
      method: 'GET', url: '/api/setup/candidates', headers: { host: '127.0.0.1:8787' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('TOKEN_UNCONFIGURED')
  })

  it('host mismatch is 403 HOST_MISMATCH regardless of tokens', async () => {
    const calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] }
    const app = await buildApp({}, {}, calls)
    const response = await app.inject({
      method: 'GET', url: '/api/setup/candidates',
      headers: { host: 'evil.example:8787', 'x-control-token': TOKEN },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('HOST_MISMATCH')
    expect(calls.queryCalls).toBe(0)
  })

  it('origin mismatch is 403 ORIGIN_MISMATCH', async () => {
    const calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] }
    const app = await buildApp({}, {}, calls)
    const response = await app.inject({
      method: 'GET', url: '/api/setup/candidates',
      headers: { host: '127.0.0.1:8787', origin: 'http://evil.example:8787' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('ORIGIN_MISMATCH')
    expect(calls.queryCalls).toBe(0)
  })

  it('expected host comes from config, never from the request Host header', async () => {
    const app = await buildApp({}, { host: '127.0.0.1', port: 8787 })
    const response = await app.inject({
      method: 'GET', url: '/api/setup/candidates',
      headers: { host: '127.0.0.1:9999', origin: 'http://127.0.0.1:9999' },
    })
    // 请求自证 127.0.0.1:9999 也不能通过：expectedHost 由配置构造
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('HOST_MISMATCH')
  })

  it('diagnostics stubs are ignored because automatic discovery is disabled', async () => {
    const calls: RecordedCalls = { queryCalls: 0, inspectInputs: [] }
    const app = await buildApp({
      inspect: async () => { throw new Error('inspect exploded') },
    }, {}, calls)
    const response = await app.inject({ method: 'GET', url: '/api/setup/candidates', headers: BROWSER_HEADERS })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.processStatus).toBe('disabled')
    expect(body.candidates).toEqual([])
  })

  it('process timeout status is passed through with empty candidates', async () => {
    const app = await buildApp({
      processQuery: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
    }, {})
    const response = await app.inject({
      method: 'GET', url: '/api/setup/candidates',
      headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.processStatus).toBe('disabled')
    expect(body.candidates).toEqual([])
  })
})
