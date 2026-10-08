import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { backfillTrainingRules, migrateDatabase } from '../src/db.js'
import { applyPositionEvents, tradeTraining, trainingSnapshot } from '../src/train/engine.js'
import type { AccountState } from '../src/train/account.js'
import type { AppConfig } from '../src/config.js'

// RF-01 回归（用户验收 2026-10-08：持仓 99456.00128173828 股、卖出被误报无可卖）。
// 独立 oracle（A 股交易事实）：股数恒为整数——买入一手整数倍、卖出零股也是整数股，
// 送转/配股到账股数取整（零股舍去）；可卖 = 持仓 − 冻结，为非负整数；可卖 > 0 时
// 合法卖出不得被拒为无可卖。
// 根因链路：gbbq 以 float32 存每 10 股送转/配股比例（如 2.2 存为 2.2000000476837158），
// applyPositionEvents 把 比例/10 × 持仓 的浮点乘积直接入账，尾巴进入 shares；
// planSell 的 Number.isInteger(availableShares) 判非整数 → 误报 当前没有可卖持仓。
// 夹具种子值与 gbbq 解码逐位一致（Math.fround(2.2)），预置 adj_factors 并把
// cache_meta 指纹对齐 fixture 文件，使 ensureCaches 短路、种子行在推进间存活。

const encryptedGbbqRecord = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')

function dayRecord(date: number, open: number, high: number, low: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(high * 100), 8)
  buffer.writeInt32LE(Math.round(low * 100), 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(close * 1_000_000, 20)
  buffer.writeInt32LE(1_000_000, 24)
  return buffer
}

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T00:00:00Z`)
  while (dates.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

async function withApp(run: (context: { app: Fastify.FastifyInstance; database: DatabaseSync; root: string; dates: string[] }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-rf01-float-'))
  const directory = join(root, 'vipdoc', 'sh', 'lday')
  await mkdir(directory, { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const dates = weekdayDates('2026-07-01', 12)
  await writeFile(join(directory, 'sh600000.day'), Buffer.concat(dates.map((date, index) => dayRecord(
    Number(date.replaceAll('-', '')),
    10 + index * 0.1 - 0.05,
    10 + index * 0.1 + 0.1,
    10 + index * 0.1 - 0.1,
    10 + index * 0.1,
  ))))
  const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
  gbbq.writeUInt32LE(1, 0)
  encryptedGbbqRecord.copy(gbbq, 4)
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  await registerApi(app, config, database)
  try {
    await run({ app, database, root, dates })
  } finally {
    await app.close()
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}

// 预置一笔 float32 送转比例权息事件（10 送 2.2，gbbq 解码值即 Math.fround(2.2)），
// 并把 cache_meta 指纹对齐 fixture 文件，让后续 ensureCaches 短路、种子行不被刷新删除。
function seedFloat32BonusEvent(database: DatabaseSync, root: string, date: string): void {
  database.prepare(`
    INSERT INTO adj_factors (market, code, date, dividend, rights_price, bonus_shares, rights_shares, m, c)
    VALUES ('sh', '600000', ?, 0, 0, ?, 0, 1.22, 0)
    ON CONFLICT(market, code, date) DO UPDATE SET bonus_shares = excluded.bonus_shares
  `).run(date, Math.fround(2.2))
  const info = statSync(join(root, 'T0002', 'hq_cache', 'gbbq'))
  database.prepare(`
    INSERT INTO cache_meta (key, value) VALUES ('gbbq_fingerprint', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`${info.size}:${info.mtime.toISOString()}`)
}

// 内存库直插训练行（沿用 rights-cost-basis.test.ts 的夹具口径）：
// 持股 shares @10 元，现金 = initialCash − 持仓成本；current_date 为买入次日之后，T+1 不冻结。
function holdingWithShares(database: DatabaseSync, shares: number, initialCash = 1_000_000) {
  database.prepare(`
    INSERT INTO trainings (
      id, tier, code, name, market, start_date, planned_end, status,
      initial_cash, created_at, current_date, current_close
    ) VALUES (1, '1Y', '600000', 'Fixture', 'sh', '2026-04-18', '2027-04-18',
      'running', ?, '2026-04-18T00:00:00Z', '2026-04-22', 10)
  `).run(initialCash)
  backfillTrainingRules(database)
  const cost = shares * 10
  database.prepare(`
    INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount,
      fee, cash_after, shares_after, cost_after)
    VALUES (1, 1, '2026-04-20', 'buy', 10, ?, ?, 0, ?, ?, ?)
  `).run(shares, cost, initialCash - cost, shares, cost)
  const row = database.prepare('SELECT * FROM trainings WHERE id = 1').get() as unknown as Parameters<typeof applyPositionEvents>[1]
  const state: AccountState = { cash: initialCash - cost, shares, costTotal: cost }
  return { row, state }
}

