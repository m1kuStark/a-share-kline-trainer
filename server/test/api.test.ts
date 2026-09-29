import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'

const encryptedGbbqRecord = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')

function dayRecord(date: number, open: number, high: number, low: number, close: number, amount: number, volume: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(high * 100), 8)
  buffer.writeInt32LE(Math.round(low * 100), 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(amount, 20)
  buffer.writeInt32LE(volume, 24)
  return buffer
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tdx-api-'))
  await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), Buffer.concat([
    dayRecord(20020724, 20, 22, 18, 21, 100, 10),
    dayRecord(20020725, 19, 21, 18, 20, 200, 20),
  ]))
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh000300.day'), Buffer.concat([
    dayRecord(20260831, 4000, 4100, 3950, 4050, 300, 30),
    dayRecord(20260901, 4050, 4120, 4000, 4100, 400, 40),
  ]))
  const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
  gbbq.writeUInt32LE(1, 0)
  encryptedGbbqRecord.copy(gbbq, 4)
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)
  return root
}

async function createApp(root: string) {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  await registerApi(app, config, database)
  return { app, database }
}

describe('market-data API', () => {
  it('returns forward-adjusted bars by default and raw bars on request', async () => {
    const root = await createFixture()
    const { app, database } = await createApp(root)
    try {
      const adjusted = await app.inject({ method: 'GET', url: '/api/kline/600519?from=2002-07-24&to=2002-07-25' })
      expect(adjusted.statusCode).toBe(200)
      const adjustedBody = adjusted.json()
      expect(adjustedBody.adjustmentMode).toBe('forward')
      expect(adjustedBody.bars[0].open).toBeCloseTo((20 - 0.8) / 1.1, 12)
      expect(adjustedBody.bars[1].open).toBe(19)

      const raw = await app.inject({ method: 'GET', url: '/api/kline/600519?adjust=raw' })
      expect(raw.statusCode).toBe(200)
      expect(raw.json()).toMatchObject({
        symbol: 'sh600519',
        adjustmentMode: 'raw',
        bars: [{ date: '2002-07-24', open: 20 }, { date: '2002-07-25', open: 19 }],
      })
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads a benchmark index using its explicit market symbol', async () => {
    const root = await createFixture()
    const { app, database } = await createApp(root)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/kline/sh000300?tf=1W' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        symbol: 'sh000300',
        timeframe: '1W',
        bars: [{ date: '2026-08-31', open: 4000, high: 4120, low: 3950, close: 4100, amount: 700, volume: 70 }],
      })
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects malformed and reversed date ranges with 400 instead of an internal error', async () => {
    const root = await createFixture()
    const { app, database } = await createApp(root)
    try {
      const malformed = await app.inject({ method: 'GET', url: '/api/kline/600519?from=2024-13-99' })
      expect(malformed.statusCode).toBe(400)
      expect(malformed.json().error).toContain('YYYY-MM-DD')

      const reversed = await app.inject({ method: 'GET', url: '/api/kline/600519?from=2024-02-01&to=2024-01-01' })
      expect(reversed.statusCode).toBe(400)
      expect(reversed.json().error).toContain('must not be after')
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports cached catalog and adjustment capabilities in the environment endpoint', async () => {
    const root = await createFixture()
    const { app, database } = await createApp(root)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/env' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        stockCount: 1,
        dataCutoff: '2002-07-25',
        capabilities: { day: true, forwardAdjust: true, benchmark: true, catalogCache: true, training: true },
      })
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refreshes the in-memory catalog after a source day file changes', async () => {
    const root = await createFixture()
    const { app, database } = await createApp(root)
    const file = join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day')
    try {
      const before = await app.inject({ method: 'GET', url: '/api/env' })
      expect(before.json()).toMatchObject({ dataCutoff: '2002-07-25' })

      const original = await import('node:fs/promises').then(({ readFile }) => readFile(file))
      await writeFile(file, Buffer.concat([original, dayRecord(20020726, 21, 23, 20, 22, 250, 25)]))
      const future = new Date(Date.now() + 5_000)
      await utimes(file, future, future)

      const after = await app.inject({ method: 'GET', url: '/api/env' })
      expect(after.json()).toMatchObject({ dataCutoff: '2002-07-26' })
      const stocks = await app.inject({ method: 'GET', url: '/api/stocks?q=600519' })
      expect(stocks.json()).toMatchObject({ items: [{ code: '600519', bars: 3 }] })
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never serves future bars and closes raw kline while a training is running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tdx-api-training-'))
    const directory = join(root, 'vipdoc', 'sh', 'lday')
    await mkdir(directory, { recursive: true })
    await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
    // 25 个工作日：2026-07-01 起，收盘 100 + index
    const dates: string[] = []
    const cursor = new Date('2026-07-01T00:00:00Z')
    while (dates.length < 25) {
      const weekday = cursor.getUTCDay()
      if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    await writeFile(join(directory, 'sh600519.day'), Buffer.concat(dates.map((date, index) =>
      dayRecord(Number(date.replaceAll('-', '')), 100 + index, 100 + index, 100 + index, 100 + index, 1_000_000, 100_000),
    )))
    const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
    gbbq.writeUInt32LE(1, 0)
    encryptedGbbqRecord.copy(gbbq, 4)
    await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)

    const { app, database } = await createApp(root)
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { tier: '1M', code: '600519', start_date: '2026-07-01', initial_cash: 1_000_000 },
      })
      expect(created.statusCode).toBe(201)
      const training = created.json().training
      expect(training.currentDate).toBe('2026-07-01')
      expect(training.plannedEnd).toBe('2026-08-01')

      const conflict = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { tier: '1M', code: '600519', start_date: '2026-07-01' },
      })
      expect(conflict.statusCode).toBe(409)
      // 业务错误必须保留中文信息，不能被 Fastify 默认错误吞成 "Bad Request"
      expect(conflict.json().error).toBe('已有进行中的训练，请先结算或放弃')

      const badCash = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { tier: '1M', code: '600519', start_date: '2026-07-01', initial_cash: 'abc' },
      })
      expect(badCash.statusCode).toBe(400)
      expect(badCash.json().error).toBe('初始资金必须是正数')

      const bought = await app.inject({
        method: 'POST', url: `/api/trainings/${training.id}/trade`,
        payload: { side: 'buy', weightPct: 50 },
      })
      expect(bought.statusCode).toBe(200)
      expect(bought.json().plan).toMatchObject({ side: 'buy', shares: 5_000, amount: 500_000 })

      for (let index = 0; index < 3; index += 1) {
        const advanced = await app.inject({ method: 'POST', url: `/api/trainings/${training.id}/next` })
        expect(advanced.statusCode).toBe(200)
      }
      const current = dates[3]
      const snapshot = await app.inject({ method: 'GET', url: '/api/trainings/active' })
      expect(snapshot.json().training.currentDate).toBe(current)

      for (const tf of ['1D', '1W', '1M']) {
        const bars = await app.inject({ method: 'GET', url: `/api/trainings/${training.id}/bars?tf=${tf}` })
        expect(bars.statusCode).toBe(200)
        const payload = bars.json()
        for (const bar of payload.bars) {
          expect(bar.date <= current).toBe(true)
        }
        expect(payload.bars.at(-1).date <= current).toBe(true)
      }

      // 训练进行中：原始行情接口关闭，前端拿不到任何全量数据
      const blocked = await app.inject({ method: 'GET', url: '/api/kline/600519?adjust=raw' })
      expect(blocked.statusCode).toBe(409)

      const settled = await app.inject({ method: 'POST', url: `/api/trainings/${training.id}/settle` })
      expect(settled.statusCode).toBe(200)
      expect(settled.json().training).toMatchObject({ status: 'settled', earlySettle: true, settleDate: current })

      // 结算后原始行情恢复（复盘数据在 M4 的 replay 接口收口）
      const reopened = await app.inject({ method: 'GET', url: '/api/kline/600519?adjust=raw' })
      expect(reopened.statusCode).toBe(200)

      const tradeAfterSettle = await app.inject({
        method: 'POST', url: `/api/trainings/${training.id}/trade`,
        payload: { side: 'buy', weightPct: 10 },
      })
      expect(tradeAfterSettle.statusCode).toBe(409)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

