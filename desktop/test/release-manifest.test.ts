// GAP2-RELCHECK 任务1：release-manifest.json 产出契约（TDD）。
// 背景（2026-10-19 复盘缺口 G2）：v1.3.1 人工上传环节曾误删资产、v1.3.0 曾长期 draft——
// 发布产物缺一份机器可读清单（文件名/字节数/sha256＋版本号），上传后核对无从对表。
// oracle 独立性：期望 JSON 形状由本测试手写冻结（字段名 name/bytes/sha256/version/
// generatedAt、按名排序、尾换行），sha256/大小由测试侧 node:crypto 独立计算；
// 编排接线按 repo 先例（electron-builder.yml 源码契约断言）以源码形态锁定。
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReleaseManifest } from '../scripts/release-desktop-lib.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const entryOf = (name: string, bytes: Uint8Array) => ({ name, size: bytes.length, sha256Hex: sha256Of(bytes) })

const setupExe = entryOf('kline-trainer-desktop-setup-v1.3.0-windows-x64.exe', new Uint8Array([1, 2, 3, 4]))
const blockmap = entryOf('kline-trainer-desktop-setup-v1.3.0-windows-x64.exe.blockmap', new Uint8Array([9]))
const migrate = entryOf('migrate-v127.zip', new Uint8Array([5, 6, 7]))
const latestYml = entryOf('latest.yml', new TextEncoder().encode('version: 1.3.0\n'))
const sums = entryOf('SHA256SUMS-desktop.txt', new TextEncoder().encode('…checksums text…'))

describe('RELEASE-MANIFEST-PRODUCED: renderReleaseManifest freezes the manifest document shape', () => {
  it('renders version + generatedAt + name-sorted assets with name/bytes/sha256 keys and a trailing newline', () => {
    // 输入乱序（sums 在前）→ 文档内必须按文件名排序（字节序，ICU 无关）
    const text = renderReleaseManifest({
      version: '1.3.0',
      entries: [sums, setupExe, blockmap, migrate, latestYml],
      generatedAt: '2026-10-19T00:00:00.000Z',
    })
    expect(text.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(text)
    const byNameByteOrder = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    expect(parsed).toEqual({
      version: '1.3.0',
      generatedAt: '2026-10-19T00:00:00.000Z',
      assets: [setupExe, sums, blockmap, latestYml, migrate]
        .sort(byNameByteOrder)
        .map(entry => ({ name: entry.name, bytes: entry.size, sha256: entry.sha256Hex })),
    })
  })

  it('rejects malformed input fail-closed (non three-segment version / empty entries / bad digest)', () => {
    expect(() => renderReleaseManifest({ version: 'v1.3.0', entries: [setupExe], generatedAt: 'x' })).toThrow(/三段/)
    expect(() => renderReleaseManifest({ version: '1.3.0', entries: [], generatedAt: 'x' })).toThrow()
    expect(() => renderReleaseManifest({
      version: '1.3.0',
      entries: [{ name: 'x.exe', size: 1, sha256Hex: 'NOT-HEX' }],
      generatedAt: 'x',
    })).toThrow(/sha256/)
    expect(() => renderReleaseManifest({
      version: '1.3.0',
      entries: [{ name: 'x.exe', size: -1, sha256Hex: 'a'.repeat(64) }],
      generatedAt: 'x',
    })).toThrow()
  })
})

describe('RELEASE-MANIFEST-PRODUCED: release-desktop.mjs orchestration wiring (source contract)', () => {
  it('writes release-manifest.json into OUT_DIR via renderReleaseManifest after the checksums write', async () => {
    // 先例：desktop/test/release-desktop-lib.test.ts 的 electron-builder.yml 源码契约断言——
    // 完整 release:desktop 过重不可在测试跑，接线以源码形态锁定（renderReleaseManifest
    // import 自 lib＋产物落 join(OUT_DIR, release-manifest.json)）。
    const source = await readFile(join(repoRoot, 'desktop', 'scripts', 'release-desktop.mjs'), 'utf8')
    expect(source).toMatch(/import\s*\{[^}]*renderReleaseManifest[^}]*\}\s*from\s*'\.\/release-desktop-lib\.mjs'/)
    expect(source).toMatch(/join\(OUT_DIR,\s*'release-manifest\.json'\)/)
    expect(source).toMatch(/renderReleaseManifest\(\{/)
  })
})
