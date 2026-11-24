import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'

it('M9 hold isolates formula routes while ordinary settings remain registered', async () => {
  const db = new DatabaseSync(':memory:')
  const app = Fastify()
  try {
    migrateDatabase(db)
    await registerApi(app, { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: null }, db)
    await app.ready()
    expect((await app.inject('/api/settings/app')).statusCode).toBe(200)
    for (const path of ['/api/formulas', '/api/formulas/context?code=600000']) {
      expect((await app.inject(path)).statusCode, path).toBe(404)
    }
    expect((await app.inject({ method: 'POST', url: '/api/formulas/validate', payload: { source: 'A:C;' } })).statusCode).toBe(404)
  } finally { await app.close(); db.close() }
})

it('M9 hold preserves existing formula data without creating a new formula library', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrateDatabase(db)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'formulas'").all()).toHaveLength(0)
    db.exec("CREATE TABLE formulas (id INTEGER PRIMARY KEY, name TEXT, source TEXT, enabled INTEGER); INSERT INTO formulas VALUES (7, 'keep', 'A:C;', 0)")
    migrateDatabase(db)
    expect(db.prepare('SELECT * FROM formulas').all()).toEqual([{ id: 7, name: 'keep', source: 'A:C;', enabled: 0 }])
  } finally { db.close() }
})
