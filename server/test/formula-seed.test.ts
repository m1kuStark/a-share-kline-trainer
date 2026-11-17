import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import { FormulaEngine, scanFutureFunctions } from '../../web/src/formula-engine/index'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import type { FormulaEngineModule } from '../src/formulas/engine.js'
import { registerFormulaRoutes } from '../src/formulas/api.js'
import { evaluateOnBars, validateSource } from '../src/formulas/evaluate.js'
import { BUILTIN_FORMULAS, seedBuiltinFormulas } from '../src/formulas/seed.js'
import type { FormulaBar } from '../src/formulas/types.js'

const engineModule = { FormulaEngine, scanFutureFunctions } as unknown as FormulaEngineModule
const engineProvider = async () => engineModule

const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: null }

function freshDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  return database
}

function builtinRows(database: DatabaseSync): Array<{ id: number; name: string; builtin: number; enabled: number; placement: string; source: string; description: string }> {
  return database.prepare('SELECT id, name, builtin, enabled, placement, source, description FROM formulas ORDER BY name').all() as unknown as Array<{ id: number; name: string; builtin: number; enabled: number; placement: string; source: string; description: string }>
}

function syntheticBars(count: number): { bars: FormulaBar[]; dates: string[] } {
  const dates: string[] = []
  const bars: FormulaBar[] = []
  for (let index = 0; index < count; index += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + index))
    const date = day.toISOString().slice(0, 10)
    const close = 10 + index * 0.1
    dates.push(date)
    bars.push({ timestamp: day.getTime(), open: close - 0.05, high: close + 0.1, low: close - 0.1, close, volume: 1000 + index, amount: (1000 + index) * close })
  }
  return { bars, dates }
}

describe('M9-04D 内置示例公式 seed', () => {
  it('空库幂等写入 3 个内置示例，重复 seed 不重复', () => {
    const database = freshDatabase()
    try {
      expect(seedBuiltinFormulas(database)).toBe(3)
      const rows = builtinRows(database)
      expect(rows).toHaveLength(3)
      expect(rows.map(row => row.name).sort()).toEqual(['MA_BULL_MAIN', 'QINIU_B1_SUB', 'WEEK_MACD_SUB'])
      expect(rows.every(row => row.builtin === 1)).toBe(true)
      // 内置示例默认停用；用户在设置中开启后，后续初始化保留其选择。
      expect(rows.every(row => row.enabled === 0)).toBe(true)
      expect(rows.find(row => row.name === 'WEEK_MACD_SUB')?.placement).toBe('sub')
      expect(rows.find(row => row.name === 'MA_BULL_MAIN')?.placement).toBe('main')
      expect(rows.find(row => row.name === 'QINIU_B1_SUB')?.placement).toBe('sub')
      for (const row of rows) expect(row.source.length).toBeGreaterThan(0)

      database.prepare('UPDATE formulas SET enabled = 1 WHERE name = ?').run('MA_BULL_MAIN')
      expect(seedBuiltinFormulas(database)).toBe(0)
      const reseeded = builtinRows(database)
      expect(reseeded).toHaveLength(3)
      expect(reseeded.find(row => row.name === 'MA_BULL_MAIN')?.enabled).toBe(1)
      expect(reseeded.filter(row => row.name !== 'MA_BULL_MAIN').every(row => row.enabled === 0)).toBe(true)
    } finally {
      database.close()
    }
  })

  it('不覆盖已存在的同名公式与既有内置描述（用户数据优先）', () => {
    const database = freshDatabase()
    try {
      database.prepare("INSERT INTO formulas (name, description, placement, source, enabled, builtin, created_at, updated_at) VALUES ('WEEK_MACD_SUB', '用户自己的同名公式', 'main', 'USER:CLOSE;', 1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run()
      expect(seedBuiltinFormulas(database)).toBe(2)
      const rows = builtinRows(database)
      expect(rows).toHaveLength(3)
      const userRow = rows.find(row => row.name === 'WEEK_MACD_SUB')
      expect(userRow?.builtin).toBe(0)
      expect(userRow?.source).toBe('USER:CLOSE;')

      // 既有内置行只做幂等占位，不改写描述/source（升级不覆盖）
      const maRow = rows.find(row => row.name === 'MA_BULL_MAIN')!
      database.prepare('UPDATE formulas SET description = ? WHERE id = ?').run('用户改过的描述（允许）', maRow.id)
      expect(seedBuiltinFormulas(database)).toBe(0)
      expect(builtinRows(database).find(row => row.name === 'MA_BULL_MAIN')?.description).toBe('用户改过的描述（允许）')
    } finally {
      database.close()
    }
  })

  it('内置公式不可删除/改源码（服务端 403），可禁用', async () => {
    const database = freshDatabase()
    const app = Fastify()
    try {
      seedBuiltinFormulas(database)
      registerFormulaRoutes(app, config, database, { engine: engineProvider })
      const list = await app.inject({ method: 'GET', url: '/api/formulas' })
      expect(list.statusCode).toBe(200)
      const formulas = list.json().formulas as Array<{ id: number; name: string; builtin: boolean }>
      expect(formulas.filter(formula => formula.builtin)).toHaveLength(3)
      const target = formulas.find(formula => formula.name === 'MA_BULL_MAIN')!
      expect((await app.inject({ method: 'DELETE', url: '/api/formulas/' + target.id })).statusCode).toBe(403)
      const changeSource = await app.inject({ method: 'PUT', url: '/api/formulas/' + target.id, payload: { source: 'A:CLOSE;' } })
      expect(changeSource.statusCode).toBe(403)
      const disable = await app.inject({ method: 'PUT', url: '/api/formulas/' + target.id, payload: { enabled: false } })
      expect(disable.statusCode).toBe(200)
      expect(disable.json().enabled).toBe(false)
    } finally {
      await app.close()
      database.close()
    }
  })

  it('内置示例源码可通过引擎校验与求值（含周线跨周期引用）', () => {
    const engine = new FormulaEngine()
    const { bars, dates } = syntheticBars(90)
    for (const builtin of BUILTIN_FORMULAS) {
      const validation = validateSource(engineModule, builtin.source)
      expect(validation.ok, builtin.name + ' 应可解析').toBe(true)
      const result = evaluateOnBars(engineModule, { source: builtin.source, bars, dates, limit: bars.length })
      expect(result.ok, builtin.name + ' 应可求值').toBe(true)
      if (!result.ok) continue
      expect(result.outputs.length).toBeGreaterThan(0)
      expect(result.outputs.every(line => line.data.length === bars.length)).toBe(true)
    }
    expect(typeof engine.parse).toBe('function')
  })
})
