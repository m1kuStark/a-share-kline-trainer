// UI-03 用户反馈回归：股票搜索口径——代码/名称前缀优先、子串兜底、拼音首字母前缀。
// 反思：旧口径（纯子串包含）让"贵州"这种前缀查询混入无序结果，且完全无法用首字母检索；
// 用户实测用 GZMT/GZ 找不到贵州茅台属测试盲区（此前无任何搜索口径断言）。
import { describe, expect, it } from 'vitest'
import { buildStockSearchIndex, searchStockIndex, stockInitials } from '../src/tdx/stock-search.js'

const STOCKS = [
  { code: '600519', market: 'sh', name: '贵州茅台', bars: 100, lastDate: '2026-09-24' },
  { code: '000589', market: 'sz', name: '贵州轮胎', bars: 100, lastDate: '2026-09-24' },
  { code: '600589', market: 'sh', name: '广东榕泰', bars: 100, lastDate: '2026-09-24' },
  { code: '000001', market: 'sz', name: '平安银行', bars: 100, lastDate: '2026-09-24' },
]

const INDEX = buildStockSearchIndex(STOCKS)

function codes(items: ReturnType<typeof searchStockIndex>): string[] {
  return items.map(item => item.code)
}

describe('stock search index', () => {
  it('computes pinyin initials for stock names including multi-tone chars', () => {
    expect(stockInitials('贵州茅台')).toBe('gzmt')
    expect(stockInitials('平安银行')).toBe('payh')
    expect(stockInitials('重庆啤酒')).toBe('cqpj')
  })

  it('matches by code prefix and orders prefix hits before substring hits', () => {
    // "6005" 前缀命中 600519/600589；子串命中不存在
    expect(codes(searchStockIndex(INDEX, '6005'))).toEqual(['600519', '600589'])
    // "005" 子串命中 000589/600519/600589（无前缀命中），仍可被搜到
    expect(codes(searchStockIndex(INDEX, '005')).sort()).toEqual(['000589', '600519', '600589'])
  })

  it('matches by name prefix', () => {
    expect(codes(searchStockIndex(INDEX, '贵州')).sort()).toEqual(['000589', '600519'])
  })

  it('matches by pinyin-initial prefix, case-insensitively', () => {
    expect(codes(searchStockIndex(INDEX, 'GZMT'))).toEqual(['600519'])
    expect(codes(searchStockIndex(INDEX, 'gz')).sort()).toEqual(['000589', '600519'])
    // 首字母串长于股票名首字母串时不误报
    expect(searchStockIndex(INDEX, 'gzmtx')).toEqual([])
  })

  it('keeps substring name matching as fallback behind prefix hits', () => {
    // "茅台" 不是"贵州茅台"的前缀，但子串仍命中
    expect(codes(searchStockIndex(INDEX, '茅台'))).toEqual(['600519'])
  })

  it('returns everything for empty query and honors market filter', () => {
    expect(searchStockIndex(INDEX, '  ')).toHaveLength(4)
    expect(codes(searchStockIndex(INDEX, '6005', 'sz'))).toEqual([])
    expect(codes(searchStockIndex(INDEX, '6005', 'sh'))).toEqual(['600519', '600589'])
  })

  it('finds nothing for unmatched query without throwing', () => {
    expect(searchStockIndex(INDEX, '不存在')).toEqual([])
  })
})
