// UPD-01 换装核心库：备份轮换、preserve 不动、成功换装、失败回滚。
// 矩阵行：UPD-BACKUP-BEFORE-SWAP / UPD-PRESERVE-DATA / UPD-APPLY-SWAP / UPD-APPLY-ROLLBACK。
// oracle 独立性：新旧迷你包的文件集/内容均由本测试独立写置；期望换装结果
// （旧独有文件消失、新文件就位、runtime 与 preserve 字节不变）从包清单语义推算，
// 不读实现输出。失败注入经显式 hooks 触发。

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  backupPreserveFiles, performSwap, readPackageManifest, restorePreserveFromBackup,
  rotateBackups, rollbackSwap, verifyPreserved, snapshotPreserved, extractZip,
} from '../src/update/updater-core.js'
import { buildReleaseZip, makeTmpDir, pathExists, readTextIfExists } from './helpers/updater-fixtures.js'

const OLD_CONFIG = '{\n  "port": 8787\n}\n'
const OLD_SQLITE = 'sqlite-bytes-of-history-training-v1'

async function buildOldPackage(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
  const { writeMiniPackage } = await import('./helpers/updater-fixtures.js')
  await writeMiniPackage(root, {
    version: '1.2.7',
    nodeVersion: '24.1.1',
    files: {
      'server/dist/index.js': 'old server\n',
      'web/dist/index.html': 'old web\n',
      'legacy-only.txt': 'this file is removed upstream in v2\n',
    },
    preserve: {
      trainerConfig: OLD_CONFIG,
      sqlite: OLD_SQLITE,
      sqliteWal: 'wal-bytes',
      savedChoice: '{"version":1,"root":"D:\\\\TDX"}',
      trainerState: '{"appId":"a-share-kline-trainer","runId":"run-old"}',
    },
  })
}

async function buildNewZip(workDir: string): Promise<string> {
  const { buffer } = await buildReleaseZip({
    version: '1.2.8',
    nodeVersion: '24.1.1',
    files: {
      'server/dist/index.js': 'new server v1.2.8\n',
      'web/dist/index.html': 'new web v1.2.8\n',
      'added-in-v2.txt': 'brand new file\n',
    },
  }, workDir)
  const zipPath = join(workDir, 'new.zip')
  await writeFile(zipPath, buffer)
  return zipPath
}

describe('UPD-BACKUP-BEFORE-SWAP backupPreserveFiles + rotateBackups', () => {
  it('copies the preserve set into backups/update-<timestamp> and rotates to keep the latest 5', async () => {
    const root = await makeTmpDir('trainer-upd-backup-')
    await buildOldPackage(root)
    const dataDir = join(root, 'data')
    const backupsRoot = join(dataDir, 'backups')
    // 预置 6 份旧备份（t0 最旧）
    for (let index = 0; index < 6; index++) {
      await mkdir(join(backupsRoot, `update-2026010${index}00000000-${index}`), { recursive: true })
      await writeFile(join(backupsRoot, `update-2026010${index}00000000-${index}`, 'marker.txt'), `old ${index}`)
    }
    const backup = await backupPreserveFiles(root, dataDir, backupsRoot, { timestamp: '20260107120000-7' })
    expect(backup.files.sort()).toEqual(['saved-tdx-choice.json', 'trainer-state.json', 'trainer.config.json', 'trainer.sqlite', 'trainer.sqlite-wal'])
    expect(await readTextIfExists(join(backup.backupDir, 'trainer.config.json'))).toBe(OLD_CONFIG)
    expect(await readTextIfExists(join(backup.backupDir, 'trainer.sqlite'))).toBe(OLD_SQLITE)
    const names = (await readdir(backupsRoot)).sort()
    expect(names).toHaveLength(5)
    expect(names).not.toContain('update-20260100000000-0') // 最旧一份被清理
    expect(names).toContain('update-20260107120000-7')
  })

  it('skips logs, downloads, work dirs and nested backups from the backup set', async () => {
    const root = await makeTmpDir('trainer-upd-backup2-')
    await buildOldPackage(root)
    const dataDir = join(root, 'data')
    await writeFile(join(dataDir, 'server.log'), 'log\n')
    await writeFile(join(dataDir, 'launcher.log'), 'log\n')
    await mkdir(join(dataDir, 'update-downloads'), { recursive: true })
    await writeFile(join(dataDir, 'update-downloads', 'x.zip'), 'zipbytes')
    await mkdir(join(dataDir, 'update-work'), { recursive: true })
    const backupsRoot = join(dataDir, 'backups')
    const backup = await backupPreserveFiles(root, dataDir, backupsRoot)
    const flat = backup.files
    expect(flat).not.toContain('server.log')
    expect(flat).not.toContain('update-downloads')
    expect(await pathExists(join(backup.backupDir, 'server.log'))).toBe(false)
  })

  it('rotateBackups keeps exactly N newest by lexical timestamp order and reports removals', async () => {
    const root = await makeTmpDir('trainer-upd-rotate-')
    const backupsRoot = join(root, 'backups')
    for (const name of ['update-b', 'update-a', 'update-c']) await mkdir(join(backupsRoot, name), { recursive: true })
    const result = await rotateBackups(backupsRoot, 2)
    expect(result.removed).toEqual(['update-a'])
    expect((await readdir(backupsRoot)).sort()).toEqual(['update-b', 'update-c'])
  })
})

