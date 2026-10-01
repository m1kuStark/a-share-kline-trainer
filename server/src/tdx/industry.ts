import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AppConfig } from '../config.js'

export interface IndustryEntry {
  id: string
  name: string
  codes: string[]
}

export interface IndustryCatalog {
  version: string
  source: string
  sha256: string
  entries: IndustryEntry[]
}

export type IndustryCatalogResult =
  | { ok: true; catalog: IndustryCatalog }
  | { ok: false; reason: string }

/**
 * 读取显式行业映射文件。文件格式允许为
 * `{version, industries: [{id, name, codes}]}` 或直接为该数组；
 * 未配置显式映射时仅读取已确认格式的 TDX 行业文件（tdxzs3.cfg + tdxhy.cfg），
 * 不扫描未知目录或概念/自定义板块文件。
 */
type IndustryConfig = Pick<AppConfig, 'industryMapPath'> & Partial<Pick<AppConfig, 'tdxRoot'>>

function pipeRows(raw: string): string[][] {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.split('|').map(part => part.trim()))
}

function decodeTdxConfig(bytes: Uint8Array): string {
  // TDX desktop files are GBK/GB18030 text even when the surrounding app uses UTF-8.
  return new TextDecoder('gb18030').decode(bytes)
}

/**
 * 通达信本地行业文件（T0002/hq_cache）解析：
 * - tdxzs3.cfg 的 type=2 行是行业目录，字段为 name|code|type|...|blockCode；
 * - tdxhy.cfg 的第二列是股票代码，第三列是其行业 blockCode。
 * 只有目录恰好包含 56 个唯一行业时才认为来源可用于排行，避免把概念/自定义板块误当行业。
 */
async function loadTdxIndustryCatalog(tdxRoot: string): Promise<IndustryCatalogResult> {
  const cache = join(tdxRoot, 'T0002', 'hq_cache')
  let directoryBytes: Buffer
  let membershipBytes: Buffer
  try {
    ;[directoryBytes, membershipBytes] = await Promise.all([
      readFile(join(cache, 'tdxzs3.cfg')),
      readFile(join(cache, 'tdxhy.cfg')),
    ])
  } catch {
    return { ok: false, reason: '未找到通达信行业文件 T0002/hq_cache/tdxzs3.cfg 或 tdxhy.cfg' }
  }
  const directoryRaw = decodeTdxConfig(directoryBytes)
  const membershipRaw = decodeTdxConfig(membershipBytes)
  const directoryRows = pipeRows(directoryRaw)
  const membershipRows = pipeRows(membershipRaw)
  // The current desktop build stores 56 industry roots as the five-character
  // prefixes of Txxxxxx membership codes. Older fixtures/builds expose a
  // directly enumerated 56-row directory; retain that verified fallback.
  const tRoots = new Set(membershipRows.map(parts => parts[2]).filter(code => /^T\d{4,}$/.test(code)).map(code => code.slice(0, 5)).filter(code => code !== 'T00'))
  let directory: Array<{ name: string; id: string; blockCode: string }>
  if (tRoots.size === 56) {
    const byBlock = new Map(directoryRows.filter(parts => parts.length >= 6 && parts[0] && parts[1] && parts[5]).map(parts => [parts[5], { name: parts[0], id: parts[1], blockCode: parts[5] }]))
    directory = [...tRoots].map(blockCode => byBlock.get(blockCode)).filter((entry): entry is { name: string; id: string; blockCode: string } => !!entry)
    if (directory.length !== 56) return { ok: false, reason: `通达信行业目录缺少 ${56 - directory.length} 个 T 行业根目录（tdxzs3.cfg）` }
  } else {
    directory = directoryRows
      .filter(parts => parts.length >= 6 && parts[2] === '2' && parts[0] && parts[1] && parts[5])
      .map(parts => ({ name: parts[0], id: parts[1], blockCode: parts[5] }))
  }
  const unique = new Map(directory.map(entry => [entry.id, entry]))
  if (unique.size !== 56) {
    return { ok: false, reason: `通达信行业目录应包含 56 个行业，当前可核验 ${unique.size} 个（tdxzs3.cfg type=2）` }
  }
  const memberships = new Map<string, string[]>()
  for (const parts of membershipRows) {
    const code = parts[1]
    const blockCode = parts[2]
    if (!/^\d{6}$/.test(code) || !blockCode) continue
    const current = memberships.get(code) ?? []
    if (!current.includes(blockCode)) current.push(blockCode)
    memberships.set(code, current)
  }
  const entries: IndustryEntry[] = [...unique.values()].map(entry => {
    const codes: string[] = []
    for (const [code, blockCodes] of memberships) {
      if (blockCodes.some(blockCode => entry.blockCode.length === 5
        ? blockCode.startsWith(entry.blockCode)
        : blockCode === entry.blockCode)) codes.push(code)
    }
    return { id: entry.id, name: entry.name, codes: codes.sort() }
  })
  const sha256 = createHash('sha256').update(directoryBytes).update(Buffer.from([0])).update(membershipBytes).digest('hex')
  return {
    ok: true,
    catalog: { version: `tdx-local-${sha256.slice(0, 12)}`, source: 'T0002/hq_cache/tdxzs3.cfg+tdxhy.cfg', sha256, entries },
  }
}

