// PORT-UPD-01 发布管线扩展单测：
//   ① latest.yml 追加便携 exe 条目（extendLatestYmlWithPortable）——oracle 双保险＝
//     release-desktop-lib.mjs 的 parseLatestYml（形状核验）＋标准 js-yaml（P0 修复引入：
//     v1.2.7 真实产物便携条目被追加到顶层 mapping 区导致非法 YAML，自写解析器与生成逻辑
//     同源且对乱序追加宽容，未拦住；electron-updater 依赖标准解析，NSIS 通道同样会挂）；
//   ② migrate-v127.zip 纯 Node STORE 型 zip 写入器（buildStoredZip）——oracle＝server
//     UPD-01 zip 读取器（listZipEntries/readZipEntry，CRC 与条目字节独立校验）；
//   ③ collectMigrateZipEntries 目录收集——oracle＝测试自建临时树。
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { buildStoredZip, collectMigrateZipEntries, extendLatestYmlWithPortable } from '../scripts/release-desktop.mjs'
import { parseLatestYml, renderLatestYml } from '../scripts/release-desktop-lib.mjs'
import { listZipEntries, readZipEntry } from '../../server/src/update/zip.ts'

const sha512Base64 = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

describe('PORT-UPD-01 latest.yml 便携条目扩展', () => {
  const baseSetup = {
    url: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
    sha512: sha512Base64(new Uint8Array([1, 2, 3])),
    size: 3,
  }
  const baseText = renderLatestYml({
    version: '1.2.7',
    fileName: baseSetup.url,
    sha512Base64: baseSetup.sha512,
    size: baseSetup.size,
    releaseDate: '2026-10-11T00:00:00.000Z',
  })
  const portable = {
    url: 'kline-trainer-desktop-v1.2.7-windows-x64.exe',
    sha512: sha512Base64(new Uint8Array([9, 9, 9])),
    size: 9,
  }
  // electron-builder 真实产出形状：files 序列在第二位，其后还有顶层键
  // （version/files/path/sha512/releaseDate）——与 renderLatestYml（files 在末尾）不同，
  // 追加到文本末尾会撞进顶层 mapping 区，标准 YAML 直接拒绝。
  const builderShapedBase = [
    'version: 1.2.7',
    'files:',
    `  - url: ${baseSetup.url}`,
    `    sha512: ${baseSetup.sha512}`,
    `    size: ${baseSetup.size}`,
    `path: ${baseSetup.url}`,
    `sha512: ${baseSetup.sha512}`,
    "releaseDate: '2026-10-11T00:00:00.000Z'",
    '',
  ].join('\n')

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

  // ===== P0 修复（用户验收发现非法 YAML）：标准 js-yaml 独立 oracle =====

  it('electron-builder 形状（files 序列后还有顶层键）扩展产物整体通过标准 js-yaml 解析', () => {
    const extended = extendLatestYmlWithPortable({
      text: builderShapedBase, fileName: portable.url, sha512Base64: portable.sha512, size: portable.size,
    })
    expect(() => yaml.load(extended)).not.toThrow()
  })

  it('js-yaml 解析后 files 恰含 setup+portable 两条目且顶层四字段与原值一致', () => {
    const extended = extendLatestYmlWithPortable({
      text: builderShapedBase, fileName: portable.url, sha512Base64: portable.sha512, size: portable.size,
    })
    const parsed = yaml.load(extended) as {
      version: unknown; path: unknown; sha512: unknown; releaseDate: unknown
      files: Array<{ url: unknown; sha512: unknown; size: unknown }>
    }
    expect(parsed.version).toBe('1.2.7')
    expect(parsed.path).toBe(baseSetup.url)
    expect(parsed.sha512).toBe(baseSetup.sha512)
    expect(parsed.releaseDate).toBe('2026-10-11T00:00:00.000Z')
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]).toEqual(baseSetup)
    expect(parsed.files[1]).toEqual(portable)
  })

  it('幂等（electron-builder 形状）: 合法扩展产物二次调用原样返回且仍可被 js-yaml 解析', () => {
    const extended = extendLatestYmlWithPortable({
      text: builderShapedBase, fileName: portable.url, sha512Base64: portable.sha512, size: portable.size,
    })
    expect(extendLatestYmlWithPortable({
      text: extended, fileName: portable.url, sha512Base64: portable.sha512, size: portable.size,
    })).toBe(extended)
    expect(() => yaml.load(extended)).not.toThrow()
  })
})

