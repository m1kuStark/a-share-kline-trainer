import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import {
  SHORTCUT_ACTIONS, parseShortcutPreferences, readShortcutSettings,
  registerShortcutSettingsRoutes, saveShortcutSettings,
} from '../src/settings/shortcuts.js'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'settings-shortcuts-'))
  const database = new DatabaseSync(join(root, 'trainer.sqlite'))
  migrateDatabase(database)
  const app = Fastify()
  registerShortcutSettingsRoutes(app, database)
  return { root, database, app }
}

describe('keyboard shortcut settings', () => {
  it('returns defaults and atomically persists two bindings per action', async () => {
    const context = await setup()
    try {
      const initial = await context.app.inject({ method: 'GET', url: '/api/settings/shortcuts' })
      expect(initial.statusCode).toBe(200)
      const shortcuts = initial.json().shortcuts
      shortcuts.advance = [['KeyQ'], ['KeyR']]
      const saved = await context.app.inject({ method: 'PUT', url: '/api/settings/shortcuts', payload: { shortcuts } })
      expect(saved.statusCode).toBe(200)
      expect((await context.app.inject({ method: 'GET', url: '/api/settings/shortcuts' })).json().shortcuts.advance).toEqual([['KeyQ'], ['KeyR']])
    } finally {
      await context.app.close(); context.database.close(); await rm(context.root, { recursive: true, force: true })
    }
  })

  it('rejects duplicate or overlong combinations without replacing the saved value', async () => {
    const context = await setup()
    try {
      const defaults = readShortcutSettings(context.database)
      if (!defaults.ok) throw new Error('defaults unavailable')
      const before = JSON.stringify(defaults.shortcuts)
      expect(() => saveShortcutSettings(context.database, { ...defaults.shortcuts, buy: [['KeyS']] })).toThrow()
      expect(JSON.stringify(readShortcutSettings(context.database).ok && readShortcutSettings(context.database).shortcuts)).toBe(before)
      const invalid = { ...defaults.shortcuts, buy: [['Control', 'Shift', 'KeyB']] }
      expect(parseShortcutPreferences(invalid)).toBeNull()
      expect(SHORTCUT_ACTIONS).toHaveLength(13)
    } finally {
      await context.app.close(); context.database.close(); await rm(context.root, { recursive: true, force: true })
    }
  })
})
