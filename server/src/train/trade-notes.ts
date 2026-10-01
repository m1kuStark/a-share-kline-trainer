import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from './engine.js'

const MAX_NOTE_LENGTH = 4000

function requireTrade(database: DatabaseSync, trainingId: number, seq: number): void {
  if (!Number.isSafeInteger(trainingId) || trainingId < 1 || !Number.isSafeInteger(seq) || seq < 1) {
    throw new HttpError(400, 'training id and trade sequence must be positive integers')
  }
  if (!database.prepare('SELECT id FROM trainings WHERE id = ?').get(trainingId)) throw new HttpError(404, 'Training not found')
  if (!database.prepare('SELECT id FROM trades WHERE training_id = ? AND seq = ?').get(trainingId, seq)) throw new HttpError(404, 'Trade not found')
}

export function readTradeNote(database: DatabaseSync, trainingId: number, seq: number): { note: string; updatedAt: string | null } {
  requireTrade(database, trainingId, seq)
  const row = database.prepare('SELECT note, updated_at FROM trade_notes WHERE training_id = ? AND trade_seq = ?').get(trainingId, seq) as { note?: string; updated_at?: string } | undefined
  return { note: row?.note ?? '', updatedAt: row?.updated_at ?? null }
}

export function writeTradeNote(database: DatabaseSync, trainingId: number, seq: number, value: unknown): { note: string; updatedAt: string } {
  requireTrade(database, trainingId, seq)
  if (typeof value !== 'string' || value.length > MAX_NOTE_LENGTH) throw new HttpError(400, `note must be text of at most ${MAX_NOTE_LENGTH} characters`)
  const updatedAt = new Date().toISOString()
  database.prepare(`
    INSERT INTO trade_notes (training_id, trade_seq, note, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(training_id, trade_seq) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run(trainingId, seq, value, updatedAt)
  return { note: value, updatedAt }
}
