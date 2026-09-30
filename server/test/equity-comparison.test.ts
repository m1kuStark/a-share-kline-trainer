import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import { equityComparison } from '../src/train/equity-comparison.js'

describe('equity comparison', () => {
  it('returns persisted user rates and explicit unavailable reasons without TDX', async () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    database.prepare(`INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, initial_cash, created_at, settle_date) VALUES ('1M','600519','贵州茅台','sh','2026-08-03','2026-09-03','settled',100000,'2026-08-01','2026-08-04')`).run()
    database.prepare("INSERT INTO equity_curve (training_id,date,equity) VALUES (1,'2026-08-03',100000),(1,'2026-08-04',110000)").run()
    const result = await equityComparison(database, { tdxRoot: null } as never, 1, ['sh000001', 'sz399303'])
    expect(result.series.map(point => point.user)).toEqual([0, 0.1])
    expect(result.benchmarks.sh000001.ok).toBe(false)
    expect(result.benchmarks.sz399303.reason).toContain('未连接')
    database.close()
  })
})
