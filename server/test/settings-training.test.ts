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
