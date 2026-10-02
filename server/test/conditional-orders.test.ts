import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'

// V1.2.5 条件单触发语义修订测试（用户反馈：挂单价未到就成交）。
// 新语义：触发方向按挂单时触发价与阶段价的相对位置冻结（'up' 上触 / 'down' 下触），到价才触发；
// 限价按触发价成交（跳空越过且限价不可成交时保持挂单），止损按开盘价（跳空）/当日收盘价（盘中到价）成交。
// 旧行 trigger_direction=NULL 按经典矩阵推导，行为不变。
// 夹具日线：第 i 个交易日 open=10+0.1i-0.05，high=+0.1，low=-0.1，close=10+0.1i；费用默认关闭、T+1 默认开启。
// gbbq 加密占位记录与 full-acceptance 同源：训练创建会读取权息缓存，缺失直接 500。

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

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T00:00:00Z`)
  while (dates.length < count) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

async function createFixture(): Promise<{ root: string; dates: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-conditional-orders-'))
  const directory = join(root, 'vipdoc', 'sh', 'lday')
  await mkdir(directory, { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const dates = weekdayDates('2026-07-01', 45)
  await writeFile(join(directory, 'sh600000.day'), Buffer.concat(dates.map((date, index) => dayRecord(
    Number(date.replaceAll('-', '')),
    10 + index * 0.1 - 0.05,
    10 + index * 0.1 + 0.1,
    10 + index * 0.1 - 0.1,
    10 + index * 0.1,
    (10 + index * 0.1) * 1_000_000,
    1_000_000,
  ))))
  const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
  gbbq.writeUInt32LE(1, 0)
  encryptedGbbqRecord.copy(gbbq, 4)
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)
  return { root, dates }
}

async function withApp(run: (context: { app: Fastify.FastifyInstance; database: DatabaseSync; dates: string[] }) => Promise<void>): Promise<void> {
  const { root, dates } = await createFixture()
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  await registerApi(app, config, database)
  try {
    await run({ app, database, dates })
  } finally {
    await app.close()
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function createTraining(app: Fastify.FastifyInstance, dates: string[], payload: Record<string, unknown> = {}): Promise<number> {
  const created = await app.inject({
    method: 'POST', url: '/api/trainings',
    payload: { tier: '1M', code: '600000', start_date: dates[0], initial_cash: 1_000_000, orders_enabled: true, clock_mode: 'open_close', ...payload },
  })
  expect(created.statusCode).toBe(201)
  return created.json().training.id
}

type OrderJson = {
  id: number
  side: 'buy' | 'sell'
  orderType: 'limit' | 'stop'
  triggerDirection: 'up' | 'down' | null
  triggerPrice: number
  shares: number
  status: 'pending' | 'filled' | 'cancelled' | 'expired' | 'rejected'
  statusReason: string | null
}

describe('conditional orders: reach-to-trigger semantics (V1.2.5)', () => {
  it('keeps an above-market buy limit pending until the price actually reaches the trigger, then fills at the trigger price', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates)
      // 用户场景回归：市价 9.95 时挂买入限价 10.25（高于市价）——旧语义下一推进就成交，新语义必须等待上触
      const placed = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.25, shares: 500, reason: '突破买入' } })
      expect(placed.statusCode).toBe(201)
      expect(placed.json().order).toMatchObject({ triggerDirection: 'up', status: 'pending' })

      // day0 close（high 10.1 < 10.25）、day1 open（10.05）、day1 close（high 10.2 < 10.25）、day2 open（10.15）都不到价
      for (let step = 0; step < 4; step++) {
        const advanced = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
        expect(advanced.statusCode).toBe(200)
        expect(advanced.json().snapshot.orders.find((order: OrderJson) => order.id === placed.json().order.id)).toMatchObject({ status: 'pending' })
      }
      // day2 close：high 10.3 ≥ 10.25 → 到价，限价按触发价成交
      const filled = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(filled.statusCode).toBe(200)
      const order = filled.json().snapshot.orders.find((item: OrderJson) => item.id === placed.json().order.id)
      expect(order).toMatchObject({ status: 'filled', filledPhase: 'close' })
      expect(filled.json().snapshot.trades.at(-1)).toMatchObject({ side: 'buy', shares: 500, price: 10.25, executionType: 'conditional' })
    })
  })

  it('freezes trigger direction at placement: below-market buy limit waits for the dip and fills at the trigger', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates)
      // 市价 9.95 挂买入限价 9.85（低于市价）→ 'down'：等待回落到 9.85，趋势上行的夹具不会触发
      const placed = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 9.85, shares: 300 } })
      expect(placed.statusCode).toBe(201)
      expect(placed.json().order).toMatchObject({ triggerDirection: 'down', status: 'pending' })
      for (let step = 0; step < 6; step++) {
        const advanced = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
        expect(advanced.statusCode).toBe(200)
        expect(advanced.json().snapshot.orders.find((order: OrderJson) => order.id === placed.json().order.id)).toMatchObject({ status: 'pending' })
      }
    })
  })

  it('fills stops at market price (close in-session) while limits fill at trigger and survive adverse gap opens', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates)
      // 买入止损 10.11（'up'）：day0 close high 10.1 < 10.11 不触发；day1 盘中到价 → 按当日收盘价 10.1 成交（市价口径）
      const stop = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'stop', trigger_price: 10.11, shares: 400 } })
      expect(stop.statusCode).toBe(201)
      // 买入限价 10.12（'up'）：day1 盘中到价且当日 low 10.0 ≤ 10.12 → 按触发价 10.12 成交
      const limit = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.12, shares: 400 } })
      expect(limit.statusCode).toBe(201)
      const day0Close = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day0Close.statusCode).toBe(200)
      expect(day0Close.json().snapshot.orders).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'pending' }), expect.objectContaining({ status: 'pending' })]),
      )
      const day1Open = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day1Open.statusCode).toBe(200)
      expect(day1Open.json().snapshot.orders.find((order: OrderJson) => order.id === stop.json().order.id)).toMatchObject({ status: 'pending' })
      const day1Close = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day1Close.statusCode).toBe(200)
      expect(day1Close.json().snapshot.orders.find((order: OrderJson) => order.id === stop.json().order.id)).toMatchObject({ status: 'filled', filledPhase: 'close' })
      expect(day1Close.json().snapshot.orders.find((order: OrderJson) => order.id === limit.json().order.id)).toMatchObject({ status: 'filled', filledPhase: 'close' })
      const day1Trades = day1Close.json().snapshot.trades.filter((trade: { executionType: string }) => trade.executionType === 'conditional').map((trade: { price: number }) => trade.price)
      expect(day1Trades.sort((a: number, b: number) => a - b)).toEqual([10.1, 10.12])

      // 跳空保护：day1 收盘（市价 10.1）挂买入限价 10.12（'up'）——day2 跳空高开 10.15 越过触发价，
      // 开盘判定触发但限价不可成交（10.15 > 10.12）→ 不按 10.15 吃单；day2 盘中 low 10.1 ≤ 10.12 → 按触发价 10.12 成交
      const gapLimit = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.12, shares: 100 } })
      expect(gapLimit.statusCode).toBe(201)
      const day2Open = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day2Open.statusCode).toBe(200)
      expect(day2Open.json().snapshot.orders.find((order: OrderJson) => order.id === gapLimit.json().order.id)).toMatchObject({ status: 'pending' })
      const day2Close = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day2Close.statusCode).toBe(200)
      expect(day2Close.json().snapshot.orders.find((order: OrderJson) => order.id === gapLimit.json().order.id)).toMatchObject({ status: 'filled', filledPhase: 'close' })
      expect(day2Close.json().snapshot.trades.at(-1)).toMatchObject({ price: 10.12, shares: 100 })
    })
  })

  it('keeps multiple pending orders with cumulative reservation and cancels without releasing the reach-to-trigger semantics', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates)
      const buy = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 99_000 } })
      expect(buy.statusCode).toBe(200)
      expect(buy.json().plan).toMatchObject({ shares: 99_000, price: 9.95 })
      await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      // 收盘阶段（市价 10.0）挂两笔上触限价买单：各占 5,125，合计 10,250 ≤ 14,950 → 同时 pending
      const first = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.25, shares: 500, reason: '回踩接针' } })
      expect(first.statusCode).toBe(201)
      expect(first.json().order.triggerDirection).toBe('up')
      const second = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.25, shares: 500 } })
      expect(second.statusCode).toBe(201)
      const third = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.25, shares: 500 } })
      expect(third.statusCode).toBe(400)
      expect(third.json().error).toContain('剩余可用资金')
      const cancel = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders/${first.json().order.id}/cancel` })
      expect(cancel.statusCode).toBe(200)
      const again = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'limit', trigger_price: 10.25, shares: 500 } })
      expect(again.statusCode).toBe(201)
      // day1 open（10.15 之前）不到价：两笔都保持 pending——多挂单不提前成交
      const day1Open = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day1Open.statusCode).toBe(200)
      expect(day1Open.json().snapshot.orders.filter((order: OrderJson) => order.status === 'pending')).toHaveLength(2)
      const day1Close = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day1Close.statusCode).toBe(200)
      expect(day1Close.json().snapshot.orders.filter((order: OrderJson) => order.status === 'pending')).toHaveLength(2)
      // day2 close（high 10.3 ≥ 10.25）：两笔先后按触发价成交（占用校验与成交一致）
      const day2Open = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day2Open.statusCode).toBe(200)
      expect(day2Open.json().snapshot.orders.filter((order: OrderJson) => order.status === 'pending')).toHaveLength(2)
      const day2Close = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day2Close.statusCode).toBe(200)
      expect(day2Close.json().snapshot.orders.filter((order: OrderJson) => order.status === 'filled')).toHaveLength(2)
      expect(day2Close.json().snapshot.trades.filter((trade: { executionType: string }) => trade.executionType === 'conditional').map((trade: { price: number }) => trade.price)).toEqual([10.25, 10.25])
    })
  })

  it('reserves sellable shares across pending sell orders and fills several conditional sells at the trigger', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates, { clock_mode: 'close_only' })
      const buy = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 300 } })
      expect(buy.statusCode).toBe(200)
      await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      const first = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'sell', order_type: 'limit', trigger_price: 10.5, shares: 200 } })
      expect(first.statusCode).toBe(201)
      expect(first.json().order.triggerDirection).toBe('up')
      const overCommit = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'sell', order_type: 'limit', trigger_price: 10.5, shares: 200 } })
      expect(overCommit.statusCode).toBe(400)
      expect(overCommit.json().error).toContain('已挂卖出 200 股')
      const second = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'sell', order_type: 'limit', trigger_price: 10.5, shares: 100, reason: '分批减仓' } })
      expect(second.statusCode).toBe(201)
      let snapshot: { orders: OrderJson[]; trades: Array<{ executionType: string; shares: number }> } | null = null
      for (let advanced = 0; advanced < 8; advanced++) {
        const response = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
        expect(response.statusCode).toBe(200)
        snapshot = response.json().snapshot
        if (snapshot.orders.filter((order: OrderJson) => order.status === 'filled').length === 2) break
      }
      expect(snapshot!.orders.filter((order: OrderJson) => order.status === 'filled')).toHaveLength(2)
      expect(snapshot!.trades.filter((trade: { executionType: string }) => trade.executionType === 'conditional').map((trade: { shares: number }) => trade.shares)).toEqual([200, 100])
    })
  })

  it('buys by explicit share count at market and rejects unaffordable or non-lot sizes', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates)
      const nonLot = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 150 } })
      expect(nonLot.statusCode).toBe(400)
      expect(nonLot.json().error).toContain('一手')
      const unaffordable = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 200_000 } })
      expect(unaffordable.statusCode).toBe(400)
      expect(unaffordable.json().error).toContain('可用资金不足')
      const ok = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 100 } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().plan).toMatchObject({ side: 'buy', shares: 100, price: 9.95 })
      const both = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 200, weightPct: 100 } })
      expect(both.statusCode).toBe(200)
      expect(both.json().plan).toMatchObject({ shares: 200 })
    })
  })

  it('migrates legacy rows without trigger_direction by deriving the classic matrix', async () => {
    await withApp(async ({ app, database, dates }) => {
      const id = await createTraining(app, dates)
      await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      // 直插入一条旧行（无 trigger_direction）：经典矩阵 buy limit → 'down'。day1 open 10.05 ≤ 10.15
      // → 开盘判定触发且限价可成交 → 按更优的开盘价 10.05 成交（经典限价跳空改善）
      database.prepare(`INSERT INTO orders (training_id, side, order_type, trigger_price_raw, shares, status, created_date, created_phase, created_at)
        VALUES (?, 'buy', 'limit', 10.15, 100, 'pending', ?, 'close', ?)`).run(id, dates[1], new Date().toISOString())
      const day1Open = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(day1Open.statusCode).toBe(200)
      const legacy = day1Open.json().snapshot.orders.find((order: OrderJson) => order.triggerDirection === null)
      expect(legacy).toMatchObject({ status: 'filled', filledPhase: 'open' })
      expect(day1Open.json().snapshot.trades.at(-1)).toMatchObject({ price: 10.05, shares: 100 })
    })
  })
})