describe('RF-01 float share tails block selling', () => {
  it('credits a float32 bonus rate as whole shares and keeps snapshot fields integer with full exit succeeding', async () => {
    await withApp(async ({ app, database, root, dates }) => {
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { tier: '1M', code: '600000', start_date: dates[0], initial_cash: 1_000_000 },
      })
      expect(created.statusCode).toBe(201)
      const id = created.json().training.id
      const bought = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'buy', shares: 75_000 } })
      expect(bought.statusCode).toBe(200)
      expect(bought.json().plan.shares).toBe(75_000)

      // 10 送 2.2（float32 比例）落在 dates[2]：推进两天跨过除权日入账
      seedFloat32BonusEvent(database, root, dates[2])
      await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      const crossed = await app.inject({ method: 'POST', url: `/api/trainings/${id}/next` })
      expect(crossed.statusCode).toBe(200)

      const account = crossed.json().snapshot.account
      // oracle：任何时点的持仓/可卖都必须是整数股
      expect(Number.isInteger(account.shares)).toBe(true)
      expect(Number.isInteger(account.availableShares)).toBe(true)
      // 成交记录股数全部为整数
      for (const trade of crossed.json().snapshot.trades as Array<{ shares: number }>) {
        expect(Number.isInteger(trade.shares)).toBe(true)
      }
      // 10 送 2.2 全额入账：75000 + 16500 = 91500（整手信用按比例折算，无零股）
      expect(account.shares).toBe(91_500)
      expect(account.availableShares).toBe(91_500)

      // 用户现象：可卖 > 0 时整份卖出被误报无可卖——修复后必须成功
      const sold = await app.inject({ method: 'POST', url: `/api/trainings/${id}/trade`, payload: { side: 'sell', weightPct: 100 } })
      expect(sold.statusCode).toBe(200)
      expect(sold.json().plan.shares).toBe(91_500)
      expect(sold.json().snapshot.account.shares).toBe(0)
    })
  })

  it('books exactly the user-reported delta 59136.00128173828 as whole shares 59136 in the event ledger', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    // 用户截图算术：Math.fround(2.2)/10 × 268800 = 59136.00128173828（float32 比例噪声）
    const { row, state } = holdingWithShares(database, 268_800)
    const after = applyPositionEvents(database, row, state, '2026-04-22', [
      { date: '2026-04-22', dividend: 0, rightsPrice: 0, bonusShares: Math.fround(2.2), rightsShares: 0 },
    ])
    expect(after.shares).toBe(327_936)
    expect(Number.isInteger(after.shares)).toBe(true)
    const event = database.prepare('SELECT shares_delta FROM position_events').get() as unknown as { shares_delta: number }
    expect(Number.isInteger(event.shares_delta)).toBe(true)
    expect(event.shares_delta).toBe(59_136)
    database.close()
  })

  it('repairs a legacy fractional ledger row on replay and lets the full exit go through', async () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    // 复刻用户被卡死的训练账本：整数买入 40320 股 + 旧版本写入的浮点权息行
    // 40320 + 59136.00128173828 = 99456.00128173828（用户截图原值）
    const { row } = holdingWithShares(database, 40_320)
    database.prepare(`
      INSERT INTO position_events (training_id, seq, date, kind, shares_delta, cash_delta, cost_delta)
      VALUES (1, 1, '2026-04-21', 'corporate_action', 59136.00128173828, 0, 0)
    `).run()

    const snapshot = trainingSnapshot(database, row.id as number)
    expect(Number.isInteger(snapshot.account.shares)).toBe(true)
    expect(snapshot.account.shares).toBe(99_456)
    expect(Number.isInteger(snapshot.account.availableShares)).toBe(true)
    expect(snapshot.account.availableShares).toBe(99_456)

    // 用户现象：卖出被误报 当前没有可卖持仓——修复后整份清仓（显式股数＝可卖，允许零股）必须成功
    const sold = await tradeTraining(database, row.id as number, { side: 'sell', shares: 99_456 })
    expect(sold.plan.shares).toBe(99_456)
    expect(sold.snapshot.account.shares).toBe(0)
    database.close()
  })
})
