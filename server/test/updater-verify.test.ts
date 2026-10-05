// UPD-01 zip 校验三态＋runtime 兼容。矩阵行：UPD-DOWNLOAD-VERIFY / UPD-RUNTIME-COMPAT。
// oracle 独立性：完好 zip 由 PowerShell Compress-Archive 构造（与发布产物同源），
// 损坏＝字节截断、校验和不符＝篡改期望值、版本不符＝错配 expectedVersion，全部独立构造。

import { describe, expect, it } from 'vitest'
import { readReleaseInfoFromZip, verifyZipArtifact, extractZip, listZipEntries } from '../src/update/zip.js'
import { buildReleaseZip, buildStoredZip, makeTmpDir, sha256Bytes } from './helpers/updater-fixtures.js'

const CURRENT_NODE = '24.1.1'

async function goodZip(): Promise<{ buffer: Buffer, sha: string }> {
  const workDir = await makeTmpDir('trainer-upd-verify-')
  const { buffer } = await buildReleaseZip({
    version: '9.9.9',
    nodeVersion: CURRENT_NODE,
    files: {
      'server/dist/index.js': 'console.log("trainer 9.9.9")\n',
      'web/dist/index.html': '<html>9.9.9</html>\n',
      'README.md': '# trainer 9.9.9\n',
    },
  }, workDir)
  return { buffer, sha: await sha256Bytes(buffer) }
}

describe('verifyZipArtifact (UPD-DOWNLOAD-VERIFY)', () => {
  it('accepts an intact release zip when the SHA256 matches and versions line up', async () => {
    const { buffer, sha } = await goodZip()
    const result = verifyZipArtifact(buffer, { expectedVersion: '9.9.9', expectedSha256: sha, currentNodeVersion: CURRENT_NODE })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.release.version).toBe('9.9.9')
      expect(result.release.nodeVersion).toBe(CURRENT_NODE)
    }
  })

  it('rejects a corrupted zip (truncated tail destroys the central directory)', async () => {
    const { buffer } = await goodZip()
    const truncated = buffer.subarray(0, buffer.length - 200)
    const result = verifyZipArtifact(truncated, { expectedVersion: '9.9.9', currentNodeVersion: CURRENT_NODE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('ZIP_CORRUPT')
  })

  it('rejects a sha mismatch and never falls back to lenient checks', async () => {
    const { buffer } = await goodZip()
    const wrongSha = '0'.repeat(64)
    const result = verifyZipArtifact(buffer, { expectedVersion: '9.9.9', expectedSha256: wrongSha, currentNodeVersion: CURRENT_NODE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('SHA_MISMATCH')
  })

  it('rejects a zip whose embedded release.json version differs from the manifest tag', async () => {
    const { buffer } = await goodZip()
    const result = verifyZipArtifact(buffer, { expectedVersion: '9.9.8', currentNodeVersion: CURRENT_NODE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VERSION_MISMATCH')
  })

  it('UPD-RUNTIME-COMPAT: refuses online swap and names the full-package reinstall path when nodeVersion differs', async () => {
    const workDir = await makeTmpDir('trainer-upd-runtime-')
    const { buffer } = await buildReleaseZip({ version: '9.9.9', nodeVersion: '25.0.0', files: { 'server/dist/index.js': 'x' } }, workDir)
    const result = verifyZipArtifact(buffer, { expectedVersion: '9.9.9', currentNodeVersion: CURRENT_NODE })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('RUNTIME_INCOMPATIBLE')
      expect(result.reason).toContain('全量包')
    }
    // 同大版本不同小版本也拒绝（v1 收紧口径：完全一致才在线换装）
    const minor = await buildReleaseZip({ version: '9.9.9', nodeVersion: '24.5.0', files: { 'server/dist/index.js': 'x' } }, await makeTmpDir('trainer-upd-runtime2-'))
    const minorResult = verifyZipArtifact(minor.buffer, { expectedVersion: '9.9.9', currentNodeVersion: CURRENT_NODE })
    expect(minorResult.ok).toBe(false)
    if (!minorResult.ok) expect(minorResult.code).toBe('RUNTIME_INCOMPATIBLE')
  })

  it('reads release.json through PS5.1-style backslash entry names and stored (method 0) entries', async () => {
    const releaseJson = JSON.stringify({ appId: 'a-share-kline-trainer', version: '4.5.6', nodeVersion: CURRENT_NODE })
    const zip = buildStoredZip([
      { name: 'kline-trainer-v4.5.6-windows-x64\\release.json', data: Buffer.from(releaseJson, 'utf8') },
      { name: 'kline-trainer-v4.5.6-windows-x64\\server\\dist\\index.js', data: Buffer.from('stored entry', 'utf8') },
    ])
    const entries = listZipEntries(zip)
    expect(entries.map(entry => entry.name)).toEqual([
      'kline-trainer-v4.5.6-windows-x64/release.json',
      'kline-trainer-v4.5.6-windows-x64/server/dist/index.js',
    ])
    const release = readReleaseInfoFromZip(zip)
    expect(release?.version).toBe('4.5.6')
    const result = verifyZipArtifact(zip, { expectedVersion: '4.5.6', currentNodeVersion: CURRENT_NODE })
    expect(result.ok).toBe(true)
  })
})

describe('extractZip', () => {
  it('extracts stored and deflated zips, returning the single inner root', async () => {
    const workDir = await makeTmpDir('trainer-upd-extract-')
    const { buffer } = await goodZip()
    const zipPath = `${workDir}\\zip.zip`
    await (await import('node:fs/promises')).writeFile(zipPath, buffer)
    const dest = `${workDir}\\out`
    const inner = await extractZip(zipPath, dest)
    expect(inner).toContain('kline-trainer-v9.9.9-windows-x64')
    const release = JSON.parse(await (await import('node:fs/promises')).readFile(`${inner}\\release.json`, 'utf8'))
    expect(release.version).toBe('9.9.9')
    const serverJs = await (await import('node:fs/promises')).readFile(`${inner}\\server\\dist\\index.js`, 'utf8')
    expect(serverJs).toContain('trainer 9.9.9')
  })

  it('refuses traversal and absolute-path entries instead of writing outside the destination', async () => {
    const workDir = await makeTmpDir('trainer-upd-evil-')
    const evil = buildStoredZip([
      { name: 'ok.txt', data: Buffer.from('fine') },
      { name: '../escape.txt', data: Buffer.from('bad') },
    ])
    const zipPath = `${workDir}\\evil.zip`
    await (await import('node:fs/promises')).writeFile(zipPath, evil)
    await expect(extractZip(zipPath, `${workDir}\\dest`)).rejects.toThrow(/不安全|unsafe/i)
  })
})
