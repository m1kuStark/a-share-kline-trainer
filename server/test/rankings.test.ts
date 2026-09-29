// M4-01 服务测试：五档排行分组/排序/排除与复盘防未来守卫（骨架阶段）。
// 合成 SQLite 直接落库，不读 TDX、不建行情文件；守卫 oracle：无 tdxRoot 下排行成功即纯持久查询。
// 排序冻结样例（roadmap §2.7）：完整组 收益率↓→最大回撤↑→胜率↓(null殿后)→id↓；提前组 收益率↓→id↓。
// 胜率/盈亏比/基准超额为口径冻结前骨架字段，恒 null——本断言防止骨架冒充口径值。
import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import { maxDrawdownOf } from '../src/train/metrics.js'
import { rankingGroups } from '../src/train/rankings.js'

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
  rules_json?: string | null
}

function insertTraining(database: Database, overrides: TrainingOverrides = {}): number {
  const settleDate = overrides.settle_date ?? '2026-08-28'
  const result = database.prepare(`
    INSERT INTO trainings (
      tier, code, name, market, start_date, planned_end, status, blind,
      adjust_mode, initial_cash, created_at, current_date, current_close,
      settle_date, early_settle, rules_json
    ) VALUES (?, ?, ?, 'sh', ?, ?, ?, 0, 'forward', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.tier ?? '1M',
    '600519',
    '贵州茅台',
    overrides.start_date ?? '2026-08-03',
    '2026-09-01',
    overrides.status ?? 'settled',
    overrides.initial_cash ?? 100_000,
    overrides.start_date ?? '2026-08-03',
    overrides.start_date ?? '2026-08-03',
    20,
    settleDate,
    overrides.early_settle ?? 0,
    overrides.rules_json === undefined ? validRules() : overrides.rules_json,
  )
  return Number(result.lastInsertRowid)
}

function insertEquity(database: Database, id: number, date: string, equity: number): void {
  database.prepare('INSERT INTO equity_curve (training_id, date, equity) VALUES (?, ?, ?)').run(id, date, equity)
}

async function withApp(run: (context: { app: ReturnType<typeof Fastify>; database: Database; config: AppConfig }) => Promise<void>): Promise<void> {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:' }
  await registerApi(app, config, database)
  try {
    await run({ app, database, config })
  } finally {
    await app.close()
    database.close()
  }
}

describe('maxDrawdownOf（持久权益点口径）', () => {
  it('峰值序列手算：100→120→90→110 回撤 0.25；单点/空/单调升为 0', () => {
    expect(maxDrawdownOf([100, 120, 90, 110])).toBeCloseTo(0.25, 12)
    expect(maxDrawdownOf([100])).toBe(0)
    expect(maxDrawdownOf([])).toBe(0)
    expect(maxDrawdownOf([1, 2, 3])).toBe(0)
  })
})

describe('rankingGroups 分组与排除', () => {
  it('settled 五档行按 early_settle 分组；abandoned 不出现；RANGE 不因查询混入', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const complete = insertTraining(database, { tier: '3M', early_settle: 0 })
    const early = insertTraining(database, { tier: '3M', early_settle: 1 })
    insertTraining(database, { tier: '3M', status: 'abandoned' })
    const otherTier = insertTraining(database, { tier: '1M', early_settle: 0 })
    for (const id of [complete, early, otherTier]) insertEquity(database, id, '2026-08-03', 100_000)
    insertEquity(database, complete, '2026-08-28', 110_000)
    insertEquity(database, early, '2026-08-28', 105_000)
    insertEquity(database, otherTier, '2026-08-28', 101_000)
    const groups = rankingGroups(database, '3M')
    expect(groups.tier).toBe('3M')
    expect(groups.complete.map(item => item.id)).toEqual([complete])
    expect(groups.earlySettled.map(item => item.id)).toEqual([early])
    expect(groups.excludedUnavailable).toBe(0)
  })

  it('行级不可认证不入榜并如实计数：坏规则、legacy-raw、结算点缺失各计 1', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    insertTraining(database, { rules_json: '{broken' })
    insertTraining(database, { rules_json: validRules({ corporateActionPolicy: 'legacy-raw-unverified' }) })
    const missingPoint = insertTraining(database, {})
    insertEquity(database, missingPoint, '2026-08-27', 109_000)
    const groups = rankingGroups(database, '1M')
    expect(groups.complete).toHaveLength(0)
    expect(groups.excludedUnavailable).toBe(3)
  })

  it('零交易零推进如实入榜：收益率 0、回撤 0、胜率/盈亏比/超额 null（骨架不冒充口径）', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const id = insertTraining(database, {})
    insertEquity(database, id, '2026-08-03', 100_000)
    insertEquity(database, id, '2026-08-28', 100_000)
    const groups = rankingGroups(database, '1M')
    expect(groups.complete).toHaveLength(1)
    const item = groups.complete[0]
    expect(item.returnRate).toBe(0)
    expect(item.maxDrawdown).toBe(0)
    expect(item.actualDays).toBe(2)
    expect(item.tradeCount).toBe(0)
    expect(item.winRate).toBeNull()
    expect(item.profitLossRatio).toBeNull()
    expect(item.benchmarkExcess).toBeNull()
  })
})

describe('排序冻结链（roadmap §2.7）', () => {
  function seedRanked(database: Database, id: number, curve: Array<[string, number]>, early = false): void {
    for (const [date, equity] of curve) insertEquity(database, id, date, equity)
    if (early) database.prepare('UPDATE trainings SET early_settle = 1 WHERE id = ?').run(id)
  }

  it('完整组：收益率↓，同收益率→回撤↑，同收益率同回撤→id↓', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const high = insertTraining(database, {})
    seedRanked(database, high, [['2026-08-03', 100_000], ['2026-08-28', 120_000]])
    const equalLowerDrawdown = insertTraining(database, {})
    seedRanked(database, equalLowerDrawdown, [['2026-08-03', 100_000], ['2026-08-20', 105_000], ['2026-08-28', 110_000]])
    const equalHigherDrawdown = insertTraining(database, {})
    seedRanked(database, equalHigherDrawdown, [['2026-08-03', 100_000], ['2026-08-20', 90_000], ['2026-08-28', 110_000]])
    const groups = rankingGroups(database, '1M')
    expect(groups.complete.map(item => item.id)).toEqual([high, equalLowerDrawdown, equalHigherDrawdown])
    expect(groups.complete[1].maxDrawdown).toBeLessThan(groups.complete[2].maxDrawdown)
  })

  it('提前组：收益率↓→id↓；实际天数＝区间内持久权益点数', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const low = insertTraining(database, { settle_date: '2026-08-20' })
    seedRanked(database, low, [['2026-08-03', 100_000], ['2026-08-20', 102_000]], true)
    const high = insertTraining(database, { settle_date: '2026-08-25' })
    seedRanked(database, high, [['2026-08-03', 100_000], ['2026-08-25', 108_000]], true)
    const groups = rankingGroups(database, '1M')
    expect(groups.earlySettled.map(item => item.id)).toEqual([high, low])
    expect(groups.earlySettled[0].actualDays).toBe(2)
  })
})

describe('GET /api/rankings', () => {
  it('缺 tier/非法 tier 一律 400', async () => {
    await withApp(async ({ app }) => {
      for (const url of ['/api/rankings', '/api/rankings?tier=RANGE', '/api/rankings?tier=3W']) {
        const response = await app.inject({ method: 'GET', url })
        expect(response.statusCode).toBe(400)
      }
    })
  })

  it('存在 running 训练时 409 HISTORY_ACTIVE_TRAINING（与历史同一守卫）', async () => {
    await withApp(async ({ app, database }) => {
      insertTraining(database, { status: 'running' })
      const response = await app.inject({ method: 'GET', url: '/api/rankings?tier=1M' })
      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('HISTORY_ACTIVE_TRAINING')
    })
  })

  it('无 running 时纯持久查询成功：tdxRoot 缺失下照常返回分组', async () => {
    await withApp(async ({ app, database }) => {
      const id = insertTraining(database, { tier: '6M' })
      insertEquity(database, id, '2026-08-03', 100_000)
      insertEquity(database, id, '2026-08-28', 112_000)
      const response = await app.inject({ method: 'GET', url: '/api/rankings?tier=6M' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.tier).toBe('6M')
      expect(body.complete).toHaveLength(1)
      expect(body.complete[0].returnRate).toBeCloseTo(0.12, 10)
    })
  })
})

describe('复盘防未来守卫：GET /api/trainings/:id/bars', () => {
  it('running 存在时：本局自身放行（守卫通过→因缺 TDX 走 503），其他训练 409 HISTORY_ACTIVE_TRAINING', async () => {
    await withApp(async ({ app, database }) => {
      const active = insertTraining(database, { status: 'running' })
      const settled = insertTraining(database, {})
      const ownResponse = await app.inject({ method: 'GET', url: `/api/trainings/${active}/bars` })
      expect(ownResponse.statusCode).toBe(503)
      const otherResponse = await app.inject({ method: 'GET', url: `/api/trainings/${settled}/bars` })
      expect(otherResponse.statusCode).toBe(409)
      expect(otherResponse.json().code).toBe('HISTORY_ACTIVE_TRAINING')
    })
  })

  it('无 running 时历史训练 K 线放行（守卫通过→因缺 TDX 走 503）', async () => {
    await withApp(async ({ app, database }) => {
      const settled = insertTraining(database, {})
      const response = await app.inject({ method: 'GET', url: `/api/trainings/${settled}/bars` })
      expect(response.statusCode).toBe(503)
    })
  })
})
