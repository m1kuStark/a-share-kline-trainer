// INSTALL-01（2026-10-11 用户拍板，矩阵行 INSTALL-NSIS-ASSISTED）发布管线单测：
//   ① release-desktop.mjs 编排源码契约——便携产物退役：electron-builder 仅 nsis 目标、
//     latest.yml 不再追加便携条目（extendLatestYmlWithPortable 已随调用点删除——原
//     PORT-UPD-01 便携条目扩展行为整体退役，锁行为两段用例随之退役，双向留痕见任务收尾报告；
//     便携 exe 的运行时自更新模块 portable-updater.ts 本体保留一个版本周期防回滚）；
//   ② migrate-v127.zip 纯 Node STORE 型 zip 写入器（buildStoredZip）——oracle＝server
//     UPD-01 zip 读取器（listZipEntries/readZipEntry，CRC 与条目字节独立校验）；
//   ③ collectMigrateZipEntries 目录收集——oracle＝测试自建临时树。
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStoredZip, collectMigrateZipEntries } from '../scripts/release-desktop.mjs'
import { listZipEntries, readZipEntry } from '../../server/src/update/zip.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('INSTALL-01: release-desktop.mjs orchestration (source contract)', () => {
  it('builds the nsis target only and no longer extends latest.yml with a portable entry', async () => {
    const source = await readFile(join(repoRoot, 'desktop', 'scripts', 'release-desktop.mjs'), 'utf8')
    // electron-builder 双目标收敛为单目标：--win nsis（portable 不再出现在构建参数）
    expect(source).toMatch(/'--win',\s*'nsis'/)
    expect(source).not.toMatch(/'--win',\s*'nsis',\s*'portable'/)
    // 便携条目扩展函数与调用已删除（死代码清理；运行时便携更新器读不到条目＝fail-closed 拒装，符合拍板）
    expect(source).not.toMatch(/extendLatestYmlWithPortable/)
    // 便携产物 fail-closed 存在性检查已退役：脚本不得再因缺便携 exe 而失败
    expect(source).not.toMatch(/portable exe missing/)
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
