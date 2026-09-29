// M4-HISTORY-01 服务测试：历史列表与只读事实成绩单（合同 control-handoff-20260928-53）。
// 合成 SQLite 直接落库训练/成交/权益/画线，不读 TDX、不建行情文件；
// no-future oracle：tdxRoot 缺失下历史接口必须纯靠持久数据成功，且调用前后库内容零变化。
// 冻结手算样例：初始 100000、结算日持久点 110000 → 收益率 0.1；末笔现金 90000 不是最终权益；
// 零成交 100000→100000 = 0；结算点缺失不得用前一日 109000 代补。
import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import { settledFact } from '../src/train/history-report.js'

type Database = InstanceType<typeof DatabaseSync>

function validRules(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    feesEnabled: true,
    tPlusOne: true,
    commissionRate: 0.00025,
    minimumCommission: 5,
    stampDutyRate: 0.0005,
    lotSize: 100,
    execution: 'same-day-raw-close',
    weightBasis: 'total-equity',
    corporateActionPolicy: 'cash-shares-v1',
    capturedAt: '2026-08-01T08:00:00.000Z',
    origin: 'created',
    ...overrides,
  })
}

interface TrainingOverrides {
  id?: number
  tier?: string
  status?: string
  early_settle?: number
  settle_date?: string | null
  initial_cash?: number
  start_date?: string
  blind?: number
  rules_json?: string | null
  range?: { mode: string; start: string; end: string; count: number }
}

function insertTraining(database: Database, overrides: TrainingOverrides = {}): number {
  const range = overrides.range
  const settleDate = overrides.settle_date ?? '2026-08-28'
  const result = database.prepare(`
    INSERT INTO trainings (
      tier, code, name, market, start_date, planned_end, status, blind,
      adjust_mode, initial_cash, created_at, current_date, current_close,
      settle_date, early_settle,
      range_version, range_mode, requested_start, requested_end,
      range_start, range_end, range_bar_count, range_source_fingerprint, range_notes,
      rules_json
    ) VALUES (?, ?, ?, 'sh', ?, ?, ?, ?, 'forward', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.tier ?? '1M',
    '600000',
    '浦发银行',
    overrides.start_date ?? '2026-08-03',
    range ? range.end : '2026-09-03',
    overrides.status ?? 'settled',
    overrides.blind ?? 0,
    overrides.initial_cash ?? 100_000,
    '2026-08-01T08:00:00.000Z',
    settleDate,
    20,
    settleDate,
    overrides.early_settle ?? 0,
    range ? 1 : 0,
    range ? range.mode : 'tier',
    range ? range.start : null,
    null,
    range ? range.start : null,
    range ? range.end : null,
    range ? range.count : null,
    range ? 'fp-test' : null,
    range ? '[]' : null,
    overrides.rules_json === undefined ? validRules() : overrides.rules_json,
  )
  return Number(result.lastInsertRowid)
}

function insertEquity(database: Database, id: number, date: string, equity: number): void {
  database.prepare('INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)').run(id, date, equity)
}

function insertTrade(database: Database, id: number, seq: number, date: string, side: 'buy' | 'sell', price: number, shares: number, amount: number, fee: number, cashAfter: number): void {
  database.prepare(`
    INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seq, date, side, price, shares, amount, fee, cashAfter, side === 'buy' ? shares : 0, side === 'buy' ? amount + fee : 0)
}

function insertDrawings(database: Database, id: number, payload: string): void {
  database.prepare('INSERT INTO drawings (training_id, payload, updated_at) VALUES (?, ?, ?)').run(id, payload, '2026-08-28T00:00:00.000Z')
}

async function withApp(run: (context: { app: ReturnType<typeof Fastify>; database: Database; config: AppConfig }) => Promise<void>): Promise<void> {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  // no-future oracle 夹具：tdxRoot 缺失——历史接口若触碰行情/扫描必然失败，成功即证明纯持久查询。
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:' }
  await registerApi(app, config, database)
  try {
    await run({ app, database, config })
  } finally {
    await app.close()
    database.close()
  }
}

