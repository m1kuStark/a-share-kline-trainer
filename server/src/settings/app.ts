import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../train/engine.js'

// M5-01：应用偏好设置 API：GET/PUT /api/settings/app。
// 与训练默认（/api/settings/training，四字段）分命名空间：应用偏好是即时行为开关，
// 不是创建时冻结的训练规则，语义与校验域都不同，不混入四字段契约。
// 本片交付 autoDataCheck（自动检查日线数据偏好）：
//   true（缺省）＝维持既有口径——应用启动、回前台与可见页 60s 重判自动检查 /api/data/status；
//   false＝只保留手动路径（「更新日线」/ 设置面板「重新检查」），自动检查一律跳过。
// 缺键＝内建默认 true（保持现状）；损坏键不是缺键：GET 返回可行动 409
// APP_SETTINGS_UNREADABLE，不自动修复；完整合法 PUT 即修复入口（与训练默认同语义）。
// 无 TDX 也可读写。注册进 registerApi 由集成人完成（api.ts 为集成人单写文件，
// 见 docs/work-items/tasks/M5-01.md）：registerAppSettingsRoutes(app, database) 一行，
// 经统一注册自动进入既有业务 admission 门闩（draining 503）。

export const APP_SETTINGS_VERSION = 1

export interface AppSettingsView {
  version: typeof APP_SETTINGS_VERSION
  autoDataCheck: boolean
}

export function appSettingsUnreadableError(): HttpError {
  return new HttpError(
    409,
    '应用偏好设置损坏（auto_data_check 无法读取）：请在设置面板重新切换一次「自动检查日线数据」并保存即可修复',
    'APP_SETTINGS_UNREADABLE',
  )
}

const SETTING_KEY = 'auto_data_check'

/** 读取应用偏好视图：缺键＝默认 true；值必须是 '0'/'1'，否则视为损坏由调用方映射 409。 */
export function readAppSettings(database: DatabaseSync): { ok: true; view: AppSettingsView } | { ok: false } {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as
    | { value: string }
    | undefined
  if (row === undefined) {
    return { ok: true, view: { version: APP_SETTINGS_VERSION, autoDataCheck: true } }
  }
  if (row.value === '1') return { ok: true, view: { version: APP_SETTINGS_VERSION, autoDataCheck: true } }
  if (row.value === '0') return { ok: true, view: { version: APP_SETTINGS_VERSION, autoDataCheck: false } }
  return { ok: false }
}

/** 事务保存单键：原子写入，保留表中其他键；返回保存后的完整视图。 */
export function saveAppSettings(database: DatabaseSync, autoDataCheck: boolean): AppSettingsView {
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTING_KEY, autoDataCheck ? '1' : '0')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  const read = readAppSettings(database)
  if (!read.ok) throw appSettingsUnreadableError()
  return read.view
}

/** 严格校验：必须恰好是 { autoDataCheck: boolean }。
 * 非对象/数组/null/缺字段/多字段/非布尔一律 400 零写。 */
export function parseAppSettingsPut(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是对象')
  }
  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.length !== 1 || keys[0] !== 'autoDataCheck') {
    throw new HttpError(400, '应用偏好保存必须恰好提供 autoDataCheck 布尔字段')
  }
  const value = (body as Record<string, unknown>).autoDataCheck
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'autoDataCheck 必须是布尔值')
  }
  return value
}

export function registerAppSettingsRoutes(app: FastifyInstance, database: DatabaseSync): void {
  app.get('/api/settings/app', async () => {
    const read = readAppSettings(database)
    if (!read.ok) throw appSettingsUnreadableError()
    return read.view
  })

  app.put('/api/settings/app', async request => {
    const autoDataCheck = parseAppSettingsPut(request.body)
    return saveAppSettings(database, autoDataCheck)
  })
}
