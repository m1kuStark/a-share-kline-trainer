// 股票搜索索引（UI-03 用户反馈）：代码/名称前缀优先、子串兜底，名称支持拼音首字母前缀。
// 索引随股票目录一次构建缓存；pinyin-pro 仅在服务端使用（MIT，见 THIRD-PARTY-NOTICES.md）。
import { pinyin } from 'pinyin-pro'

export interface StockSearchItem {
  code: string
  market: string
  name: string
  bars: number
  lastDate: string | null
}

interface IndexedStock extends StockSearchItem {
  codeLower: string
  nameLower: string
  initialsLower: string
}

/** 名称 → 拼音首字母串（非中文字符原样保留，如 *ST）；失败回退空串，仅损失首字母匹配。 */
export function stockInitials(name: string): string {
  try {
    return pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase()
  } catch {
    return ''
  }
}

export function buildStockSearchIndex(stocks: readonly StockSearchItem[]): IndexedStock[] {
  return stocks.map(stock => ({
    ...stock,
    codeLower: stock.code.toLowerCase(),
    nameLower: stock.name.toLowerCase(),
    initialsLower: stockInitials(stock.name),
  }))
}

export type StockSearchIndex = ReturnType<typeof buildStockSearchIndex>

/**
 * 搜索口径（用户拍板）：前缀命中优先于子串命中；前缀含代码、名称与拼音首字母，
 * 子串仅代码与名称。空查询返回全部（调用方裁剪上限）。返回公开字段，不泄露索引内部键。
 */
export function searchStockIndex(index: StockSearchIndex, q: string, market?: string): StockSearchItem[] {
  const query = q.trim().toLowerCase()
  const candidates = market ? index.filter(stock => stock.market === market) : index
  const toPublic = (stock: IndexedStock): StockSearchItem => ({
    code: stock.code, market: stock.market, name: stock.name, bars: stock.bars, lastDate: stock.lastDate,
  })
  if (!query) return candidates.map(toPublic)
  const prefix: IndexedStock[] = []
  const contains: IndexedStock[] = []
  for (const stock of candidates) {
    const isPrefix =
      stock.codeLower.startsWith(query) ||
      stock.nameLower.startsWith(query) ||
      stock.initialsLower.startsWith(query)
    if (isPrefix) {
      prefix.push(stock)
    } else if (stock.codeLower.includes(query) || stock.nameLower.includes(query)) {
      contains.push(stock)
    }
  }
  return [...prefix, ...contains].map(toPublic)
}
