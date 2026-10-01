import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import { equityComparison } from '../src/train/equity-comparison.js'

function dayRecord(date: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(close * 100), 4)
  buffer.writeInt32LE(Math.round(close * 100), 8)
  buffer.writeInt32LE(Math.round(close * 100), 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(100, 20)
  buffer.writeInt32LE(100, 24)
  return buffer
}

async function writeIndexFile(root: string, market: 'sh' | 'sz', file: string, rows: Array<[number, number]>): Promise<void> {
  const directory = join(root, 'vipdoc', market, 'lday')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, file), Buffer.concat(rows.map(([date, close]) => dayRecord(date, close))))
}

function insertSettledTraining(database: DatabaseSync): void {
  database.prepare(`
    INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, initial_cash, created_at, settle_date)
    VALUES ('1M', '600519', '贵州茅台', 'sh', '2026-09-01', '2026-09-05', 'settled', 100000, '2026-08-31', '2026-09-04')
  `).run()
  database.prepare(`
    INSERT INTO equity_curve (training_id, date, equity)
    VALUES (1, '2026-09-01', 100000), (1, '2026-09-02', 105000), (1, '2026-09-04', 110000)
  `).run()
}

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

  it('keeps equity dates fixed while independently aligning both benchmark series', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tdx-equity-comparison-'))
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    insertSettledTraining(database)
    await writeIndexFile(root, 'sh', 'sh000001.day', [
      [20260831, 100], [20260901, 110], [20260903, 120], [20260904, 130],
    ])
    await writeIndexFile(root, 'sz', 'sz399303.day', [
      [20260831, 200], [20260902, 220], [20260904, 210],
    ])

    try {
      const result = await equityComparison(database, { tdxRoot: root } as never, 1, ['sh000001', 'sz399303'])
      expect(result.benchmarks).toEqual({ sh000001: { ok: true }, sz399303: { ok: true } })
      expect(result.series.map(point => point.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04'])
      expect(result.series.map(point => point.user)).toEqual([0, 0.05, 0.1])

      // 上证指数缺少 9/2：收益沿用前一个可用点，但不能删除/挪动用户的 9/2 日期。
      expect(result.series.map(point => point.sh000001)).toEqual([0, 0, 130 / 110 - 1])
      // 国证 2000 在 9/1 尚无可用点；后续点必须仍落在各自日期上。
      expect(result.series[0]).not.toHaveProperty('sz399303')
      expect(result.series[1].sz399303).toBeCloseTo(0.1, 12)
      expect(result.series[2].sz399303).toBeCloseTo(0.05, 12)
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains the user curve and reports an explicit status when one benchmark file is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tdx-equity-comparison-missing-'))
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    insertSettledTraining(database)
    await writeIndexFile(root, 'sh', 'sh000001.day', [
      [20260831, 100], [20260901, 110], [20260904, 130],
    ])

    try {
      const result = await equityComparison(database, { tdxRoot: root } as never, 1, ['sh000001', 'sz399303'])
      expect(result.series.map(point => point.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04'])
      expect(result.series.map(point => point.user)).toEqual([0, 0.05, 0.1])
      expect(result.benchmarks.sh000001).toEqual({ ok: true })
      expect(result.benchmarks.sz399303).toMatchObject({ ok: false })
      expect(result.benchmarks.sz399303.reason).toContain('日线缺失或不可读')
      expect(result.series.every(point => point.sz399303 === undefined)).toBe(true)
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
