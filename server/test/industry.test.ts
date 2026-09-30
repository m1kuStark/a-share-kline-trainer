import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { loadIndustryCatalog } from '../src/tdx/industry.js'

function entries(count = 56) {
  return Array.from({ length: count }, (_, index) => ({ id: `I${index + 1}`, name: `行业${index + 1}`, codes: index === 0 ? ['600519'] : [] }))
}

describe('explicit industry catalog', () => {
  it('rejects missing configuration and non-56 catalogs without scanning TDX', async () => {
    expect((await loadIndustryCatalog({ industryMapPath: null })).ok).toBe(false)
    const root = await mkdtemp(join(tmpdir(), 'trainer-industry-'))
    const path = join(root, 'industry.json')
    await writeFile(path, JSON.stringify({ version: 'test', industries: entries(2) }), 'utf8')
    const result = await loadIndustryCatalog({ industryMapPath: path })
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('56') })
  })

  it('accepts exactly 56 entries and returns a content hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trainer-industry-'))
    const path = join(root, 'industry.json')
    await writeFile(path, JSON.stringify({ version: 'tdx-2026', industries: entries() }), 'utf8')
    const result = await loadIndustryCatalog({ industryMapPath: path })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalog.entries).toHaveLength(56)
      expect(result.catalog.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
