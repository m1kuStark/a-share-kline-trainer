// UPD-01 换装核心库（矩阵行 UPD-BACKUP-BEFORE-SWAP / UPD-PRESERVE-DATA /
// UPD-APPLY-SWAP / UPD-APPLY-ROLLBACK）。纯文件系统操作＋显式路径入参，全部可注入
// 临时目录测试。换装语义（design.md §3.4）：
//  - 只搬移旧包 release-manifest.json 列出的包自有文件——trainer.config.json 与
//    data/（V1.2.6 默认 dataDir＝<包根>/data）不在清单内，天然原位不动；
//  - 旧文件先移走（rename 进同卷 trash）再放新（copy 自解压 staging），绝不原位覆写；
//  - runtime/ 默认跳过（nodeVersion 完全一致才走到换装，见 zip.ts verify）；
//  - 任一步失败：逆序回滚（已放置删除、已移走移回），错误如实上抛。

import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export { extractZip } from './zip.js'

export interface UpdatePlan {
  version: 1
  appId: string
  attemptId: string
  createdAt: string
  packageRoot: string
  dataDir: string
  zipPath: string
  zipSha256: string | null
  expectedVersion: string
  artifactName: string
  serverPid: number
  serverPort: number
  runId: string
  launcherPath: string
  nodePath: string
  backupKeep: number
}

/** 包根下原位保留的用户文件（新包不含：classifyStagedPath 拒绝打包） */
export const PRESERVE_PACKAGE_FILES = ['trainer.config.json'] as const
/** dataDir 下进入备份集的用户数据文件（缺省跳过；排除日志/下载/工作目录） */
export const PRESERVE_DATA_FILES = ['trainer.sqlite', 'trainer.sqlite-wal', 'trainer.sqlite-shm', 'saved-tdx-choice.json', 'trainer-state.json'] as const

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 目录下全部文件（相对路径、正斜杠、字典序）。 */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) for (const rel of await walkFiles(path)) out.push(`${entry.name}/${rel}`)
    else if (entry.isFile()) out.push(entry.name)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export interface PackageManifest {
  files: string[]
}

/** 读旧包 release-manifest.json 的文件清单；缺失/损坏返回 null（换装拒绝，见 performSwap）。 */
export async function readPackageManifest(packageRoot: string): Promise<PackageManifest | null> {
  let raw: string
  try {
    raw = await readFile(join(packageRoot, 'release-manifest.json'), 'utf8')
  } catch {
    return null
  }
  let value: { files?: unknown }
  try {
    value = JSON.parse(raw) as { files?: unknown }
  } catch {
    return null
  }
  if (!Array.isArray(value?.files)) return null
  const files = value.files
    .filter((entry): entry is { path: string } =>
      Boolean(entry) && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string')
    .map(entry => entry.path)
  return { files }
}

function defaultBackupTimestamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}-${randomUUID().slice(0, 8)}`
}

/**
 * 换装前备份 preserve 集（UPD-BACKUP-BEFORE-SWAP）：trainer.config.json＋dataDir 下
 * PRESERVE_DATA_FILES（存在才备份），写入 backups/update-<时间戳>/，随后按 keep 轮换。
 * 返回备份目录与实际备份的文件名清单。
 */
export async function backupPreserveFiles(packageRoot: string, dataDir: string, backupsRoot: string, options: { timestamp?: string, keep?: number } = {}): Promise<{ backupDir: string, files: string[] }> {
  const backupDir = join(backupsRoot, `update-${options.timestamp ?? defaultBackupTimestamp()}`)
  await mkdir(backupDir, { recursive: true })
  const files: string[] = []
  for (const name of PRESERVE_PACKAGE_FILES) {
    const source = join(packageRoot, name)
    if (await pathExists(source)) {
      await copyFile(source, join(backupDir, name))
      files.push(name)
    }
  }
  for (const name of PRESERVE_DATA_FILES) {
    const source = join(dataDir, name)
    if (await pathExists(source)) {
      await copyFile(source, join(backupDir, name))
      files.push(name)
    }
  }
  await rotateBackups(backupsRoot, options.keep ?? 5)
  return { backupDir, files }
}

/** 备份轮换：backupsRoot 下 update-* 目录按字典序保留最新 keep 份，更旧的整目录删除。 */
export async function rotateBackups(backupsRoot: string, keep: number): Promise<{ removed: string[] }> {
  if (!(await pathExists(backupsRoot))) return { removed: [] }
  const names = (await readdir(backupsRoot)).filter(name => name.startsWith('update-')).sort()
  const removed: string[] = []
  while (names.length > keep) {
    const oldest = names.shift()!
    await rm(join(backupsRoot, oldest), { recursive: true, force: true })
    removed.push(oldest)
  }
  return { removed }
}

export interface SwapHooks {
  beforeMove?: (relPath: string) => void
  onMoved?: (relPath: string) => void
  beforePlace?: (relPath: string) => void
  onPlaced?: (relPath: string) => void
}

export interface SwapResult {
  moved: string[]
  placed: string[]
  skipped: string[]
  trashDir: string
}

/**
 * 换装（UPD-APPLY-SWAP）：旧包清单文件逐个 rename 进 trashDir（同卷），新包文件自
 * newRoot 逐个 copyFile 就位；skip 默认跳过 runtime/。任一步失败自动逆序回滚
 * （UPD-APPLY-ROLLBACK）后抛出原错误；回滚自身的失败叠加进错误消息（不吞）。
 */
export async function performSwap(packageRoot: string, newRoot: string, trashDir: string, options: {
  hooks?: SwapHooks
  skip?: (relPath: string) => boolean
} = {}): Promise<SwapResult> {
  const manifest = await readPackageManifest(packageRoot)
  if (!manifest) {
    throw new Error(`旧包缺少可读的 release-manifest.json，无法安全换装（${packageRoot}）；请从 GitHub Releases 手动全量更新一次以升级到支持在线更新的版本`)
  }
  const skip = options.skip ?? ((rel: string) => rel.startsWith('runtime/'))
  const moved: string[] = []
  const placed: string[] = []
  const skipped: string[] = []
  try {
    for (const rel of [...manifest.files].sort()) {
      if (skip(rel)) {
        skipped.push(rel)
        continue
      }
      options.hooks?.beforeMove?.(rel)
      const target = join(trashDir, ...rel.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await rename(join(packageRoot, ...rel.split('/')), target)
      moved.push(rel)
      options.hooks?.onMoved?.(rel)
    }
    for (const rel of await walkFiles(newRoot)) {
      if (skip(rel)) {
        skipped.push(rel)
        continue
      }
      options.hooks?.beforePlace?.(rel)
      const target = join(packageRoot, ...rel.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(newRoot, ...rel.split('/')), target)
      placed.push(rel)
      options.hooks?.onPlaced?.(rel)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    let rollbackNote = ''
    try {
      await rollbackSwap(packageRoot, trashDir, placed, moved)
    } catch (rollbackError) {
      rollbackNote = `；回滚亦有失败（请勿继续使用该包，从备份目录恢复）：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
    }
    throw new Error(`换装失败已回滚（已移走 ${moved.length} 个、已放置 ${placed.length} 个文件）：${reason}${rollbackNote}`)
  }
  return { moved, placed, skipped, trashDir }
}

