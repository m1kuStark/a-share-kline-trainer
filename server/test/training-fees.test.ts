import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import { observedDefaultRules, parseTrainingRules, serializeTrainingRules } from '../src/train/rules.js'
import { commitTrainingCreation } from '../src/train/engine.js'
import { buyCommission, planBuyShares, planSell, sellFee, initialAccountState, type FeeConfig } from '../src/train/account.js'
import { DEFAULT_FEE_DEFAULTS, FEE_SETTING_KEYS, readFeeDefaults } from '../src/settings/fee-defaults.js'

// TRAIN-FEE-01（Issue #8-A，用户 2026-11-07 拍板）：训练默认费率可配置。
// oracle 独立性：费用期望全部按「金额 × 比率 / 最低佣金 / 四舍五入到分」手算，不读实现常量；
// 快照冻结期望来自 PUT 后读回 settings 值，不反推 observedDefaultRules 输出。
vi.setConfig({ testTimeout: 20_000 })

async function createApp() {
  const root = await mkdtemp(join(tmpdir(), 'training-fees-'))
  const databasePath = join(root, 'trainer.sqlite')
  const database = new DatabaseSync(databasePath)
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath, tdxRoot: null }
  await registerApi(app, config, database)
  return { app, database, root, databasePath }
}

async function closeApp(context: Awaited<ReturnType<typeof createApp>>) {
  await context.app.close()
  context.database.close()
  await rm(context.root, { recursive: true, force: true })
}

function storedFeeSettings(database: DatabaseSync): Record<string, string> {
  const rows = database.prepare(`SELECT key, value FROM settings WHERE key IN (?, ?, ?)`).all(
    FEE_SETTING_KEYS.commission, FEE_SETTING_KEYS.minimum, FEE_SETTING_KEYS.stamp,
  ) as unknown as Array<{ key: string; value: string }>
  return Object.fromEntries(rows.map(row => [row.key, row.value]))
}

const fullBody = {
  feesEnabled: true,
  tPlusOne: false,
  initialCash: 500_000,
  adjustMode: 'raw',
  commissionRate: 0.0001,
  minimumCommission: 0,
  stampDutyRate: 0.0005,
}

describe('TRAIN-FEE-01 可配置费率：默认设置、校验与快照冻结', () => {
  it('GET 缺键时沿用既有默认口径（佣金万 2.5/最低 5 元/印花万 5）', async () => {
    const context = await createApp()
    try {
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        commissionRate: DEFAULT_FEE_DEFAULTS.commissionRate,
        minimumCommission: DEFAULT_FEE_DEFAULTS.minimumCommission,
        stampDutyRate: DEFAULT_FEE_DEFAULTS.stampDutyRate,
      })
      // 默认值＝既有 account.ts 口径（万 2.5、5 元、万 5）
      expect(response.json().commissionRate).toBe(0.00025)
      expect(response.json().minimumCommission).toBe(5)
      expect(response.json().stampDutyRate).toBe(0.0005)
    } finally {
      await closeApp(context)
    }
  })

  it('七字段 PUT 原子保存费率、保留其他键；旧四字段 PUT 不覆盖已存费率', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('other_key', 'keep-me')").run()
      const saved = await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: fullBody })
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toMatchObject({ commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005 })
      expect(storedFeeSettings(context.database)).toEqual({
        [FEE_SETTING_KEYS.commission]: '0.0001',
        [FEE_SETTING_KEYS.minimum]: '0',
        [FEE_SETTING_KEYS.stamp]: '0.0005',
      })
      // 旧 UI 四字段保存（未带费率）：保留已存费率，只更新费用开关等
      const legacyUi = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: false, tPlusOne: true, initialCash: 500_000, adjustMode: 'raw' },
      })
      expect(legacyUi.statusCode).toBe(200)
      expect(legacyUi.json()).toMatchObject({ feesEnabled: false, commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005 })
      expect(storedFeeSettings(context.database)[FEE_SETTING_KEYS.commission]).toBe('0.0001')
    } finally {
      await closeApp(context)
    }
  })

  it('非法费率/最低佣金/缺项/未知字段 400 零写（不部分保存）', async () => {
    const context = await createApp()
    try {
      const ok = await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: fullBody })
      expect(ok.statusCode).toBe(200)
      const before = storedFeeSettings(context.database)
      const invalid: unknown[] = [
        { ...fullBody, commissionRate: -0.001 },
        { ...fullBody, commissionRate: 1.5 },
        { ...fullBody, commissionRate: '0.0001' },
        { ...fullBody, stampDutyRate: -0.0001 },
        { ...fullBody, minimumCommission: -1 },
        { ...fullBody, minimumCommission: 1.234 },
        { ...fullBody, minimumCommission: '0' },
        { feesEnabled: true, tPlusOne: false, initialCash: 500_000, adjustMode: 'raw', commissionRate: 0.0001 },
        { ...fullBody, feeRate: 0.001 },
      ]
      for (const body of invalid) {
        const response = await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: body as Record<string, unknown> })
        expect(response.statusCode, JSON.stringify(body)).toBe(400)
        expect(storedFeeSettings(context.database)).toEqual(before)
      }
    } finally {
      await closeApp(context)
    }
  })

  it('损坏费率键 GET 409 可行动报错并列出键名，不自动修复', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FEE_SETTING_KEYS.commission, 'abc')
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('TRAINING_DEFAULTS_UNREADABLE')
      expect(response.json().error).toContain(FEE_SETTING_KEYS.commission)
      expect(storedFeeSettings(context.database)[FEE_SETTING_KEYS.commission]).toBe('abc')
    } finally {
      await closeApp(context)
    }
  })

  it('快照冻结：新训练规则取保存后的费率，序列化后可严格解析；再次改默认不改写已序列化快照', async () => {
    const context = await createApp()
    try {
      await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: fullBody })
      const rules = observedDefaultRules(context.database, '2026-11-07T00:00:00.000Z')
      expect(rules).toMatchObject({ commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005, feesEnabled: true })
      const frozen = serializeTrainingRules(rules)
      // 改默认不影响已冻结快照
      await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: { ...fullBody, commissionRate: 0.0003, minimumCommission: 5 } })
      expect(parseTrainingRules(frozen)).toMatchObject({ commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005 })
      expect(parseTrainingRules(frozen)?.version).toBe(1)
    } finally {
      await closeApp(context)
    }
  })
})