function dumpDatabase(database: Database): string {
  const tables = ['trainings', 'trades', 'equity_curve', 'drawings', 'position_events', 'settings', 'cache_meta']
  return JSON.stringify(tables.map(table => ({
    table,
    rows: database.prepare(`SELECT * FROM ${table}`).all(),
  })))
}

const lineDrawing = [{
  id: 'report-line-1',
  name: 'segment',
  paneId: 'candle_pane',
  points: [
    { timestamp: Date.parse('2026-08-10T00:00:00Z'), value: 19.9 },
    { timestamp: Date.parse('2026-08-20T00:00:00Z'), value: 20.5 },
  ],
  priceBasis: { scale: 0.5, offset: 2 },
}]

describe('HISTORY-list GET /api/trainings/history', () => {
  it('只返回 settled：complete/early-settled 分类如实；abandoned 不出现；RANGE 与五档 rangeMode 如实分类', async () => {
    await withApp(async ({ app, database }) => {
      const complete = insertTraining(database, { tier: '3M', early_settle: 0 })
      insertEquity(database, complete, '2026-08-28', 110_000)
      const early = insertTraining(database, { tier: 'RANGE', early_settle: 1, range: { mode: 'preset', start: '2026-08-03', end: '2026-08-28', count: 20 } })
      insertEquity(database, early, '2026-08-28', 101_000)
      insertTraining(database, { status: 'abandoned' })
      for (const tier of ['1M', '6M', '1Y', '2Y']) {
        const id = insertTraining(database, { tier, early_settle: 0 })
        insertEquity(database, id, '2026-08-28', 100_000)
      }
      for (const mode of ['latest', 'bars'] as const) {
        const id = insertTraining(database, { tier: 'RANGE', early_settle: 0, range: { mode, start: '2026-08-03', end: '2026-08-28', count: 20 } })
        insertEquity(database, id, '2026-08-28', 100_000)
      }

      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.total).toBe(8)
      const byId = new Map(body.items.map((item: { id: number }) => [item.id, item]))
      expect(byId.get(early)).toMatchObject({
        id: early, code: '600000', name: '浦发银行', tier: 'RANGE', rangeMode: 'preset',
        classification: 'early-settled', startDate: '2026-08-03', settleDate: '2026-08-28',
        initialCash: 100_000, finalEquity: 101_000, returnRate: 0.01, tradeCount: 0, integrity: 'ok',
      })
      expect(byId.get(complete)).toMatchObject({ tier: '3M', rangeMode: 'tier', classification: 'complete' })
      for (const tier of ['1M', '6M', '1Y', '2Y']) {
        const found = body.items.find((item: { tier: string }) => item.tier === tier)
        expect(found.rangeMode).toBe('tier')
      }
      expect(body.items.find((item: { rangeMode: string }) => item.rangeMode === 'latest')).toBeTruthy()
      expect(body.items.find((item: { rangeMode: string }) => item.rangeMode === 'bars')).toBeTruthy()
      expect(body.items.some((item: { id: number }) => item.id !== early && item.id !== complete && item.classification !== 'complete')).toBe(false)
    })
  })

  it('稳定排序 settle_date DESC、id DESC：同结算日按 id 降序，早结算日在前', async () => {
    await withApp(async ({ app, database }) => {
      const early = insertTraining(database, { settle_date: '2026-08-20' })
      insertEquity(database, early, '2026-08-20', 100_000)
      const first = insertTraining(database, { settle_date: '2026-08-28' })
      insertEquity(database, first, '2026-08-28', 100_000)
      const second = insertTraining(database, { settle_date: '2026-08-28' })
      insertEquity(database, second, '2026-08-28', 100_000)
      const third = insertTraining(database, { settle_date: '2026-08-28' })
      insertEquity(database, third, '2026-08-28', 100_000)

      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      expect(response.json().items.map((item: { id: number }) => item.id)).toEqual([third, second, first, early])
    })
  })

  it('分页：limit 默认 20、offset 默认 0，total/items/limit/offset 如实，翻页正确', async () => {
    await withApp(async ({ app, database }) => {
      for (let index = 0; index < 25; index += 1) {
        const id = insertTraining(database, { settle_date: index < 10 ? '2026-08-28' : '2026-08-27' })
        insertEquity(database, id, index < 10 ? '2026-08-28' : '2026-08-27', 100_000)
      }
      const firstPage = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(firstPage.statusCode).toBe(200)
      expect(firstPage.json()).toMatchObject({ total: 25, limit: 20, offset: 0 })
      expect(firstPage.json().items).toHaveLength(20)
      // 最近结算日（ids 1~10 的 2026-08-28）在前、组内 id DESC → 首行 id=10
      expect(firstPage.json().items[0].id).toBe(10)

      const secondPage = await app.inject({ method: 'GET', url: '/api/trainings/history?limit=10&offset=20' })
      expect(secondPage.json().items).toHaveLength(5)
      // 全序末 5 行：早结算日组内 id DESC 的尾部
      expect(secondPage.json().items.map((item: { id: number }) => item.id)).toEqual([15, 14, 13, 12, 11])
      expect(secondPage.json()).toMatchObject({ total: 25, limit: 10, offset: 20 })

      const boundary = await app.inject({ method: 'GET', url: '/api/trainings/history?limit=100' })
      expect(boundary.statusCode).toBe(200)
      expect(boundary.json().items).toHaveLength(25)
    })
  })

  it('非法分页参数 400：limit 0/101/非整数/非数字，offset 负数/非整数/非数字', async () => {
    await withApp(async ({ app }) => {
      for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=abc', 'limit=-5', 'offset=-1', 'offset=1.5', 'offset=abc', 'limit=20&offset=-3']) {
        const response = await app.inject({ method: 'GET', url: `/api/trainings/history?${query}` })
        expect(response.statusCode).toBe(400)
      }
    })
  })

  it('冻结手算：初始 100000、结算点 110000 → 收益率 0.1；finalEquity 不取末笔现金 90000；费用只在成交行展示', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, { early_settle: 1 })
      // 买入 500 股 @19.9，amount 9950、佣金 5（9950×0.00025=2.49 低于最低佣金 5）→ 末笔现金 90000
      insertTrade(database, id, 1, '2026-08-05', 'buy', 19.9, 500, 9950, 5, 90_000)
      insertEquity(database, id, '2026-08-03', 100_000)
      insertEquity(database, id, '2026-08-28', 110_000)

      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      const item = response.json().items.find((row: { id: number }) => row.id === id)
      expect(item.finalEquity).toBe(110_000)
      expect(item.returnRate).toBeCloseTo(0.1, 12)
      expect(item.tradeCount).toBe(1)
      // 90000 是末笔现金，不是最终权益：不得出现
      expect(item.finalEquity).not.toBe(90_000)
    })
  })

  it('结算日持久点缺失：不得用前一日 109000 代补，integrity=unavailable 且 finalEquity/returnRate=null', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, {})
      insertEquity(database, id, '2026-08-27', 109_000)

      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      const item = response.json().items.find((row: { id: number }) => row.id === id)
      expect(item.integrity).toBe('unavailable')
      expect(item.integrityReason).toContain('结算日')
      expect(item.finalEquity).toBeNull()
      expect(item.returnRate).toBeNull()
      expect(item.finalEquity).not.toBe(109_000)
    })
  })

  it('settle_date 缺失、initial_cash 非正有限：行标 unavailable，其余行不受影响', async () => {
    await withApp(async ({ app, database }) => {
      const good = insertTraining(database, {})
      insertEquity(database, good, '2026-08-28', 100_000)
      const noDate = insertTraining(database, { settle_date: null })
      const zeroCash = insertTraining(database, { initial_cash: 0 })
      insertEquity(database, zeroCash, '2026-08-28', 100_000)

      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      const items = response.json().items
      const byId = new Map(items.map((item: { id: number }) => [item.id, item]))
      expect(byId.get(good).integrity).toBe('ok')
      expect(byId.get(noDate).integrity).toBe('unavailable')
      expect(byId.get(noDate).finalEquity).toBeNull()
      expect(byId.get(zeroCash).integrity).toBe('unavailable')
      expect(byId.get(zeroCash).finalEquity).toBeNull()
      expect(items).toHaveLength(3)
    })
  })

  it('坏 rules 与 legacy-raw 行与好行共存：列表仍可访问，仅对应行标不可用；合法新 raw 不受影响', async () => {
    await withApp(async ({ app, database }) => {
      const good = insertTraining(database, {})
      insertEquity(database, good, '2026-08-28', 100_000)
      const nullRules = insertTraining(database, { rules_json: null })
      insertEquity(database, nullRules, '2026-08-28', 100_000)
      const brokenRules = insertTraining(database, { rules_json: '{"version":2}' })
      insertEquity(database, brokenRules, '2026-08-28', 100_000)
      const legacyRaw = insertTraining(database, { rules_json: validRules({ corporateActionPolicy: 'legacy-raw-unverified', origin: 'legacy-migration' }) })
      insertEquity(database, legacyRaw, '2026-08-28', 100_000)
      // 合法新 raw：adjust_mode=raw 但规则仍是 cash-shares-v1，不得被否定
      const newRaw = insertTraining(database, {})
      database.prepare('UPDATE trainings SET adjust_mode = ? WHERE id = ?').run('raw', newRaw)
      insertEquity(database, newRaw, '2026-08-28', 105_000)

      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      expect(response.json().total).toBe(5)
      const byId = new Map(response.json().items.map((item: { id: number }) => [item.id, item]))
      expect(byId.get(good).integrity).toBe('ok')
      expect(byId.get(newRaw).integrity).toBe('ok')
      expect(byId.get(newRaw).finalEquity).toBe(105_000)
      expect(byId.get(nullRules).integrity).toBe('unavailable')
      expect(byId.get(nullRules).integrityReason).toContain('规则')
      expect(byId.get(brokenRules).integrity).toBe('unavailable')
      expect(byId.get(legacyRaw).integrity).toBe('unavailable')
      expect(byId.get(legacyRaw).integrityReason).toContain('权息')
      for (const broken of [nullRules, brokenRules, legacyRaw]) {
        expect(byId.get(broken).finalEquity).toBeNull()
        expect(byId.get(broken).returnRate).toBeNull()
      }
    })
  })

  it('blind 训练结算后列表如实展示代码/名称（脱敏只属于进行中）', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, { blind: 1 })
      insertEquity(database, id, '2026-08-28', 100_000)
      const response = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(response.statusCode).toBe(200)
      expect(response.json().items[0]).toMatchObject({ code: '600000', name: '浦发银行' })
    })
  })

  it('no-future：存在 running 训练时列表 409 HISTORY_ACTIVE_TRAINING，零历史字段；结束后恢复可查', async () => {
    await withApp(async ({ app, database }) => {
      const settled = insertTraining(database, {})
      insertEquity(database, settled, '2026-08-28', 100_000)
      insertTraining(database, { status: 'running', settle_date: null })

      const blocked = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(blocked.statusCode).toBe(409)
      expect(blocked.json().code).toBe('HISTORY_ACTIVE_TRAINING')
      expect(blocked.json().error).toContain('结束当前训练后可查看历史')
      expect(blocked.json().items).toBeUndefined()
      expect(blocked.json().total).toBeUndefined()

      database.prepare("UPDATE trainings SET status = 'abandoned' WHERE status = 'running'").run()
      const released = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(released.statusCode).toBe(200)
      expect(released.json().items.map((item: { id: number }) => item.id)).toEqual([settled])
    })
  })

  it('no-future oracle：无 TDX 配置下列表/报告纯靠持久数据成功，且调用前后库内容零变化（无写入/回填）', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, { early_settle: 1 })
      insertTrade(database, id, 1, '2026-08-05', 'buy', 19.9, 500, 9950, 5, 90_000)
      insertEquity(database, id, '2026-08-03', 100_000)
      insertEquity(database, id, '2026-08-28', 110_000)
      insertDrawings(database, id, JSON.stringify(lineDrawing))
      const before = dumpDatabase(database)

      const list = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(list.statusCode).toBe(200)
      const report = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(report.statusCode).toBe(200)
      expect(dumpDatabase(database)).toBe(before)
    })
  })
})

