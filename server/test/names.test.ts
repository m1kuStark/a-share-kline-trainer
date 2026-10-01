import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStockNames, parseBaseDbf, parsePttabFile, parseTnfFile } from '../src/tdx/names.js'

describe('TDX TNF names', () => {
  it('reads a GBK stock name at the byte offset used by the local TNF files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tnf-name-'))
    const file = join(dir, 'shs.tnf')
    const buffer = Buffer.alloc(180)
    buffer.write('600519', 50, 'ascii')
    Buffer.from('b9f3d6ddc3a9cca8', 'hex').copy(buffer, 81)
    await writeFile(file, buffer)

    try {
      await expect(parseTnfFile(file, 'sh')).resolves.toContainEqual({ code: '600519', market: 'sh', name: '贵州茅台' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('merges base.dbf names for codes missing from a partial TNF file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tdx-name-merge-'))
    const cache = join(root, 'T0002', 'hq_cache')
    await mkdir(cache, { recursive: true })
    const tnf = Buffer.alloc(180)
    tnf.write('000601', 50, 'ascii')
    Buffer.from('c4dcc4dc', 'hex').copy(tnf, 81)
    await writeFile(join(cache, 'szs.tnf'), tnf)
    const fields = [
      { name: 'GPDM', length: 6 },
      { name: 'GPMC', length: 20 },
    ]
    const headerLength = 32 + fields.length * 32 + 1
    const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0)
    const dbf = Buffer.alloc(headerLength + recordLength * 2 + 1)
    dbf[0] = 0x03
    dbf.writeUInt32LE(2, 4)
    dbf.writeUInt16LE(headerLength, 8)
    dbf.writeUInt16LE(recordLength, 10)
    fields.forEach((field, index) => {
      const offset = 32 + index * 32
      Buffer.from(field.name, 'ascii').copy(dbf, offset)
      dbf[offset + 11] = 0x43
      dbf[offset + 16] = field.length
    })
    dbf[32 + fields.length * 32] = 0x0d
    const rows: Array<[string, string, string]> = [['000602', '盛达资源', 'caa2b4efd7cad4b4'], ['000606', '青海华鼎', 'c7e0baa3bbaab6a6']]
    rows.forEach((row, index) => {
      const start = headerLength + index * recordLength
      dbf[start] = 0x20
      Buffer.from(row[0], 'ascii').copy(dbf, start + 1)
      Buffer.from(row[2], 'hex').copy(dbf, start + 1 + fields[0].length)
    })
    dbf[dbf.length - 1] = 0x1a
    await writeFile(join(cache, 'base.dbf'), dbf)
    try {
      await expect(parseBaseDbf(join(cache, 'base.dbf'))).resolves.toEqual(expect.arrayContaining([
        { code: '000602', market: 'sz', name: '盛达资源' },
        { code: '000606', market: 'sz', name: '青海华鼎' },
      ]))
      const names = await loadStockNames(root, 'sz')
      expect(names.find(item => item.code === '000602')?.name).toBe('盛达资源')
      expect(names.find(item => item.code === '000606')?.name).toBe('青海华鼎')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses pttab.dat as the fallback for inactive stock names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pttab-name-'))
    const file = join(dir, 'pttab.dat')
    await writeFile(file, Buffer.from('302c3030303630322cbdf0c2edbcafcdc50d0a302c3030303630362ccbb3c0fbb0ec0d0a', 'hex'))
    try {
      // UTF-8 fixtures are accepted by the parser when they contain no GBK-only bytes.
      const parsed = await parsePttabFile(file)
      expect(parsed).toEqual([
        { code: '000602', market: 'sz', name: '金马集团' },
        { code: '000606', market: 'sz', name: '顺利办' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
