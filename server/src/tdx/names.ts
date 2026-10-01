import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { TdxMarket } from './stocks.js'

export interface StockName {
  code: string
  market: TdxMarket
  name: string
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('gb18030').decode(bytes).replace(/\0/g, '').trim()
}

function marketFromCode(code: string): TdxMarket {
  if (code.startsWith('6') || code.startsWith('68')) return 'sh'
  if (code.startsWith('8') || code.startsWith('4')) return 'bj'
  return 'sz'
}

function cleanName(value: string): string {
  return value.replace(/[\u0000\xff]+/g, '').trim()
}

export async function parseTnfFile(filePath: string, market: TdxMarket): Promise<StockName[]> {
  const bytes = await readFile(filePath)
  const results = new Map<string, StockName>()
  for (let offset = 0; offset <= bytes.length - 6; offset += 1) {
    if (offset > 0 && bytes[offset - 1] >= 0x30 && bytes[offset - 1] <= 0x39) continue
    const code = Buffer.from(bytes.subarray(offset, offset + 6)).toString('ascii')
    if (!/^\d{6}$/.test(code)) continue
    const next = bytes[offset + 6]
    if (next >= 0x30 && next <= 0x39) continue
    if (marketFromCode(code) !== market) continue
    const rawName = bytes.subarray(offset + 31, Math.min(bytes.length, offset + 63))
    const zero = rawName.indexOf(0)
    const name = cleanName(decodeText(zero >= 0 ? rawName.subarray(0, zero) : rawName)) || code
    if (!/[\u4e00-\u9fffA-Za-z]/.test(name)) continue
    results.set(code, { code, market, name })
    offset += 5
  }
  return [...results.values()]
}

interface DbfField { name: string; length: number; offset: number }

export async function parseBaseDbf(filePath: string): Promise<StockName[]> {
  const bytes = await readFile(filePath)
  if (bytes.length < 33) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = view.getUint16(8, true)
  const recordLength = view.getUint16(10, true)
  const recordCount = view.getUint32(4, true)
  const fields: DbfField[] = []
  for (let offset = 32; offset + 32 <= headerLength - 1; offset += 32) {
    if (bytes[offset] === 0x0d) break
    const name = decodeText(bytes.subarray(offset, offset + 11)).replace(/\0/g, '')
    fields.push({ name, length: bytes[offset + 16], offset: 0 })
  }
  let cursor = 1
  for (const field of fields) { field.offset = cursor; cursor += field.length }
  const codeField = fields.find(field => /GPDM|CODE|证券代码/i.test(field.name))
  const nameField = fields.find(field => /GPMC|NAME|证券简称/i.test(field.name))
  if (!codeField || !nameField) return []
  const results: StockName[] = []
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength
    if (start + recordLength > bytes.length || bytes[start] === 0x2a) continue
    const code = decodeText(bytes.subarray(start + codeField.offset, start + codeField.offset + codeField.length)).replace(/\D/g, '').slice(-6)
    if (!/^\d{6}$/.test(code)) continue
    const name = decodeText(bytes.subarray(start + nameField.offset, start + nameField.offset + nameField.length)) || code
    results.push({ code, market: marketFromCode(code), name })
  }
  return results
}

/** pttab.dat 是通达信对停牌/退市等非当前证券的代码名称兜底表（GBK 文本：市场,代码,简称）。 */
export async function parsePttabFile(filePath: string): Promise<StockName[]> {
  const bytes = await readFile(filePath)
  const text = new TextDecoder('gb18030').decode(bytes)
  const result: StockName[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(',')
    if (parts.length < 3 || !/^\d{6}$/.test(parts[1])) continue
    const name = cleanName(parts.slice(2).join(',')).trim()
    if (!name) continue
    result.push({ code: parts[1], market: marketFromCode(parts[1]), name })
  }
  return result
}

export async function loadStockNames(tdxRoot: string, market: TdxMarket): Promise<StockName[]> {
  const file = join(tdxRoot, 'T0002', 'hq_cache', `${market}s.tnf`)
  let parsed: StockName[] = []
  try {
    parsed = await parseTnfFile(file, market)
  } catch {
    // Keep the DBF fallback below; a missing or damaged TNF must not erase names.
  }
  let fallback: StockName[] = []
  try {
    fallback = (await parseBaseDbf(join(tdxRoot, 'T0002', 'hq_cache', 'base.dbf'))).filter(item => item.market === market)
  } catch {
    // A valid TNF is still useful when base.dbf is absent.
  }
  let legacy: StockName[] = []
  try {
    legacy = (await parsePttabFile(join(tdxRoot, 'T0002', 'hq_cache', 'pttab.dat'))).filter(item => item.market === market)
  } catch {
    // pttab.dat is optional and usually only fills delisted/suspended names.
  }
  // Precedence: TNF, then base.dbf, then pttab for symbols missing from both.
  const merged = new Map(legacy.map(item => [item.code, item]))
  for (const item of fallback) merged.set(item.code, item)
  for (const item of parsed) {
    const existing = merged.get(item.code)
    if (!existing || item.name !== item.code) merged.set(item.code, item)
  }
  return [...merged.values()].sort((left, right) => left.code.localeCompare(right.code))
}

export function codeFromDayFile(fileName: string): string | null {
  const match = basename(fileName).match(/(\d{6})\.day$/i)
  return match?.[1] ?? null
}
