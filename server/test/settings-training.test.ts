import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'

// 每个用例都做真实临时文件 SQLite＋迁移＋Fastify 注入（含触发器回滚路径），
// threads 池满载并行下整体耗时可数倍于串行（集成门禁 2026-09-30 曾在事务回滚用例上
// 以默认 5000ms 超时失败，该用例串行仅 965ms）。与 docs-tooling（20s）、
// review-profile（30s）、worktree-tools（90s）同一先例：真实 I/O 预算放宽到 20s，
// 断言不变——这是时间预算修正，不是产品延迟 SLO（testing.md 同款口径）。
vi.setConfig({ testTimeout: 20_000 })

// TRAIN-01：/api/settings/training 默认设置 GET/PUT。真实临时 SQLite 文件 + Fastify.inject；
// 不需要 TDX 目录（无 TDX 也可读写这两项默认）。
async function createApp() {
  const root = await mkdtemp(join(tmpdir(), 'settings-training-'))
  const databasePath = join(root, 'trainer.sqlite')
  const database = new DatabaseSync(databasePath)
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath, tdxRoot: null }
  await registerApi(app, config, database)
  return { app, database, root }
}

async function closeApp(context: Awaited<ReturnType<typeof createApp>>) {
  await context.app.close()
  context.database.close()
  await rm(context.root, { recursive: true, force: true })
}

function settingsRows(database: DatabaseSync): Array<{ key: string; value: string }> {
  return database.prepare('SELECT key, value FROM settings ORDER BY key').all() as unknown as Array<{ key: string; value: string }>
}

