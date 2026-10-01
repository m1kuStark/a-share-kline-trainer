import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import { readTradeNote, writeTradeNote } from '../src/train/trade-notes.js'

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  database.prepare(`INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, initial_cash, created_at)
    VALUES ('1M', '600519', '贵州茅台', 'sh', '2026-01-01', '2026-02-01', 'running', 1000000, '2026-01-01T00:00:00.000Z')`).run()
  database.prepare(`INSERT INTO trades (training_id, seq, trade_date, side, price, shares, amount, fee, cash_after, shares_after, cost_after)
    VALUES (1, 1, '2026-01-02', 'buy', 100, 100, 10000, 0, 990000, 100, 10000)`).run()
  return database
}

describe('trade notes', () => {
  it('reads empty and round-trips a note per training/trade', () => {
    const database = fixture()
    try {
      expect(readTradeNote(database, 1, 1).note).toBe('')
      const saved = writeTradeNote(database, 1, 1, '突破后回踩确认')
      expect(saved.note).toBe('突破后回踩确认')
      expect(readTradeNote(database, 1, 1)).toMatchObject({ note: '突破后回踩确认' })
      writeTradeNote(database, 1, 1, '')
      expect(readTradeNote(database, 1, 1).note).toBe('')
    } finally { database.close() }
  })

  it('rejects unknown trades and oversized notes', () => {
    const database = fixture()
    try {
      expect(() => readTradeNote(database, 1, 99)).toThrow('Trade not found')
      expect(() => writeTradeNote(database, 1, 1, 'x'.repeat(4001))).toThrow('at most 4000')
    } finally { database.close() }
  })
})