/**
 * 回滚：删除已放置的新文件（逆序），把 trash 里的旧文件移回原位。
 * moved 未提供时按 trash 目录现存内容推导。
 */
export async function rollbackSwap(packageRoot: string, trashDir: string, placed: string[], moved?: string[]): Promise<void> {
  for (const rel of [...placed].reverse()) {
    await rm(join(packageRoot, ...rel.split('/')), { force: true })
  }
  const restore = moved ?? (await pathExists(trashDir) ? await walkFiles(trashDir) : [])
  for (const rel of [...restore].reverse()) {
    const target = join(packageRoot, ...rel.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await rename(join(trashDir, ...rel.split('/')), target)
  }
}

export interface PreserveSnapshot {
  trainerConfig: boolean
  dataSqlite: boolean
}

/** 换装前拍下 preserve 存在性快照（字节级不动的保证来自"不在清单内不搬移"）。 */
export async function snapshotPreserved(packageRoot: string, dataDir: string | null): Promise<PreserveSnapshot> {
  return {
    trainerConfig: await pathExists(join(packageRoot, 'trainer.config.json')),
    dataSqlite: dataDir ? await pathExists(join(dataDir, 'trainer.sqlite')) : false,
  }
}

/** 换装后 preserve 核验：快照里存在的项必须仍存在；缺失项逐名报告。 */
export async function verifyPreserved(packageRoot: string, dataDir: string | null, snapshot: PreserveSnapshot): Promise<{ ok: boolean, missing: string[] }> {
  const missing: string[] = []
  if (snapshot.trainerConfig && !(await pathExists(join(packageRoot, 'trainer.config.json')))) {
    missing.push('trainer.config.json')
  }
  if (snapshot.dataSqlite && !(dataDir && await pathExists(join(dataDir, 'trainer.sqlite')))) {
    missing.push('data/trainer.sqlite')
  }
  return { ok: missing.length === 0, missing }
}

/** 从备份目录恢复 preserve 文件（F9 灾难路径）。 */
export async function restorePreserveFromBackup(packageRoot: string, dataDir: string, backupDir: string): Promise<{ restored: string[] }> {
  const restored: string[] = []
  for (const name of PRESERVE_PACKAGE_FILES) {
    const source = join(backupDir, name)
    if (await pathExists(source)) {
      await copyFile(source, join(packageRoot, name))
      restored.push(name)
    }
  }
  for (const name of PRESERVE_DATA_FILES) {
    const source = join(backupDir, name)
    if (await pathExists(source)) {
      await copyFile(source, join(dataDir, name))
      restored.push(name)
    }
  }
  return { restored }
}