describe('M5-DEFAULTS：四字段训练默认设置（control-handoff-20260928-50）', () => {
  it('GET 缺键默认：initialCash 1,000,000、adjustMode forward；GET 反映已存新键', async () => {
    const context = await createApp()
    try {
      const fresh = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(fresh.statusCode).toBe(200)
      expect(fresh.json()).toMatchObject({ initialCash: 1_000_000, adjustMode: 'forward' })
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_initial_cash', '800000.5')").run()
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_adjust_mode', 'raw')").run()
      const stored = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(stored.json()).toMatchObject({ initialCash: 800000.5, adjustMode: 'raw' })
    } finally {
      await closeApp(context)
    }
  })

  it('GET 损坏键不是缺键：409 TRAINING_DEFAULTS_UNREADABLE 可行动报错，不自动修复', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_initial_cash', 'not-a-number')").run()
      const badCash = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(badCash.statusCode).toBe(409)
      expect(badCash.json().code).toBe('TRAINING_DEFAULTS_UNREADABLE')
      expect(badCash.json().error).toContain('training_initial_cash')
      context.database.prepare("UPDATE settings SET value = '800000' WHERE key = 'training_initial_cash'").run()
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_adjust_mode', 'sideways')").run()
      const badMode = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(badMode.statusCode).toBe(409)
      expect(badMode.json().code).toBe('TRAINING_DEFAULTS_UNREADABLE')
      expect(badMode.json().error).toContain('training_adjust_mode')
      // 未自动修复：坏键仍在
      expect(settingsRows(context.database)).toEqual(expect.arrayContaining([
        { key: 'training_adjust_mode', value: 'sideways' },
      ]))
    } finally {
      await closeApp(context)
    }
  })

  it('四字段 PUT 原子保存并持久：数值/枚举校验通过，其他键保留，文件库重开不变', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm5-defaults-'))
    const databasePath = join(root, 'trainer.sqlite')
    try {
      const database = new DatabaseSync(databasePath)
      migrateDatabase(database)
      const app = Fastify()
      const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath, tdxRoot: null }
      await registerApi(app, config, database)
      database.prepare("INSERT INTO settings (key, value) VALUES ('other_key', 'keep-me')").run()
      const saved = await app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: false, initialCash: 1200000.5, adjustMode: 'raw' },
      })
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toMatchObject({ feesEnabled: true, tPlusOne: false, initialCash: 1200000.5, adjustMode: 'raw' })
      expect(settingsRows(database)).toEqual(expect.arrayContaining([
        { key: 'training_initial_cash', value: '1200000.5' },
        { key: 'training_adjust_mode', value: 'raw' },
        { key: 'other_key', value: 'keep-me' },
      ]))
      await app.close()
      database.close()
      // 重开持久
      const reopened = new DatabaseSync(databasePath)
      const app2 = Fastify()
      await registerApi(app2, config, reopened)
      const readBack = await app2.inject({ method: 'GET', url: '/api/settings/training' })
      expect(readBack.json()).toMatchObject({ initialCash: 1200000.5, adjustMode: 'raw' })
      await app2.close()
      reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('四字段 PUT 资金支持域：0.01/1e9/两位小数可保存；0、负、超上限、三位小数、字符串、非有限 400 零写', async () => {
    const context = await createApp()
    try {
      for (const initialCash of [0.01, 1_000_000_000, 123.45]) {
        const ok = await context.app.inject({
          method: 'PUT', url: '/api/settings/training',
          payload: { feesEnabled: false, tPlusOne: true, initialCash, adjustMode: 'forward' },
        })
        expect(ok.statusCode).toBe(200)
        expect(ok.json().initialCash).toBe(initialCash)
      }
      for (const initialCash of [0, -1, -0.01, 1_000_000_001, 123.456, '800000', true]) {
        const bad = await context.app.inject({
          method: 'PUT', url: '/api/settings/training',
          payload: { feesEnabled: false, tPlusOne: true, initialCash, adjustMode: 'forward' },
        })
        expect(bad.statusCode).toBe(400)
      }
      expect(settingsRows(context.database)).toEqual(expect.arrayContaining([
        { key: 'training_initial_cash', value: '123.45' },
      ]))
    } finally {
      await closeApp(context)
    }
  })

  it('四字段 PUT adjustMode 枚举外 400 零写', async () => {
    const context = await createApp()
    try {
      const bad = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: false, tPlusOne: true, initialCash: 800000, adjustMode: 'sideways' },
      })
      expect(bad.statusCode).toBe(400)
      expect(settingsRows(context.database)).toEqual([])
    } finally {
      await closeApp(context)
    }
  })

  it('旧两布尔 PUT 兼容：只更新旧两键并保留新默认资金/复权；不修复损坏新键', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_initial_cash', '800000')").run()
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_adjust_mode', 'raw')").run()
      const legacy = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: false },
      })
      expect(legacy.statusCode).toBe(200)
      expect(legacy.json()).toMatchObject({ feesEnabled: true, tPlusOne: false, initialCash: 800000, adjustMode: 'raw' })
      // 损坏新键：旧 PUT 不得假称已修复
      context.database.prepare("UPDATE settings SET value = 'broken' WHERE key = 'training_initial_cash'").run()
      const legacyOnBroken = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: false, tPlusOne: true },
      })
      expect(legacyOnBroken.statusCode).toBe(200)
      const after = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(after.statusCode).toBe(409)
      expect(after.json().code).toBe('TRAINING_DEFAULTS_UNREADABLE')
    } finally {
      await closeApp(context)
    }
  })

  it('部分对象拒绝：带资金/复权但非完整四字段（或缺布尔）400 零写', async () => {
    const context = await createApp()
    try {
      for (const body of [
        { feesEnabled: true, tPlusOne: true, initialCash: 800000 },
        { feesEnabled: true, tPlusOne: true, adjustMode: 'raw' },
        { initialCash: 800000, adjustMode: 'raw' },
        { feesEnabled: true, tPlusOne: true, initialCash: 800000, adjustMode: 'raw', extra: 1 },
      ]) {
        const bad = await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: body })
        expect(bad.statusCode).toBe(400)
      }
      expect(settingsRows(context.database)).toEqual([])
    } finally {
      await closeApp(context)
    }
  })

  it('四键同事务：新键写入中途失败整体回滚（旧两键也不落库）', async () => {
    const context = await createApp()
    try {
      context.database.exec(`
        CREATE TRIGGER block_cash_default BEFORE INSERT ON settings
        WHEN NEW.key = 'training_initial_cash'
        BEGIN
          SELECT RAISE(ABORT, 'blocked by test trigger');
        END;
      `)
      const response = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: false, initialCash: 800000, adjustMode: 'raw' },
      })
      expect(response.statusCode).toBe(500)
      expect(settingsRows(context.database)).toEqual([])
    } finally {
      await closeApp(context)
    }
  })

  it('损坏键可由完整合法四字段 PUT 修复', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_initial_cash', 'broken')").run()
      const before = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(before.statusCode).toBe(409)
      const repaired = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: false, tPlusOne: true, initialCash: 900000, adjustMode: 'forward' },
      })
      expect(repaired.statusCode).toBe(200)
      const after = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(after.statusCode).toBe(200)
      expect(after.json()).toMatchObject({ initialCash: 900000, adjustMode: 'forward' })
    } finally {
      await closeApp(context)
    }
  })
})

