// PORT-UPD-01 发布管线扩展单测：
//   ① latest.yml 追加便携 exe 条目（extendLatestYmlWithPortable）——oracle＝release-desktop-lib.mjs
//     的 parseLatestYml（独立解析器，非被测代码回显）；
//   ② migrate-v127.zip 纯 Node STORE 型 zip 写入器（buildStoredZip）——oracle＝server
//     UPD-01 zip 读取器（listZipEntries/readZipEntry，CRC 与条目字节独立校验）；
//   ③ collectMigrateZipEntries 目录收集——oracle＝测试自建临时树。
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStoredZip, collectMigrateZipEntries, extendLatestYmlWithPortable } from '../scripts/release-desktop.mjs'
import { parseLatestYml, renderLatestYml } from '../scripts/release-desktop-lib.mjs'
import { listZipEntries, readZipEntry } from '../../server/src/update/zip.ts'

const sha512Base64 = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

describe('PORT-UPD-01 latest.yml 便携条目扩展', () => {
  const baseText = renderLatestYml({
    version: '1.2.7',
    fileName: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
    sha512Base64: sha512Base64(new Uint8Array([1, 2, 3])),
    size: 3,
    releaseDate: '2026-10-11T00:00:00.000Z',
  })
  const portable = {
    url: 'kline-trainer-desktop-v1.2.7-windows-x64.exe',
    sha512: sha512Base64(new Uint8Array([9, 9, 9])),
    size: 9,
  }

  it('追加便携条目后 lib 解析器读出第三个 files 条目且字段逐项吻合（setup/path 原样保留）', () => {
    const extended = extendLatestYmlWithPortable({
      text: baseText,
      fileName: portable.url,
      sha512Base64: portable.sha512,
      size: portable.size,
    })
    const parsed = parseLatestYml(extended)
    expect(parsed.version).toBe('1.2.7')
    expect(parsed.path).toBe('kline-trainer-desktop-setup-v1.2.7-windows-x64.exe')
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0].url).toBe('kline-trainer-desktop-setup-v1.2.7-windows-x64.exe')
    expect(parsed.files[1]).toEqual(portable)
  })

  it('幂等：已含便携条目时原样返回（不重复追加）', () => {
    const extended = extendLatestYmlWithPortable({
      text: baseText, fileName: portable.url, sha512Base64: portable.sha512, size: portable.size,
    })
    expect(extendLatestYmlWithPortable({
      text: extended, fileName: portable.url, sha512Base64: portable.sha512, size: portable.size,
    })).toBe(extended)
  })
})

describe('PORT-UPD-01 migrate-v127.zip 纯 Node zip 写入器', () => {
  it('STORE 型 zip 可被 UPD-01 读取器解析：条目名/字节逐一吻合（CRC 由读取器强制校验）', () => {
    const entries = [
      { name: 'migrate-v127/export-v127.cjs', data: Buffer.from('console.log("v127")\n'.repeat(50)) },
      { name: 'migrate-v127/迁移说明.md', data: Buffer.from('# 迁移说明\n中文内容。\n') },
      { name: 'migrate-v127/导出训练录像.cmd', data: Buffer.from('@echo off\r\n') },
    ]
    const zip = buildStoredZip(entries)
    const parsed = listZipEntries(Buffer.from(zip))
    expect(parsed.map(entry => entry.name).sort()).toEqual(entries.map(entry => entry.name).sort())
    for (const entry of entries) {
      const zipEntry = parsed.find(candidate => candidate.name === entry.name)
      expect(zipEntry).toBeDefined()
      expect(readZipEntry(Buffer.from(zip), zipEntry!).equals(entry.data)).toBe(true)
    }
  })

  it('确定性：同一输入两次构建字节一致（可复现发布产物）', () => {
    const entries = [{ name: 'migrate-v127/a.txt', data: Buffer.from('same bytes') }]
    expect(Buffer.compare(buildStoredZip(entries), buildStoredZip(entries))).toBe(0)
  })

  it('非法条目名（反斜杠/遍历）拒绝（安全门，对齐 safeArchiveEntryName 口径）', () => {
    expect(() => buildStoredZip([{ name: 'migrate-v127\\a.txt', data: Buffer.from('x') }])).toThrow()
    expect(() => buildStoredZip([{ name: '../escape.txt', data: Buffer.from('x') }])).toThrow()
  })
})

describe('PORT-UPD-01 migrate-v127 目录收集', () => {
  it('按 migrate-v127/<相对路径>（正斜杠）收集全部文件，内容逐字节等于源文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migrate-zip-'))
    try {
      const dist = join(root, 'dist', 'migrate-v127')
      await mkdir(join(dist, 'nested'), { recursive: true })
      await writeFile(join(dist, 'export-v127.cjs'), 'BUNDLED-TOOL')
      await writeFile(join(dist, '迁移说明.md'), '迁移说明内容')
      await writeFile(join(dist, 'nested', 'deep.txt'), 'deep')
      const entries = await collectMigrateZipEntries(dist)
      expect(entries.map(entry => entry.name).sort()).toEqual([
        'migrate-v127/export-v127.cjs',
        'migrate-v127/nested/deep.txt',
        'migrate-v127/迁移说明.md',
      ])
      const byName = new Map(entries.map(entry => [entry.name, entry.data]))
      expect(byName.get('migrate-v127/export-v127.cjs')!.toString()).toBe('BUNDLED-TOOL')
      expect(byName.get('migrate-v127/迁移说明.md')!.toString()).toBe('迁移说明内容')
      expect(byName.get('migrate-v127/nested/deep.txt')!.toString()).toBe('deep')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
