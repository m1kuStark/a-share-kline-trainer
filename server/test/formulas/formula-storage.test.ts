import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../../src/db.js'
import {
  createFormulaRow, deleteFormulaRow, getFormulaRow, listFormulaRows, parseFormulaFields, updateFormulaRow, FormulaStoreError,
} from '../../src/formulas/storage.js'

function freshDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  return database
}

function fields(overrides: Record<string, unknown> = {}) {
  return parseFormulaFields({ name: 'MY_MA', description: '五日均线', placement: 'main', source: 'MA5:MA(CLOSE,5);', ...overrides }, { partial: false })
}

describe('M9-04A formula storage', () => {
  it('迁移出 formulas 表且不触碰既有表', () => {
    const database = freshDatabase()
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as unknown as Array<{ name: string }>
    const names = tables.map(row => row.name)
    expect(names).toContain('formulas')
    expect(names).toContain('trainings')
    expect(names).toContain('trades')
    expect(names).toContain('drawings')
    database.close()
  })

  it('CRUD 持久化：创建/读取/更新/删除，重启（重开库）后仍在', () => {
    const file = ':memory:'
    const database = new DatabaseSync(file)
    migrateDatabase(database)
    const created = createFormulaRow(database, fields() as never)
    expect(created.id).toBeGreaterThan(0)
    expect(created.name).toBe('MY_MA')
    expect(created.placement).toBe('main')
    expect(created.enabled).toBe(1)
    expect(listFormulaRows(database)).toHaveLength(1)
    const updated = updateFormulaRow(database, created.id, { placement: 'sub', description: '副图均线' })
    expect(updated.placement).toBe('sub')
    expect(updated.description).toBe('副图均线')
    expect(getFormulaRow(database, created.id)?.placement).toBe('sub')
    expect(deleteFormulaRow(database, created.id)).toBe(true)
    expect(getFormulaRow(database, created.id)).toBeNull()
    database.close()
  })

  it('输入校验：name ASCII 标识符/placement/source 非空；重复名 409', () => {
    expect(() => parseFormulaFields({ name: '1BAD', placement: 'main', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: '中文名', placement: 'main', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: 'OK', placement: 'other', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: 'OK', placement: 'main', source: '   ' }, { partial: false })).toThrow(FormulaStoreError)
    const database = freshDatabase()
    createFormulaRow(database, fields({ name: 'DUP' }) as never)
    expect(() => createFormulaRow(database, fields({ name: 'dup' }) as never)).toThrowError(/公式名已存在/)
    database.close()
  })

  it('内置公式不可改名/删源码（M9-04D 预留保护）', () => {
    const database = freshDatabase()
    const created = createFormulaRow(database, fields() as never)
    database.prepare('UPDATE formulas SET builtin = 1 WHERE id = ?').run(created.id)
    expect(() => updateFormulaRow(database, created.id, { source: 'A:1;' })).toThrowError(/内置示例公式/)
    expect(() => deleteFormulaRow(database, created.id)).toThrowError(/不可删除/)
    database.close()
  })
})