describe('TRAIN-FEE-01 费用取整与免 5（独立手算 oracle）', () => {
  const custom: FeeConfig = { enabled: true, commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005, lotSize: 100 }
  const defaultFees: FeeConfig = { enabled: true, commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100 }

  it('佣金与印花税各自四舍五入到分：143910 元卖出＝佣金 35.98＋印花 71.96', () => {
    // 143910 × 0.00025 = 35.9775 → 35.98；143910 × 0.0005 = 71.955 → 71.96
    expect(buyCommission(143910, defaultFees)).toBe(35.98)
    expect(sellFee(143910, defaultFees)).toBe(107.94)
  })

  it('最低佣金 0 表示免 5；最低佣金 5 时小额成交按 5 元计', () => {
    expect(buyCommission(10_000, custom)).toBe(1) // 10000 × 0.0001 = 1
    expect(buyCommission(10_000, defaultFees)).toBe(5) // max(5, 2.5)
    expect(buyCommission(10_000, { ...custom, minimumCommission: 0, commissionRate: 0 })).toBe(0)
  })

  it('自定义费率驱动 planBuyShares 与 planSell 的费用与现金变化', () => {
    const buy = planBuyShares(initialAccountState(100_000), 10, 100, custom)
    expect(buy.ok).toBe(true)
    if (!buy.ok) return
    expect(buy.plan.fee).toBe(0.1) // 1000 × 0.0001 = 0.1
    expect(buy.plan.amount).toBe(1000)
    const afterBuy = { cash: 100_000 - buy.plan.amount - buy.plan.fee, shares: 100, costTotal: buy.plan.amount + buy.plan.fee }
    const sell = planSell(afterBuy, 12, { shares: 100 }, 100, custom)
    expect(sell.ok).toBe(true)
    if (!sell.ok) return
    // 1200 × 0.0001 = 0.12；1200 × 0.0005 = 0.6 → 0.72
    expect(sell.plan.fee).toBe(0.72)
    expect(sell.plan.amount).toBe(1200)
  })

  it('关闭费用时买卖均零费用；印花税率可配为 0', () => {
    const off: FeeConfig = { ...custom, enabled: false }
    expect(buyCommission(123456, off)).toBe(0)
    expect(sellFee(123456, off)).toBe(0)
    expect(sellFee(10_000, { ...custom, stampDutyRate: 0 })).toBe(1)
  })
})

describe('TRAIN-FEE-01 创建态损坏费率阻断', () => {

  it('创建入口对损坏费率键 409 零写（与资金/复权同口径）', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FEE_SETTING_KEYS.commission, 'abc')
      const before = (context.database.prepare('SELECT COUNT(*) AS n FROM trainings').get() as { n: number }).n
      let error: unknown = null
      try {
        commitTrainingCreation(context.database, {
          tier: '1M', code: '600519', name: '贵州茅台', market: 'sh',
          startDate: '2026-04-15', plannedEnd: '2026-05-15', blind: 0,
          adjustMode: 'forward', initialCash: 1_000_000,
          createdAt: '2026-04-15T00:00:00.000Z', currentDate: '2026-04-15', currentClose: null,
          range: null, industry: null, currentOpen: null, currentPhase: 'close',
          clockMode: 'close_only', ordersEnabled: false,
        })
      } catch (caught) { error = caught }
      expect((error as { code?: string } | null)?.code).toBe('TRAINING_DEFAULTS_UNREADABLE')
      expect(String((error as { message?: string } | null)?.message)).toContain(FEE_SETTING_KEYS.commission)
      expect((context.database.prepare('SELECT COUNT(*) AS n FROM trainings').get() as { n: number }).n).toBe(before)
    } finally {
      await closeApp(context)
    }
  })
})
