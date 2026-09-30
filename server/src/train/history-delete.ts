import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from './engine.js'

export const HISTORY_DELETE_MAX_IDS = 100

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/** Parse the bounded id list used by the history batch-delete endpoint. */
export function parseHistoryDeleteIds(raw: unknown): number[] {
  const ids = (raw as { ids?: unknown } | undefined)?.ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > HISTORY_DELETE_MAX_IDS) {
    throw new HttpError(400, `ids 必须是 1~${HISTORY_DELETE_MAX_IDS} 个训练 ID 的数组`, 'INVALID_INPUT')
  }
  const parsed = ids.map(value => Number(value))
  if (parsed.some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new HttpError(400, 'ids 必须全部是正整数', 'INVALID_INPUT')
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new HttpError(400, 'ids 不能包含重复训练 ID', 'INVALID_INPUT')
  }
  return parsed
}

/**
 * Delete settled training facts as one transaction. All rows are validated
 * before the first DELETE so a batch can never partially remove history.
 */
export function deleteSettledTrainings(database: DatabaseSync, ids: readonly number[]): number[] {
  if (ids.length < 1 || ids.length > HISTORY_DELETE_MAX_IDS) {
    throw new HttpError(400, `ids 必须是 1~${HISTORY_DELETE_MAX_IDS} 个训练 ID 的数组`, 'INVALID_INPUT')
  }
  const unique = [...new Set(ids)]
  if (unique.length !== ids.length || unique.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new HttpError(400, 'ids 必须是互不重复的正整数', 'INVALID_INPUT')
  }
  const marks = placeholders(unique.length)
  const rows = database.prepare(`SELECT id, status FROM trainings WHERE id IN (${marks})`).all(...unique) as unknown as Array<{ id: number; status: string }>
  const found = new Set(rows.map(row => row.id))
  const missing = unique.find(id => !found.has(id))
  if (missing !== undefined) {
    throw new HttpError(404, `训练 ${missing} 不存在`, 'HISTORY_NOT_FOUND')
  }
  const unsettled = rows.find(row => row.status !== 'settled')
  if (unsettled) {
    throw new HttpError(409, `训练 ${unsettled.id} 尚未结算，不能删除历史记录`, 'HISTORY_NOT_SETTLED')
  }

  const transactionMarks = placeholders(unique.length)
  database.exec('BEGIN IMMEDIATE')
  try {
    // These tables predate foreign-key enforcement; explicit cleanup keeps
    // deletion correct for both old and newly created databases.
    for (const table of ['drawings', 'trades', 'equity_curve', 'position_events']) {
      database.prepare(`DELETE FROM ${table} WHERE training_id IN (${transactionMarks})`).run(...unique)
    }
    database.prepare(`DELETE FROM trainings WHERE id IN (${transactionMarks})`).run(...unique)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return [...unique]
}
