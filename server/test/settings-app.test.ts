import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_SETTINGS_VERSION,
  appSettingsUnreadableError,
  parseAppSettingsPut,
  readAppSettings,
  registerAppSettingsRoutes,
  saveAppSettings,
} from '../src/settings/app.js'
import { migrateDatabase } from '../src/db.js'

// M5-01：应用偏好设置 API（GET/PUT /api/settings/app，本片交付 autoDataCheck 自动检查日线数据）。
// 路由尚未在 api.ts 注册（该文件本轮由集成人单写，集成阶段一行接线）；本文件直接在独立
// Fastify 实例注册被测模块。无 TDX 依赖；损坏键语义与训练默认同族（409 可行动、PUT 即修复）。

async function createApp() {
  const root = await mkdtemp(join(tmpdir(), 'settings-app-'))
  const databasePath = join(root, 'trainer.sqlite')
  const database = new DatabaseSync(databasePath)
  migrateDatabase(database)
  const app = Fastify()
  registerAppSettingsRoutes(app, database)
  return { app, database, root }
}

async function closeApp(context: Awaited<ReturnType<typeof createApp>>) {
  await context.app.close()
  context.database.close()
  await rm(context.root, { recursive: true, force: true })
}

function autoCheckRow(database: DatabaseSync): { key: string; value: string } | undefined {
  return database.prepare("SELECT key, value FROM settings WHERE key = 'auto_data_check'").get() as
    | { key: string; value: string }
    | undefined
}

describe('M5-01：应用偏好 GET /api/settings/app', () => {
  it('缺键＝内建默认 true（维持既有自动检查口径），version 1', async () => {
    const context = await createApp()
    try {
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/app' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ version: APP_SETTINGS_VERSION, autoDataCheck: true })
      expect(autoCheckRow(context.database)).toBeUndefined()
    } finally {
      await closeApp(context)
    }
  })

  it('已存值如实返回：存 0 读 false、存 1 读 true；其他键不受影响', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('fees_enabled', '0')").run()
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('auto_data_check', '0')").run()
      const off = await context.app.inject({ method: 'GET', url: '/api/settings/app' })
      expect(off.json()).toMatchObject({ autoDataCheck: false })
      context.database.prepare("UPDATE settings SET value = '1' WHERE key = 'auto_data_check'").run()
      const on = await context.app.inject({ method: 'GET', url: '/api/settings/app' })
      expect(on.json()).toMatchObject({ autoDataCheck: true })
      expect(context.database.prepare("SELECT value FROM settings WHERE key = 'fees_enabled'").get()).toMatchObject({ value: '0' })
    } finally {
      await closeApp(context)
    }
  })

  it('损坏键不是缺键：409 可行动报错（含修复指引），不自动修复', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('auto_data_check', 'yes')").run()
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/app' })
      expect(response.statusCode).toBe(409)
      // 独立实例无 api.ts 错误映射，message 原样下发；错误码由导出函数单独断言
      expect(response.json().message).toContain('auto_data_check')
      expect(response.json().message).toContain('修复')
      expect(appSettingsUnreadableError().code).toBe('APP_SETTINGS_UNREADABLE')
      expect(appSettingsUnreadableError().statusCode).toBe(409)
      // 未自动修复：坏字节保留
      expect(autoCheckRow(context.database)).toEqual({ key: 'auto_data_check', value: 'yes' })
    } finally {
      await closeApp(context)
    }
  })
})

