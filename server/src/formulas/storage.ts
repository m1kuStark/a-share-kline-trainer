import type { DatabaseSync } from 'node:sqlite'
import type { FormulaPlacement, FormulaRow } from './types.js'

export class FormulaStoreError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'FormulaStoreError'
  }
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const PLACEMENTS: FormulaPlacement[] = ['main', 'sub']
const MAX_SOURCE_LENGTH = 20000
const MAX_DESCRIPTION_LENGTH = 500

interface FormulaColumns {
  name: string
  description: string
  placement: FormulaPlacement
  source: string
  enabled: number
}

function mapRow(row: Record<string, unknown>): FormulaRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    placement: row.placement === 'sub' ? 'sub' : 'main',
    source: String(row.source),
    enabled: Number(row.enabled ?? 1),
    builtin: Number(row.builtin ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function listFormulaRows(database: DatabaseSync): FormulaRow[] {
  const rows = database.prepare(
    'SELECT id, name, description, placement, source, enabled, builtin, created_at, updated_at FROM formulas ORDER BY builtin DESC, name COLLATE NOCASE',
  ).all() as unknown as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function getFormulaRow(database: DatabaseSync, id: number): FormulaRow | null {
  const row = database.prepare(
    'SELECT id, name, description, placement, source, enabled, builtin, created_at, updated_at FROM formulas WHERE id = ?',
  ).get(id) as unknown as Record<string, unknown> | undefined
  return row ? mapRow(row) : null
}

export function getFormulaRowByName(database: DatabaseSync, name: string): FormulaRow | null {
  const row = database.prepare(
    'SELECT id, name, description, placement, source, enabled, builtin, created_at, updated_at FROM formulas WHERE name = ? COLLATE NOCASE',
  ).get(name) as unknown as Record<string, unknown> | undefined
  return row ? mapRow(row) : null
}

/** 输入校验：name 为 ASCII 标识符（供跨公式引用），description 中文说明，source 非空。 */
export function parseFormulaFields(raw: unknown, options: { partial: boolean }): Partial<FormulaColumns> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new FormulaStoreError('请求体必须是 JSON 对象')
  const body = raw as Record<string, unknown>
  const fields: Partial<FormulaColumns> = {}
  if (body.name !== undefined || !options.partial) {
    if (typeof body.name !== 'string') throw new FormulaStoreError('name 必填（公式名，ASCII 标识符，供跨公式引用）')
    const name = body.name.trim()
    if (!NAME_PATTERN.test(name)) throw new FormulaStoreError('name 必须是以字母/下划线开头、仅含字母数字下划线的 ASCII 名称（最长 64）')
    fields.name = name
  }
  if (body.description !== undefined || !options.partial) {
    const description = body.description === undefined ? '' : body.description
    if (typeof description !== 'string') throw new FormulaStoreError('description 必须是字符串')
    if (description.length > MAX_DESCRIPTION_LENGTH) throw new FormulaStoreError('description 最长 500 字符')
    fields.description = description
  }
  if (body.placement !== undefined || !options.partial) {
    const placement = body.placement
    if (typeof placement !== 'string' || !PLACEMENTS.includes(placement as FormulaPlacement)) {
      throw new FormulaStoreError("placement 必须是 'main' 或 'sub'")
    }
    fields.placement = placement as FormulaPlacement
  }
  if (body.source !== undefined || !options.partial) {
    if (typeof body.source !== 'string' || body.source.trim().length === 0) throw new FormulaStoreError('source 必填（公式源码不能为空）')
    if (body.source.length > MAX_SOURCE_LENGTH) throw new FormulaStoreError('公式源码最长 20000 字符')
    fields.source = body.source
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new FormulaStoreError('enabled 必须是布尔值')
    fields.enabled = body.enabled ? 1 : 0
  }
  return fields
}

export function createFormulaRow(database: DatabaseSync, fields: FormulaColumns, now = new Date().toISOString()): FormulaRow {
  try {
    const result = database.prepare(
      'INSERT INTO formulas (name, description, placement, source, enabled, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    ).run(fields.name, fields.description, fields.placement, fields.source, fields.enabled ?? 1, now, now)
    const id = Number(result.lastInsertRowid)
    const row = getFormulaRow(database, id)
    if (!row) throw new FormulaStoreError('公式创建后读取失败', 500)
    return row
  } catch (error) {
    throw mapSqliteError(error)
  }
}

export function updateFormulaRow(database: DatabaseSync, id: number, patch: Partial<FormulaColumns>, now = new Date().toISOString()): FormulaRow {
  const current = getFormulaRow(database, id)
  if (!current) throw new FormulaStoreError('公式不存在', 404)
  if (current.builtin === 1 && (patch.name !== undefined || patch.source !== undefined)) {
    throw new FormulaStoreError('内置示例公式不允许改名或改源码；可复制为新公式后编辑', 403)
  }
  const next = {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    placement: patch.placement ?? current.placement,
    source: patch.source ?? current.source,
    enabled: patch.enabled ?? current.enabled,
  }
  try {
    database.prepare('UPDATE formulas SET name = ?, description = ?, placement = ?, source = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.description, next.placement, next.source, next.enabled, now, id)
  } catch (error) {
    throw mapSqliteError(error)
  }
  const row = getFormulaRow(database, id)
  if (!row) throw new FormulaStoreError('公式更新后读取失败', 500)
  return row
}

export function deleteFormulaRow(database: DatabaseSync, id: number): boolean {
  const current = getFormulaRow(database, id)
  if (!current) return false
  if (current.builtin === 1) throw new FormulaStoreError('内置示例公式不可删除（可禁用）', 403)
  database.prepare('DELETE FROM formulas WHERE id = ?').run(id)
  return true
}

function mapSqliteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/UNIQUE constraint failed: formulas.name/i.test(message)) return new FormulaStoreError('公式名已存在（name 需唯一）', 409)
  return new FormulaStoreError('公式库写入失败：' + message, 500)
}
