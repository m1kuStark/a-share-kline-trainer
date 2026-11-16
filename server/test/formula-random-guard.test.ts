import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FormulaEngine, scanFutureFunctions } from '../../web/src/formula-engine/index'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import type { FormulaEngineModule } from '../src/formulas/engine.js'
import { registerFormulaRoutes } from '../src/formulas/api.js'

// M7-01 随机训练：训练 bars 由 mock 提供，专注验证 evaluate 出口不泄露日期/代码/名称
vi.mock('../src/train/engine.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/train/engine.js')>()
  const mockBars = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map((date, index) => ({
    date, open: 10 + index, high: 11 + index, low: 9 + index, close: 10 + index, volume: 100, amount: 1000,
  }))
  return { ...actual, trainingBars: async () => mockBars }
})

const engineModule = { FormulaEngine, scanFutureFunctions } as unknown as FormulaEngineModule

async function fixture(): Promise<{ root: string; config: AppConfig; database: DatabaseSync }> {
  const root = await mkdtemp(join(tmpdir(), 'formula-random-'))
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  return { root, config, database }
}

function insertRandomTraining(database: DatabaseSync, mode: string, offsetDays: number | null): number {
  const result = database.prepare(
    "INSERT INTO trainings (tier, code, name, market, status, start_date, planned_end, initial_cash, created_at, random_mode, random_time_offset_days, range_bar_count) VALUES ('A','600519','贵州茅台','sh','running','2026-08-01','2026-10-01',100000,'2026-08-01T00:00:00Z',?,?,5)",
  ).run(mode, offsetDays)
  return Number(result.lastInsertRowid)
}

describe('M9-04A 随机训练 evaluate 信息遮蔽（M7-01 不旁路）', () => {
  it('random_time：返回日期按会话偏移遮蔽并告警', async () => {
    const { root, config, database } = await fixture()
    const app = Fastify()
    registerFormulaRoutes(app, config, database, { engine: async () => engineModule })
    try {
      const id = insertRandomTraining(database, 'random_time', 30)
      const response = await app.inject({ method: 'POST', url: '/api/formulas/evaluate', payload: { source: 'A:CLOSE;', trainingId: id } })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.ok).toBe(true)
      expect(body.bars[0].date).toBe('2026-10-01')
      expect(body.bars[0].timestamp).toBe(new Date(2026, 9, 1).getTime())
      expect(body.warnings.join()).toContain('随机训练会话')
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('random_stock：不注入 StockContext，隐藏名称/代码无法被逐字探测', async () => {
    const { root, config, database } = await fixture()
    const app = Fastify()
    registerFormulaRoutes(app, config, database, { engine: async () => engineModule })
    try {
      const id = insertRandomTraining(database, 'random_stock', null)
      const response = await app.inject({ method: 'POST', url: '/api/formulas/evaluate', payload: { source: "A:NAMELIKE('贵');", trainingId: id } })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.ok).toBe(false)
      expect(body.error.message).toMatch(/运行错误/)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
