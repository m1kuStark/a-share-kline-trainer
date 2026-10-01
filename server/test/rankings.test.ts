// M4-01 服务测试：五档排行分组/排序/排除与复盘防未来守卫（骨架阶段）。
// 合成 SQLite 直接落库，不读 TDX、不建行情文件；守卫 oracle：无 tdxRoot 下排行成功即纯持久查询。
// 排序冻结样例（roadmap §2.7）：完整组 收益率↓→最大回撤↑→胜率↓(null殿后)→id↓；提前组 收益率↓→id↓。
// 胜率/盈亏比/基准超额为口径冻结前骨架字段，恒 null——本断言防止骨架冒充口径值。
import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import { maxDrawdownOf, profitLossRatioOf, realizedSellResults, winRateOf } from '../src/train/metrics.js'
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

function insertTrade(database: Database, id: number, seq: number, date: string, side: 'buy' | 'sell', price: number, shares: number, amount: number, fee: number, cashAfter: number): void {
  database.prepare(`
    INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seq, date, side, price, shares, amount, fee, cashAfter, side === 'buy' ? shares : 0, side === 'buy' ? amount + fee : 0)
}

function insertPositionEvent(database: Database, id: number, seq: number, date: string, sharesDelta: number, cashDelta: number, costDelta: number | null): void {
  database.prepare(`
    INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta, cost_delta)
    VALUES (?, ?, ?, 'corporate_action', ?, ?, ?)
  `).run(id, seq, date, sharesDelta, cashDelta, costDelta)
}

/** 32 字节通达信日线记录（与 src/tdx/dayfile.ts 解码互逆；价格分单位）。 */
function dayRecord(date: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(close, 4)
  buffer.writeInt32LE(close, 8)
  buffer.writeInt32LE(close, 12)
  buffer.writeInt32LE(close, 16)
  buffer.writeFloatLE(0, 20)
  buffer.writeInt32LE(0, 24)
  return buffer
}

async function withTdxRoot(run: (context: { app: ReturnType<typeof Fastify>; database: Database; config: AppConfig; root: string }) => Promise<void>, options: { withBenchmark?: boolean } = {}): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'trainer-rankings-'))
  if (options.withBenchmark) {
    await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
    await writeFile(
      join(root, 'vipdoc', 'sh', 'lday', 'sh000300.day'),
      Buffer.concat([dayRecord(20260731, 400_000), dayRecord(20260828, 410_000)]),
    )
  }
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  await registerApi(app, config, database)
  try {
    await run({ app, database, config, root })
  } finally {
    await app.close()
    database.close()
  }
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

  it('无 running 时纯持久查询成功：tdxRoot 缺失下照常返回分组（基准如实 unavailable）', async () => {
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
      expect(body.benchmark.status).toBe('unavailable')
      expect(body.complete[0].benchmarkExcess).toBeNull()
    })
  })

  it('view=stock 按六位代码精确分组，不混入其他股票，并暴露空态', async () => {
    await withApp(async ({ app, database }) => {
      const first = insertTraining(database, { tier: '1M' })
      const other = insertTraining(database, { tier: '1M' })
      database.prepare("UPDATE trainings SET code = '000602', name = '仪表仪器' WHERE id = ?").run(first)
      database.prepare("UPDATE trainings SET code = '000606', name = '青海华鼎' WHERE id = ?").run(other)
      for (const id of [first, other]) {
        insertEquity(database, id, '2026-08-03', 100_000)
        insertEquity(database, id, '2026-08-28', id === first ? 110_000 : 120_000)
      }
      const selected = await app.inject({ method: 'GET', url: '/api/rankings?view=stock&code=000602' })
      expect(selected.statusCode).toBe(200)
      expect(selected.json().stock).toMatchObject({ status: 'ok', code: '000602', name: '仪表仪器' })
      expect(selected.json().complete.map((item: { code: string }) => item.code)).toEqual(['000602'])
      const empty = await app.inject({ method: 'GET', url: '/api/rankings?view=stock&code=600519' })
      expect(empty.statusCode).toBe(200)
      expect(empty.json().stock).toMatchObject({ status: 'empty', code: '600519' })
    })
  })

  it('view=stock 拒绝非六位代码', async () => {
    await withApp(async ({ app }) => {
      const response = await app.inject({ method: 'GET', url: '/api/rankings?view=stock&code=602' })
      expect(response.statusCode).toBe(400)
    })
  })
})

describe('已实现盈亏（拍板 S4 冻结：摊薄成本法，费用含入，持有期分红不进单笔）', () => {
  function seedTrading(database: Database, id: number): void {
    insertEquity(database, id, '2026-08-03', 100_000)
    insertEquity(database, id, '2026-08-28', 100_000)
  }

  it('部分卖出摊薄成本手算（买入费按卖出比例摊销）：400+600 两笔均赢，零亏损盈亏比 null', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const id = insertTraining(database, {})
    seedTrading(database, id)
    // 买 1000@10：金额 10000，佣金 max(5, 2.5)=5 → 成本 10005
    insertTrade(database, id, 1, '2026-08-03', 'buy', 10, 1000, 10_000, 5, 89_995)
    // 卖 400@12：金额 4800，费 max(5,1.2)+4800*0.0005=5+2.4=7.4；摊薄成本 10005*0.4=4002
    //   已实现盈亏 = (4800−7.4) − 4002 = 790.6
    insertTrade(database, id, 2, '2026-08-10', 'sell', 12, 400, 4_800, 7.4, 94_787.6)
    // 卖 600@11：金额 6600，费 max(5,1.65)+3.3=8.3；摊薄成本 10005*0.6=6003
    //   已实现盈亏 = (6600−8.3) − 6003 = 588.7
    insertTrade(database, id, 3, '2026-08-20', 'sell', 11, 600, 6_600, 8.3, 101_379.3)
    const sells = realizedSellResults(database, id, 100_000, 'sh', '600519')
    expect(sells[0].pnl).toBeCloseTo(790.6, 10)
    expect(sells[1].pnl).toBeCloseTo(588.7, 10)
    expect(sells.every(sell => sell.win)).toBe(true)
    expect(winRateOf(sells)).toBe(1)
    expect(profitLossRatioOf(sells)).toBeNull()
    const groups = rankingGroups(database, '1M')
    expect(groups.complete[0].winRate).toBe(1)
    expect(groups.complete[0].profitLossRatio).toBeNull()
  })

  it('一赢一亏盈亏比手算：489.75/509.75；胜率 0.5', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const id = insertTraining(database, {})
    seedTrading(database, id)
    insertTrade(database, id, 1, '2026-08-03', 'buy', 10, 1000, 10_000, 5, 89_995)
    // 卖 500@9：金额 4500，费 5+2.25=7.25；摊薄成本 5002.5 → −509.75
    insertTrade(database, id, 2, '2026-08-10', 'sell', 9, 500, 4_500, 7.25, 94_987.75)
    // 卖 500@11：金额 5500，费 5+2.75=7.75；摊薄成本 5002.5 → +489.75
    insertTrade(database, id, 3, '2026-08-20', 'sell', 11, 500, 5_500, 7.75, 100_477.5)
    const sells = realizedSellResults(database, id, 100_000, 'sh', '600519')
    expect(sells.map(sell => sell.pnl)).toEqual([-509.75, 489.75])
    expect(winRateOf(sells)).toBeCloseTo(0.5, 12)
    expect(profitLossRatioOf(sells)).toBeCloseTo(489.75 / 509.75, 12)
  })

  it('持有期分红不进单笔已实现盈亏：分红 1000 入现金后卖出，单笔仍为 −15 亏损', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const id = insertTraining(database, {})
    seedTrading(database, id)
    insertTrade(database, id, 1, '2026-08-03', 'buy', 10, 1000, 10_000, 5, 89_995)
    // 权息：每 10 股分红 10 → 1000 股入现金 1000，成本不变
    insertPositionEvent(database, id, 1, '2026-08-10', 0, 1_000, 0)
    // 卖 1000@10：金额 10000，费 max(5,2.5)+10000*0.0005=5+5=10；摊薄成本 10005
    //   单笔已实现盈亏 = (10000−10) − 10005 = −15（分红 1000 不计入）
    insertTrade(database, id, 2, '2026-08-20', 'sell', 10, 1000, 10_000, 10, 100_985)
    const sells = realizedSellResults(database, id, 100_000, 'sh', '600519')
    expect(sells).toHaveLength(1)
    expect(sells[0].pnl).toBeCloseTo(-15, 10)
    expect(sells[0].win).toBe(false)
    expect(winRateOf(sells)).toBe(0)
    expect(profitLossRatioOf(sells)).toBeNull()
  })
})

describe('胜率排序键（冻结链第三键，null 殿后在 id 破平局之前）', () => {
  it('同收益率同回撤：有胜率（全赢）排在零交易（null）之前；双 null 才落 id↓', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const zeroTradeSmallId = insertTraining(database, {})
    for (const [date, equity] of [['2026-08-03', 100_000], ['2026-08-28', 110_000]] as const) {
      insertEquity(database, zeroTradeSmallId, date, equity)
    }
    const winnerBigId = insertTraining(database, {})
    for (const [date, equity] of [['2026-08-03', 100_000], ['2026-08-28', 110_000]] as const) {
      insertEquity(database, winnerBigId, date, equity)
    }
    insertTrade(database, winnerBigId, 1, '2026-08-03', 'buy', 10, 1000, 10_000, 0, 90_000)
    insertTrade(database, winnerBigId, 2, '2026-08-28', 'sell', 12, 1000, 12_000, 0, 102_000)
    const groups = rankingGroups(database, '1M')
    expect(groups.complete.map(item => item.id)).toEqual([winnerBigId, zeroTradeSmallId])
  })
})

describe('沪深300超额（拍板 S4：向后对齐 sh000300，算术差；缺失不冒充）', () => {
  function seedReturn(database: Database, tier = '1M'): number {
    const id = insertTraining(database, { tier })
    insertEquity(database, id, '2026-08-03', 100_000)
    insertEquity(database, id, '2026-08-28', 112_000)
    return id
  }

  it('对齐手算：基准 4000→4100（+2.5%），训练 +12% → 超额 +9.5%', async () => {
    await withTdxRoot(async ({ app, database }) => {
      seedReturn(database)
      const response = await app.inject({ method: 'GET', url: '/api/rankings?tier=1M' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.benchmark.status).toBe('ok')
      expect(body.complete[0].benchmarkExcess).toBeCloseTo(0.12 - 0.025, 10)
      expect(body.complete[0].benchmarkExcessReason).toBeUndefined()
    }, { withBenchmark: true })
  })

  it('基准文件缺失：整组 benchmark unavailable＋行级 null＋中文原因', async () => {
    await withTdxRoot(async ({ app, database }) => {
      seedReturn(database)
      const response = await app.inject({ method: 'GET', url: '/api/rankings?tier=1M' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.benchmark.status).toBe('unavailable')
      expect(body.complete[0].benchmarkExcess).toBeNull()
      expect(body.complete[0].benchmarkExcessReason).toContain('缺失')
    }, { withBenchmark: false })
  })

  it('训练起点早于基准覆盖：行级 null＋原因（基准文件本身可用）', async () => {
    await withTdxRoot(async ({ app, database }) => {
      const id = insertTraining(database, { start_date: '2020-01-02', settle_date: '2020-02-03' })
      insertEquity(database, id, '2020-01-02', 100_000)
      insertEquity(database, id, '2020-02-03', 108_000)
      const response = await app.inject({ method: 'GET', url: '/api/rankings?tier=1M' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.benchmark.status).toBe('ok')
      expect(body.complete[0].benchmarkExcess).toBeNull()
      expect(body.complete[0].benchmarkExcessReason).toContain('早于基准数据覆盖')
    }, { withBenchmark: true })
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