// ===== P0 修复：v1.2.7 真实非法产物回放（用户验收发现） =====
// 逐字节快照来源：desktop/release/latest.yml（a755bd1 时代发布产物，LF 行尾）——该文件会被
// 下次发布覆盖，故以快照固化回归输入。末三行为非法追加段（顶层 mapping 区内的便携条目），
// js-yaml 报 "bad indentation of a mapping entry"。
describe('PORT-UPD-01 latest.yml v1.2.7 真实非法产物回放', () => {
  const REAL_LATEST_YML_V127 = [
    'version: 1.2.7',
    'files:',
    '  - url: kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
    '    sha512: mw5pnDFWNttavfsK3g3/OS4mOS4XOqIfxm6dfGjVtomxvKDIghxnpalM2PHUTOcq+O/D9nsyW9LF+V6tGtYkjA==',
    '    size: 117291713',
    'path: kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
    'sha512: mw5pnDFWNttavfsK3g3/OS4mOS4XOqIfxm6dfGjVtomxvKDIghxnpalM2PHUTOcq+O/D9nsyW9LF+V6tGtYkjA==',
    "releaseDate: '2026-10-10T18:01:48.627Z'",
    '  - url: kline-trainer-desktop-v1.2.7-windows-x64.exe',
    '    sha512: 8G5FzYvXTlDHSvZI5JUzTnhleF3AKaHh/c+WGzSTXz+ECmAJkORDCC+p7A1qCmV7FjnJ+ouGaCwdR7p0O9oAxg==',
    '    size: 117083798',
    '',
  ].join('\n')
  const REAL_SETUP_ENTRY = {
    url: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
    sha512: 'mw5pnDFWNttavfsK3g3/OS4mOS4XOqIfxm6dfGjVtomxvKDIghxnpalM2PHUTOcq+O/D9nsyW9LF+V6tGtYkjA==',
    size: 117291713,
  }
  const REAL_PORTABLE_ENTRY = {
    url: 'kline-trainer-desktop-v1.2.7-windows-x64.exe',
    sha512: '8G5FzYvXTlDHSvZI5JUzTnhleF3AKaHh/c+WGzSTXz+ECmAJkORDCC+p7A1qCmV7FjnJ+ouGaCwdR7p0O9oAxg==',
    size: 117083798,
  }
  // 干净输入 = 手工剥离非法追加段（截到 releaseDate 行为止）
  const realClean = `${REAL_LATEST_YML_V127.split('\n').slice(0, 8).join('\n')}\n`
  const extendReal = (text: string) => extendLatestYmlWithPortable({
    text, fileName: REAL_PORTABLE_ENTRY.url, sha512Base64: REAL_PORTABLE_ENTRY.sha512, size: REAL_PORTABLE_ENTRY.size,
  })

  it('待扩展输入（剥离非法段的真实文本）扩展后 js-yaml 可解析且字段逐项保持', () => {
    const parsed = yaml.load(extendReal(realClean)) as {
      version: unknown; path: unknown; sha512: unknown; releaseDate: unknown
      files: unknown[]
    }
    expect(parsed.version).toBe('1.2.7')
    expect(parsed.path).toBe(REAL_SETUP_ENTRY.url)
    expect(parsed.sha512).toBe(REAL_SETUP_ENTRY.sha512)
    expect(parsed.releaseDate).toBe('2026-10-10T18:01:48.627Z')
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]).toEqual(REAL_SETUP_ENTRY)
    expect(parsed.files[1]).toEqual(REAL_PORTABLE_ENTRY)
  })

  it('已含条目输入（合法扩展产物）原样返回不重复追加且 js-yaml 可解析', () => {
    const once = extendReal(realClean)
    expect(extendReal(once)).toBe(once)
    expect((yaml.load(once) as { files: unknown[] }).files).toHaveLength(2)
  })

  it('已含条目但整体非法的 v1.2.7 原始文本 fail-closed 抛错（不得原样放行非法 YAML）', () => {
    expect(() => extendReal(REAL_LATEST_YML_V127)).toThrow()
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
