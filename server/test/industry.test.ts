import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

  it('reads the verified TDX local source when no explicit map is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trainer-industry-tdx-'))
    const cache = join(root, 'T0002', 'hq_cache')
    await mkdir(cache, { recursive: true })
    const directory = Array.from({ length: 56 }, (_, index) => `Industry${index + 1}|X${String(index + 1).padStart(4, '0')}|2|||X${String(index + 1).padStart(4, '0')}|`).join('\n')
    await writeFile(join(cache, 'tdxzs3.cfg'), directory, 'utf8')
    await writeFile(join(cache, 'tdxhy.cfg'), '0|600519|X0001|||\n1|000602|X0002|||\n', 'utf8')
    const result = await loadIndustryCatalog({ industryMapPath: null, tdxRoot: root })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalog.entries).toHaveLength(56)
      expect(result.catalog.entries[0]).toMatchObject({ id: 'X0001', name: 'Industry1', codes: ['600519'] })
      expect(result.catalog.entries[1]).toMatchObject({ id: 'X0002', name: 'Industry2', codes: ['000602'] })
      expect(result.catalog.source).toContain('tdxzs3.cfg')
    }
  })

  it('explains missing TDX industry files instead of inventing a catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trainer-industry-no-files-'))
    const result = await loadIndustryCatalog({ industryMapPath: null, tdxRoot: root })
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('tdxzs3.cfg') })
  })

  it('accepts the current TDX five-character industry roots derived from tdxhy.cfg', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trainer-industry-roots-'))
    const cache = join(root, 'T0002', 'hq_cache')
    await mkdir(cache, { recursive: true })
    const rows = Array.from({ length: 56 }, (_, index) => {
      const rootCode = `T${String(index + 1).padStart(4, '0')}`
      return `行业${index + 1}|880${String(index + 1).padStart(3, '0')}|2|||${rootCode}|`
    })
    const memberships = Array.from({ length: 56 }, (_, index) => {
      const rootCode = `T${String(index + 1).padStart(4, '0')}`
      return `0|${String(600000 + index).padStart(6, '0')}|${rootCode}01|||`
    })
    await writeFile(join(cache, 'tdxzs3.cfg'), rows.join('\n'), 'utf8')
    await writeFile(join(cache, 'tdxhy.cfg'), memberships.join('\n'), 'utf8')
    const result = await loadIndustryCatalog({ industryMapPath: null, tdxRoot: root })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.catalog.entries[0].codes).toEqual(['600000'])
  })
})
