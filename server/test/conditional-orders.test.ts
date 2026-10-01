import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'

// V1.2.3 用户反馈返修：条件单多挂单支持。夹具日线沿 fixture 惯例线性上行：
// 第 i 个交易日 open=10+0.1i-0.05，high=+0.1，low=-0.1，close=10+0.1i；费用默认关闭、T+1 默认开启。
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

async function withApp(run: (context: { app: Fastify.FastifyInstance; dates: string[] }) => Promise<void>): Promise<void> {
  const { root, dates } = await createFixture()
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  await registerApi(app, config, database)
  try {
    await run({ app, dates })
  } finally {
    await app.close()
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function createTraining(app: Fastify.FastifyInstance, dates: string[], payload: Record<string, unknown>): Promise<number> {
  const created = await app.inject({
    method: 'POST', url: '/api/trainings',
    payload: { tier: '1M', code: '600000', start_date: dates[0], initial_cash: 1_000_000, orders_enabled: true, ...payload },
  })
  expect(created.statusCode).toBe(201)
  return created.json().training.id
}

describe('conditional orders: multiple pending orders and shared sizing', () => {
  it('keeps several buy orders pending at once and rejects orders beyond the cash left after existing reservations', async ({ }) => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates, { clock_mode: 'open_close' })
      // 按股数市价买入：精确成交 99,500 股，把现金压到 9,975（990,025 已占用）
      const buy = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 99_500 } })
      expect(buy.statusCode).toBe(200)
      expect(buy.json().plan).toMatchObject({ side: 'buy', shares: 99_500, price: 9.95 })

      await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      // 收盘阶段挂两笔止损买单（下一日开盘阶段才首次评估，按开盘价 10.05 成交）：
      // 各占 4,975，合计 9,950 ≤ 9,975 → 两笔同时 pending
      const first = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'stop', trigger_price: 9.95, shares: 500, reason: '回踩接针' } })
      expect(first.statusCode).toBe(201)
      const second = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'stop', trigger_price: 9.95, shares: 500 } })
      expect(second.statusCode).toBe(201)
      // 第三笔再要 4,975，扣除在途占用后只剩 25 → 拒绝且原因可读
      const third = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'stop', trigger_price: 9.95, shares: 500 } })
      expect(third.statusCode).toBe(400)
      expect(third.json().error).toContain('剩余可用资金')
      expect(third.json().error).toContain('¥25.00')

      // 撤掉一笔后占用释放，可再挂
      const cancel = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders/${first.json().order.id}/cancel` })
      expect(cancel.statusCode).toBe(200)
      const again = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'buy', order_type: 'stop', trigger_price: 9.95, shares: 500 } })
      expect(again.statusCode).toBe(201)

      // 推进到次日开盘：两笔都触发，先成交的吃掉现金后，第二笔按开盘价计算资金不足 → 拒绝入账
      const next = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(next.statusCode).toBe(200)
      const orders = next.json().snapshot.orders
      const filled = orders.filter((order: { status: string }) => order.status === 'filled')
      const rejected = orders.find((order: { status: string }) => order.status === 'rejected')
      expect(filled).toHaveLength(1)
      expect(filled[0]).toMatchObject({ filledPhase: 'open', shares: 500 })
      expect(rejected?.statusReason).toContain('可用资金不足')
      const conditionalTrades = next.json().snapshot.trades.filter((trade: { executionType: string }) => trade.executionType === 'conditional')
      expect(conditionalTrades).toHaveLength(1)
      expect(conditionalTrades[0]).toMatchObject({ side: 'buy', shares: 500, price: 10.05 })
    })
  })

  it('reserves sellable shares across pending sell orders and fills several conditional sells in the same bar', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates, {})
      const buy = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 300 } })
      expect(buy.statusCode).toBe(200)
      // T+1：当日买入不可卖，挂单也要等到下一交易日才有可卖基数
      await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })

      const first = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'sell', order_type: 'limit', trigger_price: 10.5, shares: 200 } })
      expect(first.statusCode).toBe(201)
      const overCommit = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'sell', order_type: 'limit', trigger_price: 10.5, shares: 200 } })
      expect(overCommit.statusCode).toBe(400)
      expect(overCommit.json().error).toContain('已挂卖出 200 股')
      const second = await app.inject({ method: 'POST', url: `/api/trainings/${id}/orders`, payload: { side: 'sell', order_type: 'limit', trigger_price: 10.5, shares: 100, reason: '分批减仓' } })
      expect(second.statusCode).toBe(201)

      // 第 4 个交易日 high=10.5 触发两笔限价卖单：同一天先后成交，可卖股数恰好覆盖
      let snapshot: { orders: Array<{ id: number; status: string; filledPhase: string | null }>; trades: Array<{ executionType: string; shares: number }> }
      for (let advanced = 0; advanced < 8; advanced++) {
        const response = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
        expect(response.statusCode).toBe(200)
        snapshot = response.json().snapshot
        if (snapshot.orders.filter((order: { status: string }) => order.status === 'filled').length === 2) break
      }
      expect(snapshot!.orders.filter((order: { status: string }) => order.status === 'filled')).toHaveLength(2)
      expect(snapshot!.trades.filter((trade: { executionType: string }) => trade.executionType === 'conditional').map((trade: { shares: number }) => trade.shares)).toEqual([200, 100])
    })
  })

  it('buys by explicit share count at market and rejects unaffordable or non-lot sizes', async () => {
    await withApp(async ({ app, dates }) => {
      const id = await createTraining(app, dates, { clock_mode: 'open_close' })
      const nonLot = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 150 } })
      expect(nonLot.statusCode).toBe(400)
      expect(nonLot.json().error).toContain('一手')
      const unaffordable = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 200_000 } })
      expect(unaffordable.statusCode).toBe(400)
      expect(unaffordable.json().error).toContain('可用资金不足')
      const ok = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 100 } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().plan).toMatchObject({ side: 'buy', shares: 100, price: 9.95 })
      // 显式股数优先于比例：两者同时给出时按股数执行
      const both = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 200, weightPct: 100 } })
      expect(both.statusCode).toBe(200)
      expect(both.json().plan).toMatchObject({ shares: 200 })
    })
  })
})
