import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase, backfillTrainingRules } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import {
  HttpError, abandonTraining, advanceTraining, createTraining, ensureAdjustmentCache, equityCurveOf,
  previewTrainingRange, settleTraining, tradeTraining, trainingSnapshot,
} from '../src/train/engine.js'
import { readTrainingRulesFromDatabase } from '../src/train/rules.js'

// TRAIN-01：训练规则快照——创建冻结、旧局不漂移、损坏零副作用、legacy raw 拒绝、
// raw/forward 账户权息一致、推进 await 后状态重查。合成 TDX 夹具（临时目录），不触碰真实数据。

function dayRecord(date: number, open: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(close * 100) + 10, 8)
  buffer.writeInt32LE(Math.round(close * 100) - 10, 12)
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

async function createFixture(): Promise<{ root: string; dates: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-rules-'))
  const directory = join(root, 'vipdoc', 'sh', 'lday')
  await mkdir(directory, { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const dates = weekdayDates('2026-07-01', 32)
  const records = dates.map((date, index) => dayRecord(
    Number(date.replaceAll('-', '')),
    10 + index * 0.1 - 0.05,
    10 + index * 0.1,
  ))
  await writeFile(join(directory, 'sh600000.day'), Buffer.concat(records))
  // 空 gbbq（仅事件计数头）：测试用例按需直插 adj_factors 控制权息事件
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), Buffer.alloc(4))
  return { root, dates }
}

async function withFixture(run: (context: { database: DatabaseSync; config: AppConfig; dates: string[] }) => Promise<void>): Promise<void> {
  const { root, dates } = await createFixture()
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  try {
    await run({ database, config, dates })
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}

function setFlag(database: DatabaseSync, key: string, value: '0' | '1'): void {
  database.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function parsedRules(database: DatabaseSync, id: number): Record<string, unknown> {
  const raw = database.prepare('SELECT rules_json FROM trainings WHERE id = ?').get(id) as unknown as { rules_json: string }
  return JSON.parse(raw.rules_json) as Record<string, unknown>
}

describe('TRAINING-RULES：创建冻结与默认读取', () => {
  it('创建训练冻结规则：version 1、origin created、默认费用关 T+1 开、固定数值与提交时间', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      const rules = parsedRules(database, training.id)
      expect(rules).toMatchObject({
        version: 1,
        feesEnabled: false,
        tPlusOne: true,
        commissionRate: 0.00025,
        minimumCommission: 5,
        stampDutyRate: 0.0005,
        lotSize: 100,
        execution: 'same-day-raw-close',
        weightBasis: 'total-equity',
        corporateActionPolicy: 'cash-shares-v1',
        origin: 'created',
      })
      expect(typeof rules.capturedAt).toBe('string')
      expect(() => new Date(rules.capturedAt as string).toISOString()).not.toThrow()
      expect(training.rules?.version).toBe(1)
      expect(training.rules?.origin).toBe('created')
    })
  })

  it('默认在提交边界读取：等待期间更新的默认进入最终快照', async () => {
    await withFixture(async ({ database, config, dates }) => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const pending = createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0],
        beforeCommit: () => gate,
      })
      // 创建仍在异步准备中：等待期间更新默认设置
      setFlag(database, 'fees_enabled', '1')
      setFlag(database, 't1_enabled', '0')
      release()
      const training = await pending
      expect(training.rules).toMatchObject({ feesEnabled: true, tPlusOne: false, origin: 'created' })
    })
  })

  it('旧五档与 RANGE 范围训练都冻结规则（同一提交口径）', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const tierTraining = await createTraining(database, config, { tier: '3M', code: '600000', start_date: dates[0] })
      expect(parsedRules(database, tierTraining.id).origin).toBe('created')
      await settleTraining(database, tierTraining.id)

      // RANGE 真流程：预览 → 携带 previewId 创建，规则仍走 commitTrainingCreation 同段冻结
      const now = new Date('2026-09-01T08:00:00.000Z')
      const range = { mode: 'preset' as const, startDate: dates[0], months: 1 as const }
      const { preview } = await previewTrainingRange(database, config, { code: 'sh600000', range, now })
      const rangeTraining = await createTraining(database, config, {
        code: 'sh600000', range, previewId: preview.previewId, now,
      })
      expect(rangeTraining.tier).toBe('RANGE')
      expect(parsedRules(database, rangeTraining.id)).toMatchObject({ version: 1, origin: 'created', corporateActionPolicy: 'cash-shares-v1' })
    })
  })
})

