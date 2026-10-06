import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  desktopArtifactNames,
  assertChecksumsAssetName,
  renderSha256SumsFile,
  renderLatestYml,
  parseLatestYml,
  verifyLatestYml,
  collectChecksumEntries,
} from '../scripts/release-desktop-lib.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- helpers：期望值全部测试侧独立计算（node:crypto / 手写冻结串），不经被测模块 ----
const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sha512Base64Of = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

describe('NSIS-ARTIFACT-PRODUCED / RELEASE-SCRIPT-GATE: desktopArtifactNames freezes the artifact naming contract', () => {
  it('names every release artifact from a three-segment version (handwritten expectations for 1.2.7)', () => {
    expect(desktopArtifactNames('1.2.7')).toEqual({
      portableExe: 'kline-trainer-desktop-v1.2.7-windows-x64.exe',
      setupExe: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      setupBlockmap: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe.blockmap',
      latestYml: 'latest.yml',
      checksums: 'SHA256SUMS-desktop.txt',
    })
  })

  it('bumps names with the version and rejects non three-segment versions (fail-closed, no guessing)', () => {
    expect(desktopArtifactNames('1.3.0').setupExe).toBe('kline-trainer-desktop-setup-v1.3.0-windows-x64.exe')
    expect(() => desktopArtifactNames('1.2')).toThrow(/三段/)
    expect(() => desktopArtifactNames('v1.2.7')).toThrow(/三段/)
    expect(() => desktopArtifactNames('')).toThrow(/三段/)
  })
})

describe('CHECKSUMS-PRODUCED: checksum asset naming and file format', () => {
  it('locks the desktop checksums asset name and forbids the exact UPD-01 asset name SHA256SUMS', () => {
    // oracle: server/src/update/manifest.ts:136 按 === 'SHA256SUMS' 精确名取资产；
    // api.ts:86 该资产未列出 zip 行即拒绝应用 → 双形态同 Release 共存必须异名
    expect(assertChecksumsAssetName('SHA256SUMS-desktop.txt')).toBe(true)
    expect(() => assertChecksumsAssetName('SHA256SUMS')).toThrow(/UPD-01|SHA256SUMS/)
    expect(() => assertChecksumsAssetName('sha256sums-desktop.txt')).toThrow()
  })

  it('renders the zip-pipeline line format: lowercase 64-hex + two spaces + name + newline, entries sorted by name', () => {
    // oracle: scripts/release/build.mjs 写出的行格式 `${zipSha}  ${artifactName}.zip\n`（同源冻结）
    const hexB = 'b'.repeat(64)
    const hexA = 'a'.repeat(64)
    const text = renderSha256SumsFile([
      { name: 'zz-latest.yml', sha256Hex: hexB },
      { name: 'aa-setup.exe', sha256Hex: hexA },
    ])
    expect(text).toBe(`${hexA}  aa-setup.exe\n${hexB}  zz-latest.yml\n`)
    expect(text).toMatch(/^[0-9a-f]{64}  [^\n]+\n([0-9a-f]{64}  [^\n]+\n)*$/)
  })

  it('rejects malformed checksum entries (non-hex digest or missing name)', () => {
    expect(() => renderSha256SumsFile([{ name: 'x.exe', sha256Hex: 'XYZ' }])).toThrow()
    expect(() => renderSha256SumsFile([{ sha256Hex: 'a'.repeat(64) }])).toThrow()
  })
})

describe('LATEST-YML-PRODUCED: latest.yml render / parse / verify against real bytes', () => {
  const bytes = new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4, 5, 6])
  const digest = sha512Base64Of(bytes) // 测试侧独立计算
  const rendered = renderLatestYml({
    version: '1.2.7',
    fileName: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
    sha512Base64: digest,
    size: bytes.length,
    releaseDate: '2026-10-06T00:00:00.000Z',
  })

  it('renders the frozen generic-provider shape (version/path/sha512/files with url+sha512+size, quoted releaseDate)', () => {
    // oracle: PACK-04 design §1.2-7 最小形状（冒烟 fixture＋真实 NsisUpdater 已证可解析）
    const expectedLines = [
      'version: 1.2.7',
      'path: kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      `sha512: ${digest}`,
      "releaseDate: '2026-10-06T00:00:00.000Z'",
      'files:',
      '  - url: kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      `    sha512: ${digest}`,
      `    size: ${bytes.length}`,
    ]
    expect(rendered).toBe(expectedLines.join('\n') + '\n')
  })

  it('parses back its own output with the minimal fail-closed parser', () => {
    const parsed = parseLatestYml(rendered)
    expect(parsed.version).toBe('1.2.7')
    expect(parsed.path).toBe('kline-trainer-desktop-setup-v1.2.7-windows-x64.exe')
    expect(parsed.sha512).toBe(digest)
    expect(parsed.files).toEqual([
      { url: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe', sha512: digest, size: bytes.length },
    ])
  })

  it('parses electron-builder style output (unquoted releaseDate tolerated) and rejects missing required fields', () => {
    const builderStyle = [
      'version: 1.2.7',
      'path: setup.exe',
      `sha512: ${digest}`,
      'releaseDate: 2026-10-06T01:02:03.000Z',
      'files:',
      '  - url: setup.exe',
      `    sha512: ${digest}`,
      '    size: 8',
      '  - url: setup.exe.blockmap',
      `    sha512: ${digest}`,
      '    size: 20',
    ].join('\n') + '\n'
    const parsed = parseLatestYml(builderStyle)
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[1].url).toBe('setup.exe.blockmap')

    expect(() => parseLatestYml('version: 1.2.7\n')).toThrow()
    expect(() => parseLatestYml('version: 1.2.7\npath: a.exe\nfiles:\n')).toThrow() // 缺顶层 sha512
    expect(() => parseLatestYml('version: 1.2.7\npath: a.exe\nsha512: x\nfiles:\n')).toThrow() // files 空
  })

  it('verifies a matching document against real bytes and rejects each mismatch distinctly (fail-closed)', async () => {
    await expect(verifyLatestYml({
      text: rendered,
      expectedVersion: '1.2.7',
      expectedFileName: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      fileBytes: bytes,
    })).resolves.toBeUndefined()

    await expect(verifyLatestYml({
      text: rendered,
      expectedVersion: '9.9.9',
      expectedFileName: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      fileBytes: bytes,
    })).rejects.toThrow(/版本|version/i)

    await expect(verifyLatestYml({
      text: rendered,
      expectedVersion: '1.2.7',
      expectedFileName: 'some-other-installer.exe',
      fileBytes: bytes,
    })).rejects.toThrow(/文件|file/i)

    const tampered = new Uint8Array([...bytes, 0xff])
    await expect(verifyLatestYml({
      text: rendered,
      expectedVersion: '1.2.7',
      expectedFileName: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      fileBytes: tampered,
    })).rejects.toThrow(/sha512/i)

    const sizeLie = rendered.replace(`size: ${bytes.length}`, 'size: 999999')
    await expect(verifyLatestYml({
      text: sizeLie,
      expectedVersion: '1.2.7',
      expectedFileName: 'kline-trainer-desktop-setup-v1.2.7-windows-x64.exe',
      fileBytes: bytes,
    })).rejects.toThrow(/size/i)
  })
})