describe('UPD-APPLY-SWAP / UPD-PRESERVE-DATA performSwap', () => {
  it('moves old-only files away, places new files, and leaves runtime + preserve untouched', async () => {
    const workDir = await makeTmpDir('trainer-upd-swap-')
    const root = join(workDir, 'pkg')
    await buildOldPackage(root)
    const runtimeBefore = await readFile(join(root, 'runtime', 'node.exe'))
    const manifestBefore = await readTextIfExists(join(root, 'release-manifest.json'))
    const zipPath = await buildNewZip(workDir)
    const extracted = join(workDir, 'extracted')
    const inner = await extractZip(zipPath, extracted)
    const trashDir = join(workDir, 'trash')
    const snapshot = await snapshotPreserved(root, join(root, 'data'))
    const result = await performSwap(root, inner, trashDir)

    // 新文件就位（内容为新包字节）
    expect(await readTextIfExists(join(root, 'server', 'dist', 'index.js'))).toBe('new server v1.2.8\n')
    expect(await readTextIfExists(join(root, 'added-in-v2.txt'))).toBe('brand new file\n')
    // 旧独有文件被移除（移入 trash，不是删除）
    expect(await pathExists(join(root, 'legacy-only.txt'))).toBe(false)
    expect(await readTextIfExists(join(trashDir, 'legacy-only.txt'))).toBe('this file is removed upstream in v2\n')
    expect(await readTextIfExists(join(trashDir, 'server', 'dist', 'index.js'))).toBe('old server\n')
    // runtime 原字节不动（跳过搬运）
    expect(await readFile(join(root, 'runtime', 'node.exe'))).toEqual(runtimeBefore)
    expect(result.skipped.some(rel => rel.startsWith('runtime/'))).toBe(true)
    // preserve 字节不变（UPD-PRESERVE-DATA：内容逐字节相等）
    expect(await readTextIfExists(join(root, 'trainer.config.json'))).toBe(OLD_CONFIG)
    expect(await readTextIfExists(join(root, 'data', 'trainer.sqlite'))).toBe(OLD_SQLITE)
    expect(await readTextIfExists(join(root, 'data', 'saved-tdx-choice.json'))).toBe('{"version":1,"root":"D:\\\\TDX"}')
    // release-manifest.json 换为新包版本
    const manifestAfter = await readTextIfExists(join(root, 'release-manifest.json'))
    expect(manifestAfter).not.toBe(manifestBefore)
    expect(manifestAfter).toContain('"version": "1.2.8"')
    // 换装后 preserve 核验通过
    expect((await verifyPreserved(root, join(root, 'data'), snapshot)).ok).toBe(true)
  })

  it('UPD-APPLY-ROLLBACK (move failure): restores every moved file and places nothing new', async () => {
    const workDir = await makeTmpDir('trainer-upd-rb1-')
    const root = join(workDir, 'pkg')
    await buildOldPackage(root)
    const before = await readPackageManifest(root)
    const beforeContents = new Map<string, string>()
    for (const rel of before?.files ?? []) beforeContents.set(rel, await readTextIfExists(join(root, ...rel.split('/'))))
    const zipPath = await buildNewZip(workDir)
    const inner = await extractZip(zipPath, join(workDir, 'extracted'))
    const trashDir = join(workDir, 'trash')
    await expect(performSwap(root, inner, trashDir, {
      hooks: { beforeMove: rel => { if (rel === 'web/dist/index.html') throw new Error('disk full (simulated move failure)') } },
    })).rejects.toThrow('disk full')
    // 回滚后：所有旧文件按原内容回来，新文件一个都没有
    for (const [rel, content] of beforeContents) {
      expect(await readTextIfExists(join(root, ...rel.split('/'))), rel).toBe(content)
    }
    expect(await pathExists(join(root, 'added-in-v2.txt'))).toBe(false)
    expect(await readTextIfExists(join(root, 'server', 'dist', 'index.js'))).toBe('old server\n')
    expect(await readTextIfExists(join(root, 'legacy-only.txt'))).toBe('this file is removed upstream in v2\n')
  })

  it('UPD-APPLY-ROLLBACK (place failure): removes placed new files and restores moved olds', async () => {
    const workDir = await makeTmpDir('trainer-upd-rb2-')
    const root = join(workDir, 'pkg')
    await buildOldPackage(root)
    const zipPath = await buildNewZip(workDir)
    const inner = await extractZip(zipPath, join(workDir, 'extracted'))
    const trashDir = join(workDir, 'trash')
    let placed = 0
    await expect(performSwap(root, inner, trashDir, {
      hooks: { beforePlace: () => { placed += 1; if (placed >= 2) throw new Error('antivirus lock (simulated place failure)') } },
    })).rejects.toThrow('antivirus lock')
    expect(await readTextIfExists(join(root, 'server', 'dist', 'index.js'))).toBe('old server\n')
    expect(await pathExists(join(root, 'added-in-v2.txt'))).toBe(false)
    expect(await readTextIfExists(join(root, 'legacy-only.txt'))).toBe('this file is removed upstream in v2\n')
  })

  it('rollbackSwap standalone: reverts a completed swap to the old package', async () => {
    const workDir = await makeTmpDir('trainer-upd-rb3-')
    const root = join(workDir, 'pkg')
    await buildOldPackage(root)
    const zipPath = await buildNewZip(workDir)
    const inner = await extractZip(zipPath, join(workDir, 'extracted'))
    const trashDir = join(workDir, 'trash')
    const result = await performSwap(root, inner, trashDir)
    expect(await readTextIfExists(join(root, 'server', 'dist', 'index.js'))).toBe('new server v1.2.8\n')
    await rollbackSwap(root, trashDir, result.placed)
    expect(await readTextIfExists(join(root, 'server', 'dist', 'index.js'))).toBe('old server\n')
    expect(await readTextIfExists(join(root, 'legacy-only.txt'))).toBe('this file is removed upstream in v2\n')
    expect(await pathExists(join(root, 'added-in-v2.txt'))).toBe(false)
  })

  it('refuses to swap a package without release-manifest.json (old pre-manifest package)', async () => {
    const workDir = await makeTmpDir('trainer-upd-nomanifest-')
    const root = join(workDir, 'pkg')
    await buildOldPackage(root)
    await rm(join(root, 'release-manifest.json'), { force: true })
    const zipPath = await buildNewZip(workDir)
    const inner = await extractZip(zipPath, join(workDir, 'extracted'))
    await expect(performSwap(root, inner, join(workDir, 'trash'))).rejects.toThrow(/release-manifest/)
  })
})

