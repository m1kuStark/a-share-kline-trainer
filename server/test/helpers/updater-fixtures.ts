// UPD-01 测试夹具：迷你发布包构造、真 zip 构造（PowerShell Compress-Archive，与
// scripts/release/build.mjs 发布产物同源）、无脚注存储型 zip 构造（恶意条目/读取器
// 边界用）、fetch 替身。测试纪律：零 api.github.com 访问（manifest fetcher 全注入）。

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const APP_ID = 'a-share-kline-trainer'

export async function makeTmpDir(prefix = 'trainer-upd-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function sha256Bytes(data: Buffer | string): Promise<string> {
  return createHash('sha256').update(data).digest('hex')
}

export async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path))
}

export interface MiniPackageSpec {
  version: string
  nodeVersion?: string
  /** 包自有文件（相对包根，正斜杠）；全部计入 release-manifest.json */
  files?: Record<string, string>
  /** 是否生成 runtime/node.exe（默认 true，计入 manifest，换装时跳过） */
  includeRuntime?: boolean
  /** preserve 文件（不计入 manifest）：包根 trainer.config.json 与 data/ 下用户数据 */
  preserve?: {
    trainerConfig?: string
    sqlite?: string
    sqliteWal?: string
    savedChoice?: string
    trainerState?: string
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) for (const rel of await walkFiles(path)) out.push(`${entry.name}/${rel}`)
    else if (entry.isFile()) out.push(entry.name)
  }
  return out
}

/**
 * 构造迷你发布包：package.json(version)＋release.json＋release-manifest.json（逐文件
 * sha256，不计自身，与 build.mjs 口径一致）＋spec.files＋可选 preserve 文件。
 * release-manifest 只列包自有文件（files＋runtime），绝不列 trainer.config.json 与
 * data/——这正是换装"只搬 manifest 内文件"语义的夹具基础。
 */
export async function writeMiniPackage(root: string, spec: MiniPackageSpec): Promise<void> {
  const nodeVersion = spec.nodeVersion ?? '24.1.1'
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: APP_ID, version: spec.version, private: true, type: 'module' }, null, 2)}\n`)
  await writeFile(join(root, 'release.json'), `${JSON.stringify({ appId: APP_ID, version: spec.version, nodeVersion, platform: 'win32', arch: 'x64', publicURL: null }, null, 2)}\n`)
  const manifestFiles: Array<{ path: string, sha256: string, bytes: number }> = []
  for (const [rel, content] of Object.entries(spec.files ?? {})) {
    const target = join(root, ...rel.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    const buffer = Buffer.from(content)
    manifestFiles.push({ path: rel, sha256: await sha256Bytes(buffer), bytes: buffer.length })
  }
  if (spec.includeRuntime !== false) {
    const bytes = Buffer.from(`node runtime ${nodeVersion} for ${spec.version}`)
    await mkdir(join(root, 'runtime'), { recursive: true })
    await writeFile(join(root, 'runtime', 'node.exe'), bytes)
    await writeFile(join(root, 'runtime', 'LICENSE'), `Node.js license ${nodeVersion}\n`)
    manifestFiles.push({ path: 'runtime/node.exe', sha256: await sha256Bytes(bytes), bytes: bytes.length })
    manifestFiles.push({ path: 'runtime/LICENSE', sha256: await sha256Bytes(`Node.js license ${nodeVersion}\n`), bytes: `Node.js license ${nodeVersion}\n`.length })
  }
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path))
  await writeFile(join(root, 'release-manifest.json'), `${JSON.stringify({
    schemaVersion: 1, appId: APP_ID, version: spec.version, nodeVersion,
    platform: 'win32', arch: 'x64', createdAt: new Date().toISOString(), files: manifestFiles,
  }, null, 2)}\n`)
  const preserve = spec.preserve ?? {}
  if (preserve.trainerConfig !== undefined) {
    await writeFile(join(root, 'trainer.config.json'), preserve.trainerConfig)
  }
  if (preserve.sqlite !== undefined) await writeFile(join(root, 'data', 'trainer.sqlite'), preserve.sqlite)
  if (preserve.sqliteWal !== undefined) await writeFile(join(root, 'data', 'trainer.sqlite-wal'), preserve.sqliteWal)
  if (preserve.savedChoice !== undefined) await writeFile(join(root, 'data', 'saved-tdx-choice.json'), preserve.savedChoice)
  if (preserve.trainerState !== undefined) await writeFile(join(root, 'data', 'trainer-state.json'), preserve.trainerState)
}

/** 用 PowerShell Compress-Archive 把 folder 压成 zip（含顶层目录，同发布产物形态）。 */
export async function zipDirectory(folder: string, zipPath: string): Promise<void> {
  const command = `Compress-Archive -LiteralPath '${folder.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true })
}

const releaseZipCache = new Map<string, { buffer: Buffer, artifactName: string }>()

/** 构造发布形态 zip 并返回字节：目录名固定 kline-trainer-v<version>-windows-x64。
 *  按 spec 缓存（Compress-Archive 需拉起 PowerShell 进程，全量套件并行下控制负载）。 */
export async function buildReleaseZip(spec: MiniPackageSpec, workDir: string): Promise<{ buffer: Buffer, artifactName: string }> {
  const cacheKey = JSON.stringify(spec)
  const cached = releaseZipCache.get(cacheKey)
  if (cached) return { buffer: Buffer.from(cached.buffer), artifactName: cached.artifactName }
  const artifactName = `kline-trainer-v${spec.version}-windows-x64`
  const folder = join(workDir, artifactName)
  await rm(folder, { recursive: true, force: true })
  await writeMiniPackage(folder, spec)
  const zipPath = join(workDir, `${artifactName}.zip`)
  await zipDirectory(folder, zipPath)
  const buffer = await readFile(zipPath)
  releaseZipCache.set(cacheKey, { buffer, artifactName })
  return { buffer: Buffer.from(buffer), artifactName }
}

// ---- 纯 JS 存储型 zip 构造（不依赖 PowerShell；用于恶意条目与读取器 method-0 边界） ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export interface StoredZipEntry { name: string, data: Buffer }

/** 最小 stored（method 0）zip 写入器：EOCD＋central directory＋local headers。 */
export function buildStoredZip(entries: StoredZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)
    locals.push(local, entry.data)
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)
    offset += local.length + entry.data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralDirectory, eocd])
}

// ---- fetch 替身 ----

export interface FakeResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export function fakeTextResponse(text: string, status = 200): FakeResponse {
  const buffer = Buffer.from(text, 'utf8')
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(buffer.length) },
    text: async () => text,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  }
}

export function fakeBufferResponse(data: Buffer, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(data.length) },
    text: async () => data.toString('utf8'),
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
