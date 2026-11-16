import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase } from '../../src/db.js'
import {
  createFormulaRow, deleteFormulaRow, getFormulaRow, listFormulaRows, parseFormulaFields, updateFormulaRow, FormulaStoreError,
} from '../../src/formulas/storage.js'

function fields(overrides: Record<string, unknown> = {}) {
  return parseFormulaFields({ name: 'MY_MA', description: '五日均线', placement: 'main', source: 'MA5:MA(CLOSE,5);', ...overrides }, { partial: false })
}

describe('M9-04A formula storage', () => {
  it('迁移出 formulas 表且不触碰既有表', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as unknown as Array<{ name: string }>
    const names = tables.map(row => row.name)
    expect(names).toContain('formulas')
    expect(names).toContain('trainings')
    expect(names).toContain('trades')
    expect(names).toContain('drawings')
    database.close()
  })

  it('CRUD 持久化：文件库关闭重开后仍在；删除不影响训练/成交/画线计数', () => {
    const root = mkdtempSync(join(tmpdir(), 'formula-storage-'))
    const file = join(root, 'trainer.sqlite')
    const database = new DatabaseSync(file)
    migrateDatabase(database)
    try {
      const created = createFormulaRow(database, fields() as never)
      expect(created.id).toBeGreaterThan(0)
      expect(created.name).toBe('MY_MA')
      expect(created.placement).toBe('main')
      expect(created.enabled).toBe(1)
      database.prepare("INSERT INTO trainings (tier, code, name, status, start_date, planned_end, initial_cash, created_at) VALUES ('A','600519','贵州茅台','running','2026-01-01','2026-02-01',100000,'2026-01-01T00:00:00Z')").run()
      const countsBefore = ['trainings', 'trades', 'drawings'].map(table => Number((database.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as unknown as { n: number }).n))
      database.close()
      const reopened = new DatabaseSync(file)
      migrateDatabase(reopened)
      try {
        expect(listFormulaRows(reopened)).toHaveLength(1)
        const updated = updateFormulaRow(reopened, created.id, { placement: 'sub', description: '副图均线' })
        expect(updated.placement).toBe('sub')
        expect(deleteFormulaRow(reopened, created.id)).toBe(true)
        expect(getFormulaRow(reopened, created.id)).toBeNull()
        const countsAfter = ['trainings', 'trades', 'drawings'].map(table => Number((reopened.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as unknown as { n: number }).n))
        expect(countsAfter).toEqual(countsBefore)
      } finally {
        reopened.close()
      }
    } finally {
      try { database.close() } catch { /* already closed */ }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('输入校验：名称长度/空白/全数字、placement 可选默认 main、source 非空；重复名 409', () => {
    expect(() => parseFormulaFields({ name: 'has space', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: '   ', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: '12345', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: 'OK', placement: 'other', source: 'A:1;' }, { partial: false })).toThrow(FormulaStoreError)
    expect(() => parseFormulaFields({ name: 'OK', source: '   ' }, { partial: false })).toThrow(FormulaStoreError)
    const parsed = parseFormulaFields({ name: '公式一', source: 'A:1;' }, { partial: false })
    expect(parsed.placement).toBe('main')
    expect(parsed.name).toBe('公式一')
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    try {
      createFormulaRow(database, fields({ name: 'DUP' }) as never)
      expect(() => createFormulaRow(database, fields({ name: 'dup' }) as never)).toThrowError(/公式名已存在/)
    } finally {
      database.close()
    }
  })

  it('内置公式不可改名/改源码/删除（M9-04D 预留保护）', () => {
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    try {
      const created = createFormulaRow(database, fields() as never)
      database.prepare('UPDATE formulas SET builtin = 1 WHERE id = ?').run(created.id)
      expect(() => updateFormulaRow(database, created.id, { source: 'A:1;' })).toThrowError(/内置示例公式/)
      expect(() => deleteFormulaRow(database, created.id)).toThrowError(/不可删除/)
    } finally {
      database.close()
    }
  })
})
