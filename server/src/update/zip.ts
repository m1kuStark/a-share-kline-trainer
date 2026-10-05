// UPD-01 zip 校验与解压（矩阵行 UPD-DOWNLOAD-VERIFY / UPD-RUNTIME-COMPAT）。
// 自实现最小 central directory 读取器（EOCD→目录项→local header→stored/inflateRaw），
// 零第三方依赖，使更新器可单文件运行；发布产物由 PowerShell Compress-Archive 生成
// （PS5.1 条目名用反斜杠分隔），条目名统一归一为正斜杠后做安全校验。

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN = 22
const EOCD_SEARCH_WINDOW = 65_536

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  crc32: number
  localHeaderOffset: number
}

export interface ReleaseInfo {
  version: string
  nodeVersion?: string
  appId?: string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_SEARCH_WINDOW - EOCD_MIN)
  for (let index = buffer.length - EOCD_MIN; index >= start; index--) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
      const commentLength = buffer.readUInt16LE(index + 20)
      if (index + EOCD_MIN + commentLength <= buffer.length) return index
    }
  }
  throw new Error('zip 缺少结束目录记录（EOCD），文件不完整')
}

/** 条目名归一（反斜杠→正斜杠）＋安全校验：拒绝遍历/绝对路径/盘符/空段（尾部目录标记除外）。 */
function normalizeAndAssertEntryName(rawName: string): string {
  const normalized = rawName.split('\\').join('/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`不安全的 zip 条目（绝对路径）/ unsafe archive entry: ${rawName}`)
  }
  const segments = normalized.split('/')
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment === '..') throw new Error(`不安全的 zip 条目（路径遍历）/ unsafe archive entry: ${rawName}`)
    // 尾部空段＝目录条目标记（'folder/'），其余空段（双斜杠）拒绝
    if (segment === '' && index !== segments.length - 1) {
      throw new Error(`不安全的 zip 条目（空路径段）/ unsafe archive entry: ${rawName}`)
    }
  }
  return normalized
}

export function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xFFFF || offset === 0xFFFFFFFF) {
    throw new Error('ZIP64 包不支持（超过 4GB 的发布包请走全量下载）')
  }
  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('zip 中央目录损坏')
    }
    const entry: ZipEntry = {
      method: buffer.readUInt16LE(offset + 10),
      crc32: buffer.readUInt32LE(offset + 16),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      name: '',
    }
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    entry.name = normalizeAndAssertEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    entries.push(entry)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const local = entry.localHeaderOffset
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error(`zip 本地头损坏：${entry.name}`)
  }
  const nameLength = buffer.readUInt16LE(local + 26)
  const extraLength = buffer.readUInt16LE(local + 28)
  const dataStart = local + 30 + nameLength + extraLength
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  let output: Buffer
  if (entry.method === 0) output = Buffer.from(data)
  else if (entry.method === 8) output = inflateRawSync(data)
  else throw new Error(`不支持的 zip 压缩方法 ${entry.method}（条目 ${entry.name}）`)
  if (output.length !== entry.uncompressedSize) {
    throw new Error(`zip 条目长度不符：${entry.name}（期望 ${entry.uncompressedSize}，实际 ${output.length}）`)
  }
  if (crc32(output) !== entry.crc32) {
    throw new Error(`zip 条目 CRC 校验失败：${entry.name}`)
  }
  return output
}

/** 读 zip 内顶层（或单层根目录下）的 release.json；无/坏 JSON 返回 null。 */
export function readReleaseInfoFromZip(buffer: Buffer): ReleaseInfo | null {
  const entries = listZipEntries(buffer)
  const candidates = entries
    .filter(entry => entry.name === 'release.json' || /^[^/]+\/release\.json$/.test(entry.name))
    .sort((a, b) => a.name.length - b.name.length)
  if (candidates.length === 0) return null
  const value = JSON.parse(readZipEntry(buffer, candidates[0]).toString('utf8')) as Record<string, unknown>
  if (!value || typeof value !== 'object') return null
  const version = typeof value.version === 'string' ? value.version : ''
  if (version === '') return null
  return {
    version,
    nodeVersion: typeof value.nodeVersion === 'string' ? value.nodeVersion : undefined,
    appId: typeof value.appId === 'string' ? value.appId : undefined,
  }
}