describe('M5-DEFAULTS 返修 F2/F3（control-handoff-20260928-51）', () => {
  it('F2 旧两布尔 PUT 响应不伪造损坏新键：损坏字段整体缺席于响应', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_initial_cash', 'broken')").run()
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_adjust_mode', 'sideways')").run()
      const legacy = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: false },
      })
      expect(legacy.statusCode).toBe(200)
      const body = legacy.json()
      expect(body.feesEnabled).toBe(true)
      expect(body.tPlusOne).toBe(false)
      // 不得凭空返回 1,000,000/forward 冒称有效或已修复
      expect(body).not.toHaveProperty('initialCash')
      expect(body).not.toHaveProperty('adjustMode')
      // 坏字节原样保留，GET 仍 409
      expect(settingsRows(context.database)).toEqual(expect.arrayContaining([
        { key: 'training_initial_cash', value: 'broken' },
        { key: 'training_adjust_mode', value: 'sideways' },
      ]))
      const after = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(after.statusCode).toBe(409)
    } finally {
      await closeApp(context)
    }
  })

  it('F2 缺键（非损坏）时旧两布尔 PUT 响应保留内建默认形状', async () => {
    const context = await createApp()
    try {
      const legacy = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: true },
      })
      expect(legacy.statusCode).toBe(200)
      expect(legacy.json()).toMatchObject({ feesEnabled: true, tPlusOne: true, initialCash: 1_000_000, adjustMode: 'forward' })
    } finally {
      await closeApp(context)
    }
  })

  it('F3 十进制语义：合法 10000000.03/.04/.05 可保存；0.010000000001 等超精度 400 零写', async () => {
    const context = await createApp()
    try {
      for (const initialCash of [10000000.03, 10000000.04, 10000000.05, 0.01, 0.1, 123.45, 1_000_000_000]) {
        const ok = await context.app.inject({
          method: 'PUT', url: '/api/settings/training',
          payload: { feesEnabled: false, tPlusOne: true, initialCash, adjustMode: 'forward' },
        })
        expect(ok.statusCode).toBe(200)
        expect(ok.json().initialCash).toBe(initialCash)
        // 合法值保存后 GET 可读
        const readBack = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
        expect(readBack.json().initialCash).toBe(initialCash)
      }
      for (const initialCash of [0.010000000001, 10000000.034, 1.001]) {
        const bad = await context.app.inject({
          method: 'PUT', url: '/api/settings/training',
          payload: { feesEnabled: false, tPlusOne: true, initialCash, adjustMode: 'forward' },
        })
        expect(bad.statusCode).toBe(400)
      }
      // 最后一次成功保存仍是 1,000,000,000，超精度尝试零写
      const view = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(view.json().initialCash).toBe(1_000_000_000)
    } finally {
      await closeApp(context)
    }
  })
})