describe('TRAINING-RULES：本局冻结不漂移', () => {
  it('A 局运行中修改全局默认：A 的费用/可卖数量/规则快照全部不变', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const trainingA = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      const bought = await tradeTraining(database, trainingA.id, { side: 'buy', weightPct: 50 })
      expect(bought.plan.fee).toBe(0)
      // T+1 冻结为开：当日可卖 0
      expect(bought.snapshot.account.availableShares).toBe(0)

      // 运行中改全局默认：费用开、T+1 关
      setFlag(database, 'fees_enabled', '1')
      setFlag(database, 't1_enabled', '0')

      const after = trainingSnapshot(database, trainingA.id)
      expect(after.account.availableShares).toBe(0)
      expect(after.training.rules).toMatchObject({ feesEnabled: false, tPlusOne: true })
      await expect(tradeTraining(database, trainingA.id, { side: 'sell', weightPct: 100 }))
        .rejects.toThrow(/没有可卖持仓/)
      // 费用冻结为关：跨日卖出仍无费用
      await advanceTraining(database, config, trainingA.id)
      const sold = await tradeTraining(database, trainingA.id, { side: 'sell', weightPct: 100 })
      expect(sold.plan.fee).toBe(0)
    })
  })

  it('结束 A 后创建 B：B 采用新默认，费用手算（50% 买入 500000 佣金 125）且当日可卖', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const trainingA = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      await settleTraining(database, trainingA.id)
      setFlag(database, 'fees_enabled', '1')
      setFlag(database, 't1_enabled', '0')

      const trainingB = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      expect(trainingB.rules).toMatchObject({ feesEnabled: true, tPlusOne: false })
      const bought = await tradeTraining(database, trainingB.id, { side: 'buy', weightPct: 50 })
      expect(bought.plan.shares).toBe(50_000)
      expect(bought.plan.amount).toBe(500_000)
      // 手算：max(5, 500000 × 0.00025) = 125
      expect(bought.plan.fee).toBeCloseTo(125, 10)
      // T+1 冻结为关：当日买入即可卖
      expect(bought.snapshot.account.availableShares).toBe(50_000)
      const sold = await tradeTraining(database, trainingB.id, { side: 'sell', shares: 50_000 })
      // 手算：卖 500000 → 佣金 125 + 印花税 250 = 375
      expect(sold.plan.fee).toBeCloseTo(375, 10)
    })
  })
})

describe('TRAINING-RULES：快照损坏零副作用', () => {
  it('rules_json 缺失或版本不支持：交易/推进/结算给出明确错误且零写入', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      for (const damage of [
        "UPDATE trainings SET rules_json = '{broken' WHERE id = ?",
        'UPDATE trainings SET rules_json = NULL WHERE id = ?',
        "UPDATE trainings SET rules_json = JSON_SET(rules_json, '$.version', 99) WHERE id = ?",
      ]) {
        database.prepare(damage).run(training.id)
        const curveBefore = equityCurveOf(database, training.id)
        const tradeError = await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 }).then(
          () => null, (error: unknown) => error,
        )
        expect(tradeError).toBeInstanceOf(HttpError)
        expect((tradeError as HttpError).statusCode).toBe(409)
        expect((tradeError as HttpError).code).toBe('TRAIN_RULES_UNREADABLE')
        expect((tradeError as Error).message).toContain('规则快照')
        await expect(advanceTraining(database, config, training.id)).rejects.toThrow(/规则快照/)
        expect(() => settleTraining(database, training.id)).toThrow(/规则快照/)
        expect(equityCurveOf(database, training.id)).toEqual(curveBefore)
        expect(database.prepare('SELECT COUNT(*) AS n FROM trades').get()).toEqual({ n: 0 })
      }
    })
  })

  it('快照读取器拒绝未知字段形状并保留原始字符串可诊断', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      database.prepare("UPDATE trainings SET rules_json = '{\"version\":1}' WHERE id = ?").run(training.id)
      expect(readTrainingRulesFromDatabase(database, training.id)).toBeNull()
      expect(parsedRules(database, training.id)).toEqual({ version: 1 })
    })
  })
})