describe('settledFact 纯函数（非有限结算点口径）', () => {
  it('结算点非有限 → unavailable，不以 Infinity/NaN 进入 finalEquity', () => {
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const fact = settledFact(100_000, '2026-08-28', bad)
      expect(fact.integrity).toBe('unavailable')
      expect(fact.finalEquity).toBeNull()
      expect(fact.returnRate).toBeNull()
      expect(fact.integrityReason).toBeTruthy()
    }
  })
  it('合法输入 → finalEquity/returnRate 精确比率（110000/100000=0.1）', () => {
    expect(settledFact(100_000, '2026-08-28', 110_000)).toEqual({
      finalEquity: 110_000, returnRate: 0.1, integrity: 'ok',
    })
  })
})

describe('HISTORY-report GET /api/trainings/:id/report', () => {
  async function seedFullTraining(database: Database): Promise<number> {
    const id = insertTraining(database, { early_settle: 1, tier: '3M' })
    insertTrade(database, id, 1, '2026-08-05', 'buy', 19.9, 500, 9950, 5, 90_000)
    insertTrade(database, id, 2, '2026-08-20', 'sell', 21.5, 500, 10_750, 8.13, 100_741.87)
    insertEquity(database, id, '2026-08-03', 100_000)
    insertEquity(database, id, '2026-08-28', 110_000)
    insertDrawings(database, id, JSON.stringify(lineDrawing))
    return id
  }

  it('完整/提前结算报告：事实元信息、冻结 rules（origin/capturedAt）、逐笔成交、持久权益曲线、画线清单', async () => {
    await withApp(async ({ app, database }) => {
      const id = await seedFullTraining(database)
      const response = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.training).toMatchObject({
        id, tier: '3M', rangeMode: 'tier', code: '600000', name: '浦发银行', market: 'sh',
        startDate: '2026-08-03', settleDate: '2026-08-28', classification: 'early-settled',
        adjustMode: 'forward', blind: false, initialCash: 100_000,
      })
      expect(body.rules).toMatchObject({
        version: 1, feesEnabled: true, tPlusOne: true, commissionRate: 0.00025,
        minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100,
        corporateActionPolicy: 'cash-shares-v1', origin: 'created', capturedAt: '2026-08-01T08:00:00.000Z',
      })
      expect(body.finalEquity).toBe(110_000)
      expect(body.returnRate).toBeCloseTo(0.1, 12)
      expect(body.tradeCount).toBe(2)
      expect(body.trades).toEqual([
        { seq: 1, date: '2026-08-05', side: 'buy', price: 19.9, shares: 500, amount: 9950, fee: 5 },
        { seq: 2, date: '2026-08-20', side: 'sell', price: 21.5, shares: 500, amount: 10_750, fee: 8.13 },
      ])
      expect(body.equityCurve).toEqual([
        { date: '2026-08-03', equity: 100_000 },
        { date: '2026-08-28', equity: 110_000 },
      ])
      expect(body.drawingsStatus).toBe('ok')
      expect(body.drawings).toEqual(lineDrawing)
    })
  })

  it('到期结算 classification=complete；finalEquity 取结算持久点 110000 而非末笔现金', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, { early_settle: 0 })
      insertTrade(database, id, 1, '2026-08-05', 'buy', 19.9, 500, 9950, 5, 90_000)
      insertEquity(database, id, '2026-08-28', 110_000)
      const response = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ finalEquity: 110_000, training: { classification: 'complete' } })
    })
  })

  it('零成交：100000→100000，tradeCount 0、trades 空数组、收益率 0；未虚构平仓', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, {})
      insertEquity(database, id, '2026-08-03', 100_000)
      insertEquity(database, id, '2026-08-28', 100_000)
      const response = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ finalEquity: 100_000, returnRate: 0, tradeCount: 0, trades: [] })
    })
  })

  it('RANGE 训练报告：rangeMode preset/latest/bars 如实，不并入五档', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, { tier: 'RANGE', range: { mode: 'bars', start: '2026-08-03', end: '2026-08-28', count: 20 } })
      insertEquity(database, id, '2026-08-28', 100_000)
      const response = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(response.statusCode).toBe(200)
      expect(response.json().training).toMatchObject({ tier: 'RANGE', rangeMode: 'bars' })
      expect(response.json().training.range).toMatchObject({ mode: 'bars', startDate: '2026-08-03', endDate: '2026-08-28', barCount: 20 })
    })
  })

  it('404 无此 ID；400 非法 ID；abandoned 409 HISTORY_NOT_SETTLED', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, {})
      insertEquity(database, id, '2026-08-28', 100_000)
      expect((await app.inject({ method: 'GET', url: '/api/trainings/9999/report' })).statusCode).toBe(404)
      for (const bad of ['abc', '0', '-1', '1.5']) {
        expect((await app.inject({ method: 'GET', url: `/api/trainings/${bad}/report` })).statusCode).toBe(400)
      }
      database.prepare("UPDATE trainings SET status = 'abandoned' WHERE id = ?").run(id)
      const abandoned = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(abandoned.statusCode).toBe(409)
      expect(abandoned.json().code).toBe('HISTORY_NOT_SETTLED')
    })
  })

  it('坏/缺 rules 409 TRAIN_RULES_UNREADABLE；legacy-raw 409 LEGACY_RAW_ACCOUNTING_UNVERIFIED；合法 legacy-migration 如实展示', async () => {
    await withApp(async ({ app, database }) => {
      const nullRules = insertTraining(database, { rules_json: null })
      insertEquity(database, nullRules, '2026-08-28', 100_000)
      const brokenRules = insertTraining(database, { rules_json: 'not-json' })
      insertEquity(database, brokenRules, '2026-08-28', 100_000)
      const legacyRaw = insertTraining(database, { rules_json: validRules({ corporateActionPolicy: 'legacy-raw-unverified', origin: 'legacy-migration' }) })
      insertEquity(database, legacyRaw, '2026-08-28', 100_000)
      const migrated = insertTraining(database, { rules_json: validRules({ origin: 'legacy-migration' }) })
      insertEquity(database, migrated, '2026-08-28', 102_000)

      const unreadable = await app.inject({ method: 'GET', url: `/api/trainings/${nullRules}/report` })
      expect(unreadable.statusCode).toBe(409)
      expect(unreadable.json().code).toBe('TRAIN_RULES_UNREADABLE')
      const broken = await app.inject({ method: 'GET', url: `/api/trainings/${brokenRules}/report` })
      expect(broken.statusCode).toBe(409)
      expect(broken.json().code).toBe('TRAIN_RULES_UNREADABLE')
      const raw = await app.inject({ method: 'GET', url: `/api/trainings/${legacyRaw}/report` })
      expect(raw.statusCode).toBe(409)
      expect(raw.json().code).toBe('LEGACY_RAW_ACCOUNTING_UNVERIFIED')
      const ok = await app.inject({ method: 'GET', url: `/api/trainings/${migrated}/report` })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().rules).toMatchObject({ origin: 'legacy-migration', corporateActionPolicy: 'cash-shares-v1' })
      expect(ok.json().finalEquity).toBe(102_000)
    })
  })

  it('权益缺失：结算日无持久点 → 409 HISTORY_EQUITY_UNAVAILABLE，无写入补回填', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, {})
      insertEquity(database, id, '2026-08-27', 109_000)
      const before = dumpDatabase(database)
      const response = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('HISTORY_EQUITY_UNAVAILABLE')
      expect(response.json().error).toContain('结算日')
      expect(dumpDatabase(database)).toBe(before)
    })
  })

  it('权益曲线与成交限定 start_date..settle_date，范围外数据不输出；曲线升序、成交 seq 升序', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, {})
      insertEquity(database, id, '2026-08-01', 99_000)
      insertEquity(database, id, '2026-08-10', 105_000)
      insertEquity(database, id, '2026-08-28', 110_000)
      insertEquity(database, id, '2026-09-01', 111_000)
      insertTrade(database, id, 1, '2026-08-05', 'buy', 19.9, 500, 9950, 5, 90_000)
      insertTrade(database, id, 2, '2026-09-01', 'sell', 21.5, 500, 10_750, 8.13, 100_741.87)

      const response = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(response.statusCode).toBe(200)
      expect(response.json().equityCurve).toEqual([{ date: '2026-08-10', equity: 105_000 }, { date: '2026-08-28', equity: 110_000 }])
      expect(response.json().trades).toEqual([{ seq: 1, date: '2026-08-05', side: 'buy', price: 19.9, shares: 500, amount: 9950, fee: 5 }])
      expect(response.json().tradeCount).toBe(1)
    })
  })

  it('画线：无行=未保存（空数组非错误）；行 JSON 损坏不得变空成功，drawingsStatus=unavailable+中文原因，其余事实照常', async () => {
    await withApp(async ({ app, database }) => {
      const noDrawings = insertTraining(database, {})
      insertEquity(database, noDrawings, '2026-08-28', 100_000)
      const broken = insertTraining(database, {})
      insertEquity(database, broken, '2026-08-28', 100_000)
      insertDrawings(database, broken, '{not-valid-json')
      const notArray = insertTraining(database, {})
      insertEquity(database, notArray, '2026-08-28', 100_000)
      insertDrawings(database, notArray, '{"a":1}')

      const empty = await app.inject({ method: 'GET', url: `/api/trainings/${noDrawings}/report` })
      expect(empty.statusCode).toBe(200)
      expect(empty.json().drawings).toEqual([])
      expect(empty.json().drawingsStatus).toBe('ok')

      const damaged = await app.inject({ method: 'GET', url: `/api/trainings/${broken}/report` })
      expect(damaged.statusCode).toBe(200)
      expect(damaged.json().drawingsStatus).toBe('unavailable')
      expect(damaged.json().drawingsReason).toBeTruthy()
      expect(damaged.json().drawings).toBeNull()
      expect(damaged.json().finalEquity).toBe(100_000)
      expect(damaged.json().training.id).toBe(broken)

      const malformed = await app.inject({ method: 'GET', url: `/api/trainings/${notArray}/report` })
      expect(malformed.statusCode).toBe(200)
      expect(malformed.json().drawingsStatus).toBe('unavailable')
    })
  })

  it('no-future：存在 running 时报告直接 ID 访问同守卫 409，且非法 ID 仍先 400；报告不读行情', async () => {
    await withApp(async ({ app, database }) => {
      const settled = insertTraining(database, {})
      insertEquity(database, settled, '2026-08-28', 100_000)
      insertTraining(database, { status: 'running', settle_date: null })

      const badId = await app.inject({ method: 'GET', url: '/api/trainings/abc/report' })
      expect(badId.statusCode).toBe(400)
      const blocked = await app.inject({ method: 'GET', url: `/api/trainings/${settled}/report` })
      expect(blocked.statusCode).toBe(409)
      expect(blocked.json().code).toBe('HISTORY_ACTIVE_TRAINING')
      expect(blocked.json().training).toBeUndefined()
      expect(blocked.json().trades).toBeUndefined()
    })
  })
})