// ===== REL-LAUNCH-UX-01：页面"保存并退出"生命周期协议 =====
// 与 /api/setup/control/* 共用冻结排空控制器；测试全程注入 stub controller/shutdown，
// 断言：守卫、会话令牌（runId 不可替代）、多标签确认/拒绝/超时、失败不转强制结束、
// 真实监听下的 app.close+database.close 完成与端口释放。
import type { DrainController, PrepareOutcome } from '../src/setup/drain-controller.js'

const EXIT_HOST = { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' }

interface ControllerSpy {
  prepareCalls: string[]
  prepareOutcome: PrepareOutcome
  prepareGate: (() => void) | null
  shutdownCalls: number
  controller: DrainController
}

function makeControllerSpy(overrides: Partial<Pick<ControllerSpy, 'prepareOutcome'>> = {}): ControllerSpy {
  const spy: ControllerSpy = {
    prepareCalls: [],
    prepareOutcome: { kind: 'prepared', leaseExpiresAtMs: Date.now() + 30_000 },
    prepareGate: null,
    shutdownCalls: 0,
    controller: null as unknown as DrainController,
  }
  if (overrides.prepareOutcome) spy.prepareOutcome = overrides.prepareOutcome
  spy.controller = {
    gate: { isOpen: () => true, admit: () => ({ ok: true, release: () => {} }), registerTaskSource: () => {}, close: () => {} },
    prepare: async attemptId => {
      spy.prepareCalls.push(attemptId)
      if (spy.prepareGate) await new Promise<void>(resolve => { spy.prepareGate = (() => { spy.prepareGate = null; resolve() }) as () => void })
      return spy.prepareOutcome
    },
    cancel: () => ({ kind: 'cancelled' }),
    beginShutdown: () => ({ kind: 'closing' }),
  }
  return spy
}

async function createLifecycleApp(spy: ControllerSpy, options: { now?: () => number } = {}) {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 8787, databasePath: ':memory:', tdxRoot: null }
  let clock = options.now ?? (() => Date.now())
  await registerApi(app, config, database, {
    lifecycle: { controller: spy.controller, shutdown: () => { spy.shutdownCalls += 1 }, now: () => clock() },
  })
  return {
    app,
    database,
    setClock: (next: () => number) => { clock = next },
    async createSession(): Promise<{ sessionId: string, exitToken: string }> {
      const response = await app.inject({ method: 'POST', url: '/api/lifecycle/session', headers: EXIT_HOST })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { sessionId: string, exitToken: string }
      return { sessionId: body.sessionId, exitToken: body.exitToken }
    },
  }
}