describe('TRAINING-RULES：legacy raw 只读保护', () => {
  function insertLegacyTraining(database: DatabaseSync, adjustMode: 'raw' | 'forward'): number {
    const rules = {
      version: 1, feesEnabled: false, tPlusOne: true,
      commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100,
      execution: 'same-day-raw-close', weightBasis: 'total-equity',
      corporateActionPolicy: adjustMode === 'raw' ? 'legacy-raw-unverified' : 'cash-shares-v1',
      capturedAt: '2026-09-28T00:00:00.000Z', origin: 'legacy-migration',
    }
    const result = database.prepare(`
      INSERT INTO trainings (
        tier, code, name, market, start_date, planned_end, status, blind,
        adjust_mode, initial_cash, created_at, current_date, current_close, rules_json
      ) VALUES ('1M', '600000', '旧训练', 'sh', '2026-07-01', '2026-08-01', 'running', 0,
        ?, 1000000, '2026-06-01T00:00:00.000Z', '2026-07-01', 10, ?)
    `).run(adjustMode, JSON.stringify(rules))
    return Number(result.lastInsertRowid)
  }

  it('legacy raw 运行中：交易/推进/结算拒绝 409 LEGACY_RAW_ACCOUNTING_UNVERIFIED，可放弃，快照可读', async () => {
    await withFixture(async ({ database, config }) => {
      const id = insertLegacyTraining(database, 'raw')
      const legacyError = new HttpError(409, '旧版不复权训练缺少完整权息记录，请保留记录后新建训练', 'LEGACY_RAW_ACCOUNTING_UNVERIFIED')
      await expect(tradeTraining(database, id, { side: 'buy', weightPct: 50 })).rejects.toThrow(legacyError)
      await expect(advanceTraining(database, config, id)).rejects.toThrow(legacyError)
      const settleTrainingLegacy = () => settleTraining(database, id)
      expect(settleTrainingLegacy).toThrow(legacyError)
      // 查看不受限
      expect(trainingSnapshot(database, id).training.rules?.corporateActionPolicy).toBe('legacy-raw-unverified')
      const abandoned = abandonTraining(database, id)
      expect(abandoned.status).toBe('abandoned')
    })
  })

  it('legacy forward 沿迁移冻结规则继续推进并入账权息；已结束 legacy raw 只读不拒绝查看', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const id = insertLegacyTraining(database, 'forward')
      database.prepare(`
        INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after)
        VALUES (?, 1, '2026-07-01', 'buy', 10, 10000, 100000, 0, 900000, 10000, 100000)
      `).run(id)
      // 先预训权息缓存（空 gbbq 指纹落定），再直插测试事件，避免首次刷新把测试行清掉
      await ensureAdjustmentCache(database, config)
      // 直插权息：每 10 股派 8、送 1（分红 8000 现金、送 1000 股）
      database.prepare(`
        INSERT INTO adj_factors (market, code, date, dividend, rights_price, bonus_shares, rights_shares, m, c)
        VALUES ('sh', '600000', ?, 8, 0, 1, 0, 1, -0.8)
      `).run(dates[3])
      const advanced = await advanceTraining(database, config, id)
      expect(advanced.snapshot.training.currentDate).toBe(dates[1])
      // 推进到权息日后账户应含分红与送转（raw/forward 同口径的 forward 侧证据）
      let sawEvent = false
      let latest = advanced.snapshot
      for (let index = 0; index < 5 && !sawEvent; index += 1) {
        latest = (await advanceTraining(database, config, id)).snapshot
        sawEvent = latest.account.shares > 10_000
      }
      expect(sawEvent).toBe(true)
      expect(latest.account.cash).toBeGreaterThan(900_000)

      const finishedRaw = insertLegacyTraining(database, 'raw')
      database.prepare("UPDATE trainings SET status = 'settled', settle_date = '2026-07-01' WHERE id = ?").run(finishedRaw)
      expect(trainingSnapshot(database, finishedRaw).training.status).toBe('settled')
      await expect(tradeTraining(database, finishedRaw, { side: 'buy', weightPct: 50 })).rejects.toThrow(HttpError)
    })
  })
})