describe('TRAINING-RULES：设置默认值 API', () => {
  it('GET 返回默认口径：费用关、T+1 开、固定数值与执行口径', async () => {
    const context = await createApp()
    try {
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
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
      })
    } finally {
      await closeApp(context)
    }
  })

  it('GET 反映既有 settings 键的当前值，无 TDX 也可读取', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('fees_enabled', '1')").run()
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('t1_enabled', '0')").run()
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ feesEnabled: true, tPlusOne: false })
    } finally {
      await closeApp(context)
    }
  })

  it('PUT 合法保存两项布尔值并写入既有键，重复保存相同值安全', async () => {
    const context = await createApp()
    try {
      for (const body of [{ feesEnabled: true, tPlusOne: false }, { feesEnabled: true, tPlusOne: false }]) {
        const response = await context.app.inject({
          method: 'PUT', url: '/api/settings/training',
          payload: body,
        })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ feesEnabled: true, tPlusOne: false })
      }
      expect(settingsRows(context.database)).toEqual(expect.arrayContaining([
        { key: 'fees_enabled', value: '1' },
        { key: 't1_enabled', value: '0' },
      ]))
      const repeated = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: false },
      })
      expect(repeated.statusCode).toBe(200)
    } finally {
      await closeApp(context)
    }
  })

  it('PUT 保留 settings 表中的其他键', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('other_key', 'keep-me')").run()
      const response = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: true },
      })
      expect(response.statusCode).toBe(200)
      expect(settingsRows(context.database)).toEqual(expect.arrayContaining([{ key: 'other_key', value: 'keep-me' }]))
    } finally {
      await closeApp(context)
    }
  })

  const invalidBodies: Array<{ name: string; body: unknown; badField: string }> = [
    { name: '缺 feesEnabled', body: { tPlusOne: true }, badField: 'feesEnabled' },
    { name: '缺 tPlusOne', body: { feesEnabled: true }, badField: 'tPlusOne' },
    { name: '类型错误', body: { feesEnabled: 'true', tPlusOne: true }, badField: '布尔' },
    { name: '未知字段', body: { feesEnabled: true, tPlusOne: true, commissionRate: 0.001 }, badField: '未知字段' },
    { name: '非对象', body: [true, true], badField: '对象' },
  ]

  for (const item of invalidBodies) {
    it(`PUT 非法请求整体拒绝（${item.name}）且零写入`, async () => {
      const context = await createApp()
      try {
        context.database.prepare("INSERT INTO settings (key, value) VALUES ('fees_enabled', '0')").run()
        context.database.prepare("INSERT INTO settings (key, value) VALUES ('t1_enabled', '1')").run()
        const before = settingsRows(context.database)
        const response = await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: item.body as Record<string, unknown> })
        expect(response.statusCode).toBe(400)
        expect(response.json().error).toContain(item.badField)
        expect(settingsRows(context.database)).toEqual(before)
      } finally {
        await closeApp(context)
      }
    })
  }

  it('同一请求内两值同事务更新，不部分成功（第二次更新失败则整体回滚）', async () => {
    const context = await createApp()
    try {
      // 模拟第二键写入失败：临时触发器在 t1_enabled 插入时中止
      context.database.exec(`
        CREATE TRIGGER block_t1 BEFORE INSERT ON settings
        WHEN NEW.key = 't1_enabled'
        BEGIN
          SELECT RAISE(ABORT, 'blocked');
        END;
      `)
      const response = await context.app.inject({
        method: 'PUT', url: '/api/settings/training',
        payload: { feesEnabled: true, tPlusOne: false },
      })
      expect(response.statusCode).toBe(500)
      // 零写入：fees_enabled 不得被部分写入
      const fees = context.database.prepare("SELECT value FROM settings WHERE key = 'fees_enabled'").get() as unknown as { value: string } | undefined
      expect(fees?.value ?? '0').toBe('0')
    } finally {
      await closeApp(context)
    }
  })

  it('最后一次成功保存供未来创建使用（保存后再读返回新值）', async () => {
    const context = await createApp()
    try {
      await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: { feesEnabled: false, tPlusOne: true } })
      const second = await context.app.inject({ method: 'PUT', url: '/api/settings/training', payload: { feesEnabled: true, tPlusOne: false } })
      expect(second.statusCode).toBe(200)
      const readBack = await context.app.inject({ method: 'GET', url: '/api/settings/training' })
      expect(readBack.json()).toMatchObject({ feesEnabled: true, tPlusOne: false })
    } finally {
      await closeApp(context)
    }
  })

  it('设置 API 进入业务 admission 门闩：draining 时 503 SERVER_DRAINING', async () => {
    const root = await mkdtemp(join(tmpdir(), 'settings-training-drain-'))
    try {
      const databasePath = join(root, 'trainer.sqlite')
      const database = new DatabaseSync(databasePath)
      migrateDatabase(database)
      const app = Fastify()
      const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath, tdxRoot: null }
      await registerApi(app, config, database, {
        drain: {
          isOpen: () => false,
          admit: () => ({ ok: false }),
          registerTaskSource: () => {},
          close: () => {},
        },
      })
      for (const request of [
        { method: 'GET', url: '/api/settings/training' },
        { method: 'PUT', url: '/api/settings/training', payload: { feesEnabled: true, tPlusOne: true } },
      ]) {
        const response = await app.inject(request)
        expect(response.statusCode).toBe(503)
        expect(response.json().error).toBe('SERVER_DRAINING')
      }
      await app.close()
      database.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
