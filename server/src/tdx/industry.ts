import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
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
 * 不扫描 TDX 目录，避免把未知版本的板块文件误当成 56 行业权威来源。
 */
export async function loadIndustryCatalog(config: Pick<AppConfig, 'industryMapPath'>): Promise<IndustryCatalogResult> {
  const path = config.industryMapPath ?? null
  if (!path) return { ok: false, reason: '未配置通达信 56 行业映射文件（TRAINER_INDUSTRY_MAP）' }
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