describe('lifecycle exit protocol (REL-LAUNCH-UX-01)', () => {
  it('issues per-session random capability tokens and never exposes runId-shaped credentials', async () => {
    const spy = makeControllerSpy()
    const { app, createSession } = await createLifecycleApp(spy)
    try {
      const first = await createSession()
      const second = await createSession()
      expect(first.sessionId).not.toBe(second.sessionId)
      expect(first.exitToken).not.toBe(second.exitToken)
      // 令牌是随机能力凭证，不是任何可公开获取的 runId/健康字段
      expect(first.exitToken).not.toMatch(/^run-/)
      const health = await app.inject({ method: 'GET', url: '/api/health' })
      expect(health.body).not.toContain(first.exitToken)
    } finally { await app.close() }
  })

  it('rejects cross-origin requests, bad session tokens, and unavailable lifecycle wiring', async () => {
    const spy = makeControllerSpy()
    const { app, createSession } = await createLifecycleApp(spy)
    try {
      const crossOrigin = await app.inject({
        method: 'POST', url: '/api/lifecycle/session',
        headers: { host: '127.0.0.1:8787', origin: 'http://evil.example:8787' },
      })
      expect(crossOrigin.statusCode).toBe(403)
      expect(crossOrigin.json().error).toBe('ORIGIN_MISMATCH')

      const session = await createSession()
      const badToken = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: session.sessionId, exitToken: 'forged' },
      })
      expect(badToken.statusCode).toBe(403)
      expect(badToken.json().error).toBe('SESSION_TOKEN_INVALID')
      expect(spy.shutdownCalls).toBe(0)
    } finally { await app.close() }

    // 未注入 lifecycle → 503，且不创建任何会话
    const bare = Fastify()
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const bareConfig: AppConfig = { host: '127.0.0.1', port: 8787, databasePath: ':memory:', tdxRoot: null }
    await registerApi(bare, bareConfig, database)
    try {
      const response = await bare.inject({ method: 'POST', url: '/api/lifecycle/session', headers: EXIT_HOST })
      expect(response.statusCode).toBe(503)
      expect(response.json().error).toBe('LIFECYCLE_UNAVAILABLE')
    } finally { await bare.close() }
  })

  it('single tab: exit drains via the frozen controller then closes the app exactly once', async () => {
    const spy = makeControllerSpy()
    const { app, createSession } = await createLifecycleApp(spy)
    try {
      const session = await createSession()
      const exit = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: session.sessionId, exitToken: session.exitToken },
      })
      expect(exit.statusCode).toBe(202)
      expect(exit.json()).toMatchObject({ phase: 'draining', remaining: 0 })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(spy.prepareCalls).toEqual([expect.stringMatching(/^lifecycle-/)])
      expect(spy.shutdownCalls).toBe(1)
      // 状态保持 draining 直到进程真的退出（页面以端口不可达判定）
      const status = await app.inject({ method: 'GET', url: '/api/lifecycle/status', headers: EXIT_HOST })
      expect(status.json().phase).toBe('draining')
    } finally { await app.close() }
  })

  it('maps honest failures: active training and drain timeout never become a force stop', async () => {
    for (const outcome of [
      { kind: 'active-training' } as PrepareOutcome,
      { kind: 'drain-timeout' } as PrepareOutcome,
    ]) {
      const spy = makeControllerSpy({ prepareOutcome: outcome })
      const { app, createSession } = await createLifecycleApp(spy)
      try {
        const session = await createSession()
        const exit = await app.inject({
          method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
          payload: { sessionId: session.sessionId, exitToken: session.exitToken },
        })
        expect(exit.statusCode).toBe(202)
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(spy.shutdownCalls).toBe(0)
        const status = await app.inject({ method: 'GET', url: '/api/lifecycle/status', headers: EXIT_HOST })
        const body = status.json() as { phase: string, reason: string }
        expect(body.phase).toBe('failed')
        if (outcome.kind === 'active-training') expect(body.reason).toContain('训练')
        else expect(body.reason).toContain('排空')
      } finally { await app.close() }
    }
  })

  it('multi-tab: every live tab must explicitly confirm before draining; refusal cancels', async () => {
    const spy = makeControllerSpy()
    const { app, createSession } = await createLifecycleApp(spy)
    try {
      const a = await createSession()
      const b = await createSession()
      const exit = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: a.sessionId, exitToken: a.exitToken },
      })
      expect(exit.json()).toMatchObject({ phase: 'awaiting', remaining: 1 })

      // B 心跳发现退出请求
      const beat = await app.inject({
        method: 'POST', url: '/api/lifecycle/heartbeat', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken },
      })
      const pending = beat.json().pendingExit as { requestId: string, requestedByMe: boolean }
      expect(pending).toMatchObject({ requestedByMe: false })
      expect(pending.requestId).toBeTruthy()

      // 错误 requestId 的确认不生效
      const wrongConfirm = await app.inject({
        method: 'POST', url: '/api/lifecycle/confirm', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken, requestId: 'wrong-id' },
      })
      expect(wrongConfirm.json().phase).toBe('idle')
      expect(spy.shutdownCalls).toBe(0)

      // B 拒绝 → 取消，服务不停止
      const refuse = await app.inject({
        method: 'POST', url: '/api/lifecycle/cancel-exit', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken, requestId: pending.requestId },
      })
      expect(refuse.json().phase).toBe('cancelled')
      const status = await app.inject({ method: 'GET', url: '/api/lifecycle/status', headers: EXIT_HOST })
      expect(status.json()).toMatchObject({ phase: 'cancelled' })
      expect(spy.prepareCalls).toEqual([])
      expect(spy.shutdownCalls).toBe(0)

      // 重新发起：B 确认 → draining
      const retry = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: a.sessionId, exitToken: a.exitToken },
      })
      expect(retry.json()).toMatchObject({ phase: 'awaiting' })
      const confirm = await app.inject({
        method: 'POST', url: '/api/lifecycle/confirm', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken, requestId: (retry.json() as { requestId: string }).requestId },
      })
      expect(confirm.json().phase).toBe('draining')
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(spy.prepareCalls).toEqual([expect.stringMatching(/^lifecycle-/)])
      expect(spy.shutdownCalls).toBe(1)
    } finally { await app.close() }
  })

  it('coordination watchdogs: TTL expiry and a vanished requester cancel instead of stopping', async () => {
    let nowMs = 1_000_000
    const spy = makeControllerSpy()
    const { app, createSession } = await createLifecycleApp(spy, { now: () => nowMs })
    try {
      const a = await createSession()
      const b = await createSession()
      const exit = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: a.sessionId, exitToken: a.exitToken },
      })
      expect(exit.json().phase).toBe('awaiting')

      // TTL 超时：B 始终不确认 → 如实失败，不排空
      nowMs += 121_000
      const ttl = await app.inject({ method: 'GET', url: '/api/lifecycle/status', headers: EXIT_HOST })
      expect(ttl.json()).toMatchObject({ phase: 'failed' })
      expect(String(ttl.json().reason)).toContain('秒')
      expect(spy.shutdownCalls).toBe(0)

      // 发起页失联：先让 A/B 都活跃，B 发起退出后 A 停止心跳 → 取消
      await app.inject({
        method: 'POST', url: '/api/lifecycle/heartbeat', headers: EXIT_HOST,
        payload: { sessionId: a.sessionId, exitToken: a.exitToken },
      })
      await app.inject({
        method: 'POST', url: '/api/lifecycle/heartbeat', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken },
      })
      const retry = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: a.sessionId, exitToken: a.exitToken },
      })
      expect(retry.json()).toMatchObject({ phase: 'awaiting', remaining: 1 })
      nowMs += 91_000
      const beat = await app.inject({
        method: 'POST', url: '/api/lifecycle/heartbeat', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken },
      })
      expect(beat.json().phase).toBe('cancelled')
      expect(spy.shutdownCalls).toBe(0)

      // 长时间静默的成员（GC 后）不再阻塞：A 独自请求可进入排空
      nowMs += 300_000
      const solo = await app.inject({
        method: 'POST', url: '/api/lifecycle/exit', headers: EXIT_HOST,
        payload: { sessionId: b.sessionId, exitToken: b.exitToken },
      })
      expect(solo.json()).toMatchObject({ phase: 'draining', remaining: 0 })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(spy.shutdownCalls).toBe(1)
    } finally { await app.close() }
  })

  it('lifecycle endpoints stay reachable while the business gate is closed', async () => {
    const spy = makeControllerSpy()
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const app = Fastify()
    const config: AppConfig = { host: '127.0.0.1', port: 8787, databasePath: ':memory:', tdxRoot: null }
    const closedGate = {
      isOpen: () => false,
      admit: () => ({ ok: false as const }),
      registerTaskSource: () => {},
      close: () => {},
    }
    await registerApi(app, config, database, {
      drain: closedGate,
      lifecycle: { controller: spy.controller, shutdown: () => { spy.shutdownCalls += 1 } },
    })
    try {
      const env = await app.inject({ method: 'GET', url: '/api/env' })
      expect(env.statusCode).toBe(503)
      const status = await app.inject({ method: 'GET', url: '/api/lifecycle/status', headers: EXIT_HOST })
      expect(status.statusCode).toBe(200)
    } finally { await app.close() }
  })

  it('real listener: graceful exit completes app.close + database.close and releases the port', async () => {
    const spy = makeControllerSpy()
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const app = Fastify()
    const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: null }
    await registerApi(app, config, database, {
      lifecycle: {
        controller: spy.controller,
        shutdown: async () => {
          spy.shutdownCalls += 1
          await app.close()
          database.close()
        },
      },
    })
    // /api/health 由 index.ts 注册；此测试为了真实端口/健康复核按同样形状补齐
    app.get('/api/health', async () => ({ status: 'ok' }))
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    expect(address !== null && typeof address === 'object').toBe(true)
    const port = (address as { port: number }).port
    config.port = port
    const origin = `http://127.0.0.1:${port}`
    try {
      const health = await fetch(`${origin}/api/health`)
      expect(health.status).toBe(200)

      const sessionResponse = await fetch(`${origin}/api/lifecycle/session`, {
        method: 'POST', headers: { origin },
      })
      expect(sessionResponse.status).toBe(200)
      const session = await sessionResponse.json() as { sessionId: string, exitToken: string }

      const exit = await fetch(`${origin}/api/lifecycle/exit`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, exitToken: session.exitToken }),
      })
      expect(exit.status).toBe(202)

      // 正常退出 = app.close + database.close 完成、端口释放；绝不依赖 SIGKILL
      for (let attempt = 0; attempt < 100 && spy.shutdownCalls === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(spy.shutdownCalls).toBe(1)
      for (let attempt = 0; attempt < 100 && app.server.listening; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(app.server.listening).toBe(false)
      let refused = false
      try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) }) } catch { refused = true }
      expect(refused).toBe(true)
      expect(() => database.prepare('SELECT 1').get()).toThrow()
    } finally {
      if (app.server.listening) await app.close()
      try { database.close() } catch { /* 已被退出路径关闭：这正是被验证的行为 */ }
    }
  })
})