describe('TRAINING-RULES：新训练 raw/forward 权息一致', () => {
  interface Step { date: string; cash: number; shares: number; costPrice: number | null; equity: number }
  async function runScenario(database: DatabaseSync, config: AppConfig, adjustMode: 'raw' | 'forward', dates: string[], rightsSharesPer10: number): Promise<Step[]> {
    const training = await createTraining(database, config, {
      tier: '1M', code: '600000', start_date: dates[0], adjust_mode: adjustMode,
    })
    await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 })
    // 同库两次场景：先清掉上一场景的事件再插入本场景事件
    database.prepare('DELETE FROM adj_factors').run()
    database.prepare(`
      INSERT INTO adj_factors (market, code, date, dividend, rights_price, bonus_shares, rights_shares, m, c)
      VALUES ('sh', '600000', ?, 8, 5, 1, ?, 1, -0.8)
    `).run(dates[3], rightsSharesPer10)
    const steps: Step[] = []
    for (let index = 0; index < 8; index += 1) {
      const advanced = await advanceTraining(database, config, training.id)
      const account = advanced.snapshot.account
      steps.push({
        date: advanced.snapshot.training.currentDate ?? '',
        cash: account.cash, shares: account.shares,
        costPrice: account.costPrice, equity: account.equity,
      })
    }
    await settleTraining(database, training.id)
    return steps
  }

  it('同一合成行情：分红/送转/足额配股后 raw 与 forward 的 cash/shares/cost/equity 逐项一致', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const forward = await runScenario(database, config, 'forward', dates, 3)
      const raw = await runScenario(database, config, 'raw', dates, 3)
      expect(raw).toEqual(forward)
      // 权息确实入账：持股增加、现金含分红（排除两边都零入账的假一致）
      const eventStep = forward.find(step => step.shares > 50_000)
      expect(eventStep).toBeTruthy()
      expect(eventStep!.cash).toBeGreaterThan(400_000)
    })
  })

  it('现金不足放弃配股：raw 与 forward 同样放弃，账户一致', async () => {
    await withFixture(async ({ database, config, dates }) => {
      // 每股配 3 股 @5 → 50000 股需缴 75000，现金+分红不足时放弃
      const forward = await runScenario(database, config, 'forward', dates, 30)
      const raw = await runScenario(database, config, 'raw', dates, 30)
      expect(raw).toEqual(forward)
    })
  })
})

describe('TRAINING-RULES：推进 await 后状态重查', () => {
  it('等待期间训练被结算：409 TRAIN_STATE_CHANGED 零写入', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 })
      const curveBefore = equityCurveOf(database, training.id)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      // advance 同步捕获观测后停在 gate 上；此时另一个操作把训练结算掉
      const pending = advanceTraining(database, config, training.id, { afterObserve: () => gate })
      settleTraining(database, training.id)
      release()
      await expect(pending).rejects.toThrow(new HttpError(409, '训练状态已变化（可能已在其他操作中推进或结束），请刷新后重试', 'TRAIN_STATE_CHANGED'))
      // 零写入：结算操作是唯一变更，推进没有额外落库
      expect(trainingSnapshot(database, training.id).training.status).toBe('settled')
      expect(equityCurveOf(database, training.id).map(point => point.date)).toEqual(curveBefore.map(point => point.date))
    })
  })

  it('等待期间训练被推进：409 TRAIN_STATE_CHANGED，不重复对同一天入账', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const pending = advanceTraining(database, config, training.id, { afterObserve: () => gate })
      const first = await advanceTraining(database, config, training.id)
      release()
      await expect(pending).rejects.toThrow(/TRAIN_STATE_CHANGED|训练状态已变化/)
      const curve = equityCurveOf(database, training.id)
      expect(curve.map(point => point.date)).toEqual([dates[0], dates[1]])
      expect(first.snapshot.training.currentDate).toBe(dates[1])
    })
  })

  it('等待期间合法成交先完成：推进读取最新余额入账', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 })
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const pending = advanceTraining(database, config, training.id, { afterObserve: () => gate })
      const extra = await tradeTraining(database, training.id, { side: 'buy', weightPct: 10 })
      release()
      const advanced = await pending
      expect(advanced.snapshot.account.cash).toBeCloseTo(extra.snapshot.account.cash, 10)
      const lastPoint = equityCurveOf(database, training.id).at(-1)
      expect(lastPoint?.date).toBe(dates[1])
    })
  })
})