describe('UPD-PRESERVE-DATA verification and restore', () => {
  it('verifyPreserved detects a lost preserve item, and restorePreserveFromBackup puts it back', async () => {
    const workDir = await makeTmpDir('trainer-upd-preserve-')
    const root = join(workDir, 'pkg')
    await buildOldPackage(root)
    const dataDir = join(root, 'data')
    const snapshot = await snapshotPreserved(root, dataDir)
    // 换装前语义：先备份（此时 preserve 完好），随后模拟灾难性损失
    const backupsRoot = join(dataDir, 'backups')
    const backup = await backupPreserveFiles(root, dataDir, backupsRoot)
    await rm(join(root, 'trainer.config.json'), { force: true })
    await rm(join(dataDir, 'trainer.sqlite'), { force: true })
    const damaged = await verifyPreserved(root, dataDir, snapshot)
    expect(damaged.ok).toBe(false)
    expect(damaged.missing.sort()).toEqual(['data/trainer.sqlite', 'trainer.config.json'])
    const restore = await restorePreserveFromBackup(root, dataDir, backup.backupDir)
    expect(restore.restored.sort()).toEqual(['saved-tdx-choice.json', 'trainer-state.json', 'trainer.config.json', 'trainer.sqlite', 'trainer.sqlite-wal'])
    expect(await readTextIfExists(join(root, 'trainer.config.json'))).toBe(OLD_CONFIG)
    expect(await readTextIfExists(join(dataDir, 'trainer.sqlite'))).toBe(OLD_SQLITE)
    expect((await verifyPreserved(root, dataDir, snapshot)).ok).toBe(true)
  })
})
