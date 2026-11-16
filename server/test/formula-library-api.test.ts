import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FormulaEngine, scanFutureFunctions } from '../../web/src/formula-engine/index'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import type { FormulaEngineModule } from '../src/formulas/engine.js'
import { registerFormulaRoutes } from '../src/formulas/api.js'

const engineModule = { FormulaEngine, scanFutureFunctions } as unknown as FormulaEngineModule
const engineProvider = async () => engineModule

function dayRecord(date: number, open: number, high: number, low: number, close: number, amount: number, volume: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(high * 100), 8)
  buffer.writeInt32LE(Math.round(low * 100), 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(amount, 20)
  buffer.writeInt32LE(volume, 24)
  return buffer
}

async function fixture(): Promise<{ root: string; config: AppConfig; database: DatabaseSync }> {
  const root = await mkdtemp(join(tmpdir(), 'formula-library-api-'))
  await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), Buffer.concat([
    dayRecord(20260901, 10, 11, 9, 10.5, 1000, 100),
    dayRecord(20260902, 10.5, 11.5, 10, 11, 1100, 110),
    dayRecord(20260903, 11, 12, 10.5, 11.5, 1200, 120),
  ]))
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  return { root, config, database }
}

async function createApp(config: AppConfig, database: DatabaseSync) {
  const app = Fastify()
  registerFormulaRoutes(app, config, database, { engine: engineProvider })
  return app
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as unknown as { n: number }
  return Number(row.n)
}

const validSource = 'MA2:MA(CLOSE,2);\nMA3:MA(CLOSE,3);'

describe('M9-04A 公式库 API（CRUD/validate/evaluate，只读）', () => {
  it('CRUD：创建/列表/更新/删除，重复名 409，非法语法 400', async () => {
    const { root, config, database } = await fixture()
    const app = await createApp(config, database)
    try {
      expect((await app.inject({ method: 'GET', url: '/api/formulas' })).json()).toEqual({ formulas: [] })
      const created = await app.inject({ method: 'POST', url: '/api/formulas', payload: { name: 'MY_MA', description: '两日均线', placement: 'sub', source: validSource } })
      expect(created.statusCode).toBe(201)
      const createdBody = created.json()
      expect(createdBody.name).toBe('MY_MA')
      expect(createdBody.placement).toBe('sub')
      expect(createdBody.futureFunctions).toEqual([])
      const duplicate = await app.inject({ method: 'POST', url: '/api/formulas', payload: { name: 'my_ma', placement: 'main', source: validSource } })
      expect(duplicate.statusCode).toBe(409)
      const invalid = await app.inject({ method: 'POST', url: '/api/formulas', payload: { name: 'BAD', placement: 'main', source: 'A:MA(CLOSE,;' } })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().detail.kind).toMatch(/lexer|parser/)
      const badName = await app.inject({ method: 'POST', url: '/api/formulas', payload: { name: '中文', placement: 'main', source: validSource } })
      expect(badName.statusCode).toBe(400)
      const updated = await app.inject({ method: 'PUT', url: '/api/formulas/' + createdBody.id, payload: { description: '副图两日线', placement: 'main' } })
      expect(updated.statusCode).toBe(200)
      expect(updated.json().placement).toBe('main')
      expect((await app.inject({ method: 'GET', url: '/api/formulas' })).json().formulas).toHaveLength(1)
      expect((await app.inject({ method: 'DELETE', url: '/api/formulas/' + createdBody.id })).statusCode).toBe(204)
      expect((await app.inject({ method: 'GET', url: '/api/formulas/' + createdBody.id })).statusCode).toBe(404)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validate：合法/未来函数/语法错误/空源码 400', async () => {
    const { root, config, database } = await fixture()
    const app = await createApp(config, database)
    try {
      const ok = await app.inject({ method: 'POST', url: '/api/formulas/validate', payload: { source: 'A:MA(CLOSE,5); B:BACKSET(CLOSE>OPEN,3);' } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().ok).toBe(true)
      expect(ok.json().futureFunctions).toContain('BACKSET')
      const bad = await app.inject({ method: 'POST', url: '/api/formulas/validate', payload: { source: 'A:MA(CLOSE,;' } })
      expect(bad.statusCode).toBe(200)
      expect(bad.json().ok).toBe(false)
      const empty = await app.inject({ method: 'POST', url: '/api/formulas/validate', payload: { source: '   ' } })
      expect(empty.statusCode).toBe(400)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('evaluate：独立证券只读输出、limit 生效、不写训练/画线/公式库', async () => {
    const { root, config, database } = await fixture()
    const app = await createApp(config, database)
    try {
      const created = await app.inject({ method: 'POST', url: '/api/formulas', payload: { name: 'MA2', placement: 'sub', source: validSource } })
      expect(created.statusCode).toBe(201)
      const before = ['trainings', 'trades', 'drawings', 'formulas'].map(table => countRows(database, table))
      const evaluated = await app.inject({ method: 'POST', url: '/api/formulas/evaluate', payload: { source: 'MA2:MA(CLOSE,2);', code: '600519', limit: 50 } })
      expect(evaluated.statusCode).toBe(200)
      const body = evaluated.json()
      expect(body.ok).toBe(true)
      expect(body.dataSource.kind).toBe('tdx')
      expect(body.dataSource.note).toContain('不复权')
      expect(body.bars).toHaveLength(3)
      expect(body.bars[2].date).toBe('2026-09-03')
      expect(body.outputs[0].name).toBe('MA2')
      expect(body.outputs[0].data).toHaveLength(3)
      expect(body.outputs[0].data[0]).toBeNull()
      expect(body.outputs[0].data[2]).toBeCloseTo((11 + 11.5) / 2, 6)
      const byId = await app.inject({ method: 'POST', url: '/api/formulas/evaluate', payload: { formulaId: created.json().id, code: '600519', limit: 100 } })
      expect(byId.statusCode).toBe(200)
      expect(byId.json().ok).toBe(true)
      const runtime = await app.inject({ method: 'POST', url: '/api/formulas/evaluate', payload: { source: 'A:UNKNOWN_FUNCTION(CLOSE);', code: '600519' } })
      expect(runtime.statusCode).toBe(200)
      expect(runtime.json().ok).toBe(false)
      const noData = await app.inject({ method: 'POST', url: '/api/formulas/evaluate', payload: { source: 'A:CLOSE;' } })
      expect(noData.statusCode).toBe(400)
      const after = ['trainings', 'trades', 'drawings', 'formulas'].map(table => countRows(database, table))
      expect(after).toEqual(before)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('完整 registerApi 暴露 /api/formulas（路由接入）', async () => {
    const { root, config, database } = await fixture()
    const app = Fastify()
    try {
      await registerApi(app, config, database)
      const list = await app.inject({ method: 'GET', url: '/api/formulas' })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual({ formulas: [] })
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