describe('TRAINING-RULES：迁移回填夹具辅助', () => {
  it('backfillTrainingRules 对 NULL 行按当前设置一次性冻结且幂等', async () => {
    const database = new DatabaseSync(':memory:')
    try {
      migrateDatabase(database)
      database.prepare(`
        INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, blind,
          adjust_mode, initial_cash, created_at, current_date, current_close)
        VALUES ('1M', '600000', '夹具', 'sh', '2026-07-01', '2026-08-01', 'running', 0,
          'raw', 1000000, '2026-06-01T00:00:00.000Z', '2026-07-01', 10)
      `).run()
      setFlag(database, 'fees_enabled', '1')
      backfillTrainingRules(database)
      const first = parsedRules(database, 1)
      expect(first).toMatchObject({ feesEnabled: true, tPlusOne: true, origin: 'legacy-migration', corporateActionPolicy: 'legacy-raw-unverified' })
      setFlag(database, 'fees_enabled', '0')
      backfillTrainingRules(database)
      expect(parsedRules(database, 1)).toEqual(first)
    } finally {
      database.close()
    }
  })
})

describe('TRAINING-RULES 限定返修 F1：快照数值驱动执行（control-handoff-20260928-44）', () => {
  function overwriteRules(database: DatabaseSync, id: number, patch: Record<string, unknown>): void {
    const rules = { ...parsedRules(database, id), ...patch }
    database.prepare('UPDATE trainings SET rules_json = ? WHERE id = ?').run(JSON.stringify(rules), id)
  }

  it('解析器认可的佣金/最低佣金/印花税率由同一快照驱动费用计算（非全局常量）', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: 100_000,
      })
      overwriteRules(database, training.id, {
        feesEnabled: true, tPlusOne: false,
        commissionRate: 0.001, minimumCommission: 10, stampDutyRate: 0.002,
      })
      const bought = await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 })
      // 手算：权益 100000×50% = 50000 → 5000 股 @10；佣金 max(10, 50000×0.001)=50（旧常量会算 12.5）
      expect(bought.plan.shares).toBe(5000)
      expect(bought.plan.fee).toBeCloseTo(50, 10)
      const sold = await tradeTraining(database, training.id, { side: 'sell', shares: 5000 })
      // 手算：金额 50000 → 佣金 50 + 印花税 50000×0.002=100 → 合计 150
      expect(sold.plan.fee).toBeCloseTo(150, 10)
    })
  })

  it('解析器认可的 lotSize 由同一快照驱动整手取整', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: 99_000,
      })
      overwriteRules(database, training.id, { lotSize: 200 })
      const bought = await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 })
      // 手算：权益 99000×50% = 49500 → 4950 股 → 200 一手取 24 手 = 4800（常量 100 会给 4900）
      expect(bought.plan.shares).toBe(4800)
    })
  })

  for (const patch of [
    { commissionRate: -1 },
    { minimumCommission: -5 },
    { stampDutyRate: -1 },
    { commissionRate: 2 },
    { lotSize: 0 },
    { lotSize: 1.5 },
    { capturedAt: 'definitely-not-a-date' },
  ]) {
    it(`支持域之外的快照数值拒绝交易并零写（${JSON.stringify(patch)}）`, async () => {
      await withFixture(async ({ database, config, dates }) => {
        const training = await createTraining(database, config, {
          tier: '1M', code: '600000', start_date: dates[0], initial_cash: 100_000,
        })
        overwriteRules(database, training.id, patch)
        const curveBefore = equityCurveOf(database, training.id)
        const caught = await tradeTraining(database, training.id, { side: 'buy', weightPct: 50 }).then(
          () => null, (error: unknown) => error,
        )
        expect(caught).toBeInstanceOf(HttpError)
        expect((caught as HttpError).statusCode).toBe(409)
        expect((caught as HttpError).code).toBe('TRAIN_RULES_UNREADABLE')
        expect(equityCurveOf(database, training.id)).toEqual(curveBefore)
        expect(database.prepare('SELECT COUNT(*) AS n FROM trades').get()).toEqual({ n: 0 })
      })
    })
  }
})