export type VerifyZipCode = 'SHA_MISMATCH' | 'ZIP_CORRUPT' | 'NO_RELEASE' | 'VERSION_MISMATCH' | 'RUNTIME_INCOMPATIBLE'

export type VerifyZipResult =
  | { ok: true; release: ReleaseInfo }
  | { ok: false; code: VerifyZipCode; reason: string }

/**
 * 更新包校验（UPD-DOWNLOAD-VERIFY）：
 * 1) 带 SHA256SUMS 期望值时强制校验（不匹配即拒）；
 * 2) zip 完整性（central directory 可解析＋条目 CRC）；
 * 3) zip 内 release.json.version 与清单版本一致；
 * 4) UPD-RUNTIME-COMPAT：zip 内 nodeVersion 与当前运行包完全一致，否则拒绝在线换装
 *    并提示走全量包重装（v1 保守口径；同时使换装可跳过 runtime/ 规避运行中 exe 锁）。
 */
export function verifyZipArtifact(buffer: Buffer, options: {
  expectedVersion?: string | null
  expectedSha256?: string | null
  currentNodeVersion?: string | null
}): VerifyZipResult {
  if (options.expectedSha256) {
    const actual = createHash('sha256').update(buffer).digest('hex')
    const expected = options.expectedSha256.toLowerCase()
    if (actual !== expected) {
      return { ok: false, code: 'SHA_MISMATCH', reason: `SHA256 校验失败：期望 ${expected}，实际 ${actual}；已拒绝应用该更新包（下载可能不完整或被篡改）` }
    }
  }
  let release: ReleaseInfo | null = null
  try {
    release = readReleaseInfoFromZip(buffer)
  } catch (error) {
    return { ok: false, code: 'ZIP_CORRUPT', reason: `更新包 zip 不完整或损坏（${error instanceof Error ? error.message : String(error)}），已拒绝应用` }
  }
  if (!release) {
    return { ok: false, code: 'NO_RELEASE', reason: '更新包内缺少可读的 release.json，已拒绝应用' }
  }
  if (options.expectedVersion && release.version !== options.expectedVersion) {
    return { ok: false, code: 'VERSION_MISMATCH', reason: `更新包内版本 ${release.version} 与发布清单版本 ${options.expectedVersion} 不一致，已拒绝应用` }
  }
  if (options.currentNodeVersion && release.nodeVersion && release.nodeVersion !== options.currentNodeVersion) {
    return {
      ok: false,
      code: 'RUNTIME_INCOMPATIBLE',
      reason: `新版本更换了内置 Node 运行时（新 ${release.nodeVersion} ≠ 当前 ${options.currentNodeVersion}），在线换装已停止；请从 GitHub Releases 手动下载全量包重新安装（历史训练数据目录不受影响，无需担心数据丢失）`,
    }
  }
  return { ok: true, release }
}

/** 解压 zip 到 destDir（安全条目校验后逐条写盘）；返回内容根（单顶层目录时为其路径）。 */
export async function extractZip(zipPath: string, destDir: string): Promise<string> {
  const buffer = await readFile(zipPath)
  for (const entry of listZipEntries(buffer)) {
    const target = join(destDir, ...entry.name.split('/'))
    if (entry.name.endsWith('/')) {
      await mkdir(target, { recursive: true })
      continue
    }
    const data = readZipEntry(buffer, entry)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }
  const children = await readdir(destDir, { withFileTypes: true })
  if (children.length === 1 && children[0].isDirectory()) {
    return join(destDir, children[0].name)
  }
  return destDir
}