describe('RELEASE-SCRIPT-GATE: collectChecksumEntries assembles the complete artifact set or throws', () => {
  const version = '1.2.7'
  const names = desktopArtifactNames(version)
  const portableBytes = new Uint8Array([1, 2, 3])
  const setupBytes = new Uint8Array([4, 5, 6, 7])
  const latestBytes = new TextEncoder().encode('version: 1.2.7\n')

  const makeFs = (files: Record<string, Uint8Array>) => ({
    exists: async (name: string) => name in files,
    readFile: async (name: string) => files[name],
  })

  it('collects portable exe + setup exe + latest.yml with independent digests and sizes', async () => {
    const entries = await collectChecksumEntries({
      version,
      fs: makeFs({ [names.portableExe]: portableBytes, [names.setupExe]: setupBytes, [names.latestYml]: latestBytes }),
    })
    expect(entries.map(entry => entry.name)).toEqual([names.latestYml, names.portableExe, names.setupExe].sort())
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    expect(byName.get(names.setupExe)).toEqual({ name: names.setupExe, sha256Hex: sha256Of(setupBytes), size: setupBytes.length })
    expect(byName.get(names.portableExe)).toEqual({ name: names.portableExe, sha256Hex: sha256Of(portableBytes), size: portableBytes.length })
    expect(byName.get(names.latestYml)).toEqual({ name: names.latestYml, sha256Hex: sha256Of(latestBytes), size: latestBytes.length })
  })

  it('includes the blockmap when present and never requires it', async () => {
    const withBlockmap = await collectChecksumEntries({
      version,
      fs: makeFs({ [names.portableExe]: portableBytes, [names.setupExe]: setupBytes, [names.latestYml]: latestBytes, [names.setupBlockmap]: new Uint8Array([9]) }),
    })
    expect(withBlockmap.map(entry => entry.name)).toContain(names.setupBlockmap)
    const withoutBlockmap = await collectChecksumEntries({
      version,
      fs: makeFs({ [names.portableExe]: portableBytes, [names.setupExe]: setupBytes, [names.latestYml]: latestBytes }),
    })
    expect(withoutBlockmap.map(entry => entry.name)).not.toContain(names.setupBlockmap)
  })

  it('throws with the missing artifact names when the release set is incomplete (fail-closed)', async () => {
    await expect(collectChecksumEntries({
      version,
      fs: makeFs({ [names.portableExe]: portableBytes, [names.latestYml]: latestBytes }),
    })).rejects.toThrow(new RegExp(names.setupExe))
    await expect(collectChecksumEntries({
      version,
      fs: makeFs({ [names.setupExe]: setupBytes, [names.latestYml]: latestBytes }),
    })).rejects.toThrow(new RegExp(names.portableExe.replace(/\./g, '\\.')))
    await expect(collectChecksumEntries({
      version,
      fs: makeFs({ [names.setupExe]: setupBytes, [names.portableExe]: portableBytes }),
    })).rejects.toThrow(/latest\.yml/)
  })
})

describe('NSIS-ARTIFACT-PRODUCED: electron-builder.yml source contract (wizard / per-user / setup naming)', () => {
  it('declares the nsis win target with the frozen installer options', async () => {
    // oracle: PACK-05 派发简报设计决策 1（one-click=false 向导式＋per-user＋允许自选安装目录＋setup 命名）
    const yml = await readFile(join(repoRoot, 'desktop', 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/target:\s*nsis/)
    expect(yml).toMatch(/oneClick:\s*false/)
    expect(yml).toMatch(/perMachine:\s*false/)
    expect(yml).toMatch(/allowToChangeInstallationDirectory:\s*true/)
    expect(yml).toMatch(/artifactName:\s*kline-trainer-desktop-setup-v\$\{version\}-windows-x64\.exe/)
    // 便携目标与既有命名保留（零破坏）
    expect(yml).toMatch(/target:\s*portable/)
    expect(yml).toMatch(/artifactName:\s*kline-trainer-desktop-v\$\{version\}-windows-x64\.exe/)
  })
})
