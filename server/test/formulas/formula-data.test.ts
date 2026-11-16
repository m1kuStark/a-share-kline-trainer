import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase } from '../../src/db.js'
import type { AppConfig } from '../../src/config.js'
import { tdxFormulaData, timestampOfDate } from '../../src/formulas/data.js'

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
  const root = await mkdtemp(join(tmpdir(), 'tdx-formula-data-'))
  await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), Buffer.concat([
    dayRecord(20020723, 20, 22, 19, 21, 100, 10),
    dayRecord(20020724, 21, 23, 20, 22, 200, 20),
    dayRecord(20020725, 22, 24, 21, 23, 300, 30),
  ]))
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  database.prepare('INSERT INTO stocks (code, market, name, type, bars, mtime, last_date) VALUES (?,?,?,?,?,?,?)')
    .run('600519', 'sh', '贵州茅台', 'A', 3, '2026-01-01', '2002-07-25')
  return { root, config, database }
}

describe('M9-04A 求值数据源', () => {
  it('本地日历日 → 本地午夜毫秒', () => {
    expect(timestampOfDate('2002-07-24')).toBe(new Date(2002, 6, 24).getTime())
  })

  it('独立证券：TDX 日线最近 N 根、不复权标注、名称来自 stocks', async () => {
    const { root, config, database } = await fixture()
    try {
      const data = await tdxFormulaData(database, config, '600519', 2)
      expect(data.source).toBe('tdx')
      expect(data.note).toContain('不复权')
      expect(data.bars).toHaveLength(2)
      expect(data.dates).toEqual(['2002-07-24', '2002-07-25'])
      expect(data.bars[1].close).toBeCloseTo(23, 6)
      expect(data.bars[1].timestamp).toBe(timestampOfDate('2002-07-25'))
      expect((data.stockContext as { name?: string } | null)?.name).toBe('贵州茅台')
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('非法代码/缺失日线返回业务错误而不是 500', async () => {
    const { root, config, database } = await fixture()
    try {
      await expect(tdxFormulaData(database, config, 'not-a-code', 10)).rejects.toThrowError(/code 非法/)
      await expect(tdxFormulaData(database, config, '300750', 10)).rejects.toThrowError(/日线缺失或不可读/)
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