export async function loadIndustryCatalog(config: IndustryConfig): Promise<IndustryCatalogResult> {
  const path = config.industryMapPath ?? null
  if (!path) {
    if (config.tdxRoot) return loadTdxIndustryCatalog(config.tdxRoot)
    return { ok: false, reason: '未配置通达信目录，无法读取 T0002/hq_cache/tdxzs3.cfg 与 tdxhy.cfg' }
  }
  if (!isAbsolute(path)) return { ok: false, reason: '行业映射文件路径必须是绝对路径' }
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { ok: false, reason: '行业映射文件不可读，请检查路径和权限' }
  }
  const sha256 = createHash('sha256').update(raw).digest('hex')
  try {
    const parsed: unknown = JSON.parse(raw)
    const envelope = Array.isArray(parsed) ? { version: 'unknown', industries: parsed } : parsed
    if (!envelope || typeof envelope !== 'object' || !Array.isArray((envelope as { industries?: unknown }).industries)) {
      return { ok: false, reason: '行业映射文件格式无效，应包含 industries 数组' }
    }
    const version = typeof (envelope as { version?: unknown }).version === 'string'
      ? (envelope as { version: string }).version
      : 'unknown'
    const entries: IndustryEntry[] = []
    for (const item of (envelope as { industries: unknown[] }).industries) {
      if (!item || typeof item !== 'object') return { ok: false, reason: '行业映射包含无效条目' }
      const value = item as { id?: unknown; name?: unknown; codes?: unknown }
      if (typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.codes)) {
        return { ok: false, reason: '行业映射条目必须包含 id、name 和 codes' }
      }
      const codes = value.codes.filter((code): code is string => typeof code === 'string' && /^\d{6}$/.test(code))
      if (codes.length !== value.codes.length) return { ok: false, reason: `行业 ${value.id} 含无效股票代码` }
      entries.push({ id: value.id.trim(), name: value.name.trim(), codes: [...new Set(codes)].sort() })
    }
    if (entries.length !== 56) return { ok: false, reason: `行业映射应包含 56 个板块，当前为 ${entries.length} 个` }
    const ids = new Set<string>()
    for (const entry of entries) {
      if (ids.has(entry.id)) return { ok: false, reason: `行业 id 重复：${entry.id}` }
      ids.add(entry.id)
    }
    return { ok: true, catalog: { version, source: path, sha256, entries } }
  } catch {
    return { ok: false, reason: '行业映射文件不是有效 JSON' }
  }
}

export function industryByCode(catalog: IndustryCatalog): Map<string, IndustryEntry> {
  const result = new Map<string, IndustryEntry>()
  for (const entry of catalog.entries) for (const code of entry.codes) result.set(code, entry)
  return result
}
