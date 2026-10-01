import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../train/engine.js'

export const SHORTCUT_SETTINGS_VERSION = 1
export const SHORTCUT_ACTIONS = [
  'advance', 'timeframePrev', 'timeframeNext', 'undo', 'redo', 'deleteDrawing',
  'buy', 'sell', 'zoomIn', 'zoomOut', 'crosshairLeft', 'crosshairRight', 'resetView',
] as const
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]
export type Shortcut = string[]
export type ShortcutPreferences = Record<ShortcutAction, Shortcut[]>

const DEFAULT_SHORTCUTS: ShortcutPreferences = {
  advance: [['Space']], timeframePrev: [['BracketLeft']], timeframeNext: [['BracketRight']],
  undo: [['Control', 'KeyZ']], redo: [['Control', 'KeyY']], deleteDrawing: [['Delete']],
  buy: [['KeyB']], sell: [['KeyS']], zoomIn: [['ArrowUp']], zoomOut: [['ArrowDown']],
  crosshairLeft: [['ArrowLeft']], crosshairRight: [['ArrowRight']], resetView: [['Home']],
}
const SETTING_KEY = 'keyboard_shortcuts_v1'

function clone(value: ShortcutPreferences): ShortcutPreferences {
  return Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action, value[action].map(keys => [...keys])])) as unknown as ShortcutPreferences
}

function shortcutId(keys: readonly string[]): string {
  const aliases: Record<string, string> = { ControlLeft: 'Control', ControlRight: 'Control', ShiftLeft: 'Shift', ShiftRight: 'Shift', AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Meta', MetaRight: 'Meta' }
  const order = ['Control', 'Shift', 'Alt', 'Meta']
  return [...new Set(keys.map(key => aliases[key] ?? key))].sort((a, b) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b)
  }).join('+')
}

export function shortcutsUnreadableError(): HttpError {
  return new HttpError(409, '快捷键设置损坏：请在设置面板重新保存快捷键', 'SHORTCUT_SETTINGS_UNREADABLE')
}

export function readShortcutSettings(database: DatabaseSync): { ok: true; shortcuts: ShortcutPreferences } | { ok: false } {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined
  if (!row) return { ok: true, shortcuts: clone(DEFAULT_SHORTCUTS) }
  try {
    const parsed = JSON.parse(row.value) as unknown
    const shortcuts = parseShortcutPreferences(parsed)
    return shortcuts ? { ok: true, shortcuts } : { ok: false }
  } catch { return { ok: false } }
}

export function parseShortcutPreferences(value: unknown): ShortcutPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const result = clone(DEFAULT_SHORTCUTS)
  const used = new Set<string>()
  for (const action of SHORTCUT_ACTIONS) {
    const raw = input[action]
    if (!Array.isArray(raw) || raw.length > 2) return null
    const bindings: Shortcut[] = []
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 1 || item.length > 2 || item.some(key => typeof key !== 'string' || key.length === 0 || key.length > 40)) return null
      const keys = [...new Set(item)]
      const id = shortcutId(keys)
      if (!id || used.has(id)) return null
      used.add(id)
      bindings.push(keys)
    }
    result[action] = bindings
  }
  const unknown = Object.keys(input).filter(key => !SHORTCUT_ACTIONS.includes(key as ShortcutAction))
  return unknown.length ? null : result
}

export function saveShortcutSettings(database: DatabaseSync, shortcuts: ShortcutPreferences): ShortcutPreferences {
  const parsed = parseShortcutPreferences(shortcuts)
  if (!parsed) throw new HttpError(400, '快捷键设置包含重复、非法或超过两个按键的组合', 'INVALID_SHORTCUT_SETTINGS')
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SETTING_KEY, JSON.stringify(parsed))
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return parsed
}

export function registerShortcutSettingsRoutes(app: FastifyInstance, database: DatabaseSync): void {
  app.get('/api/settings/shortcuts', async () => {
    const read = readShortcutSettings(database)
    if (!read.ok) throw shortcutsUnreadableError()
    return { version: SHORTCUT_SETTINGS_VERSION, shortcuts: read.shortcuts }
  })
  app.put('/api/settings/shortcuts', async request => {
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'shortcuts')) {
      throw new HttpError(400, '快捷键保存必须恰好提供 shortcuts 对象', 'INVALID_SHORTCUT_SETTINGS')
    }
    const saved = saveShortcutSettings(database, (body as { shortcuts: ShortcutPreferences }).shortcuts)
    return { version: SHORTCUT_SETTINGS_VERSION, shortcuts: saved }
  })
}
