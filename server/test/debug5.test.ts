import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'

describe('debug route', () => {
  it('shows thrown error', async () => {
    const app = Fastify()
    const db = new DatabaseSync(':memory:')
    migrateDatabase(db)
    await registerApi(app, { port: 8787, host: '127.0.0.1', databasePath: ':memory:', tdxRoot: null, controlToken: 'tok' }, db, {
      setup: {
        processQuery: async () => ({ exitCode: 0, stdout: 'D:\new_tdx\bin\TdxW.exe', stderr: '', timedOut: false }),
        inspect: async roots => roots.map(root => ({ root, recognized: true, readable: true, dailyFileCount: 42, latestDate: '2026-09-24', hasAdjustment: true, hasNames: true, hasBenchmark: false, problems: [] })),
      },
    })
    const response = await app.inject({ method: 'GET', url: '/api/setup/candidates', headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' } })
    console.log('STATUS', response.statusCode)
    expect(response.statusCode).toBe(200)
  })
})