describe('M5-01：应用偏好 PUT /api/settings/app', () => {
  it('布尔保存即时生效并持久：false 落盘为 0，重开库读回一致', async () => {
    const root = await mkdtemp(join(tmpdir(), 'settings-app-persist-'))
    const databasePath = join(root, 'trainer.sqlite')
    try {
      const database = new DatabaseSync(databasePath)
      migrateDatabase(database)
      const app = Fastify()
      registerAppSettingsRoutes(app, database)
      const saved = await app.inject({
        method: 'PUT', url: '/api/settings/app', payload: { autoDataCheck: false },
      })
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toEqual({ version: APP_SETTINGS_VERSION, autoDataCheck: false })
      expect(autoCheckRow(database)).toEqual({ key: 'auto_data_check', value: '0' })
      await app.close()
      database.close()
      const reopened = new DatabaseSync(databasePath)
      expect(readAppSettings(reopened)).toEqual({ ok: true, view: { version: APP_SETTINGS_VERSION, autoDataCheck: false } })
      reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('保存保留表中其他键；true→false→true 往返一致', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('training_initial_cash', '800000')").run()
      for (const wanted of [false, true, false]) {
        const saved = await context.app.inject({
          method: 'PUT', url: '/api/settings/app', payload: { autoDataCheck: wanted },
        })
        expect(saved.statusCode).toBe(200)
        expect(saved.json().autoDataCheck).toBe(wanted)
      }
      expect(context.database.prepare("SELECT value FROM settings WHERE key = 'training_initial_cash'").get())
        .toMatchObject({ value: '800000' })
    } finally {
      await closeApp(context)
    }
  })

  it('损坏键经一次合法 PUT 修复（设置面板修复入口），坏字节被覆盖', async () => {
    const context = await createApp()
    try {
      context.database.prepare("INSERT INTO settings (key, value) VALUES ('auto_data_check', 'corrupt')").run()
      const before = await context.app.inject({ method: 'GET', url: '/api/settings/app' })
      expect(before.statusCode).toBe(409)
      const repaired = await context.app.inject({
        method: 'PUT', url: '/api/settings/app', payload: { autoDataCheck: false },
      })
      expect(repaired.statusCode).toBe(200)
      expect(repaired.json().autoDataCheck).toBe(false)
      expect(autoCheckRow(context.database)).toEqual({ key: 'auto_data_check', value: '0' })
    } finally {
      await closeApp(context)
    }
  })

  it('形状校验：非对象/缺字段/多字段/非布尔一律 400 零写', async () => {
    const context = await createApp()
    try {
      const badPayloads: unknown[] = [
        null, 'x', [], 42,
        {},
        { autoDataCheck: 'true' },
        { autoDataCheck: 1 },
        { autoDataCheck: true, extra: 1 },
        { autoDataCheck: undefined },
      ]
      for (const payload of badPayloads) {
        const response = await context.app.inject({
          method: 'PUT', url: '/api/settings/app',
          // 生产客户端总是带 JSON content-type；显式声明使 null/字符串体走 400（空体/解析失败）而非 415
          headers: { 'content-type': 'application/json' },
          payload: payload as Record<string, unknown>,
        })
        expect(response.statusCode).toBe(400)
      }
      expect(autoCheckRow(context.database)).toBeUndefined()
    } finally {
      await closeApp(context)
    }
  })
})

describe('M5-01：parseAppSettingsPut / saveAppSettings 纯函数契约', () => {
  it('parseAppSettingsPut 恰好接受 {autoDataCheck: boolean}', () => {
    expect(parseAppSettingsPut({ autoDataCheck: true })).toBe(true)
    expect(parseAppSettingsPut({ autoDataCheck: false })).toBe(false)
    expect(() => parseAppSettingsPut({})).toThrow()
    expect(() => parseAppSettingsPut({ autoDataCheck: null })).toThrow()
      expect(() => parseAppSettingsPut({ autoDataCheck: true, version: 1 })).toThrow()
  })

  it('saveAppSettings 事务写入并返回保存后的完整视图', () => {
    const root = mkdtempSync(join(tmpdir(), 'settings-app-unit-'))
    try {
      const database = new DatabaseSync(join(root, 't.sqlite'))
      migrateDatabase(database)
      const view = saveAppSettings(database, false)
      expect(view).toEqual({ version: APP_SETTINGS_VERSION, autoDataCheck: false })
      database.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
