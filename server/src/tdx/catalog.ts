import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { readLastDayDate } from './dayfile.js'
import { codeFromDayFile, loadStockNames } from './names.js'
import { isAShareCode, type StockSummary, type TdxMarket } from './stocks.js'

export interface CatalogRefreshStats {
  refreshed: number
  reused: number
  removed: number
}

export interface CatalogRefreshResult {
  stocks: StockSummary[]
  stats: CatalogRefreshStats
}

interface CachedStockRow {
  code: string
  market: TdxMarket
  name: string
  bars: number
  mtime: string
  last_date: string | null
}

function readCachedStocks(database: DatabaseSync): StockSummary[] {
  const rows = database.prepare(`
    SELECT code, market, name, bars, mtime, last_date
    FROM stocks ORDER BY code
  `).all() as unknown as CachedStockRow[]
  return rows.map(row => ({
    code: row.code,
    market: row.market,
    name: row.name,
    bars: row.bars,
    mtime: row.mtime,
    lastDate: row.last_date,
  }))
}

export async function refreshStockCatalog(database: DatabaseSync, tdxRoot: string): Promise<CatalogRefreshResult> {
  const cached = new Map(readCachedStocks(database).map(stock => [`${stock.market}:${stock.code}`, stock]))
  const seen = new Set<string>()
  const stats: CatalogRefreshStats = { refreshed: 0, reused: 0, removed: 0 }
  const upsert = database.prepare(`
    INSERT INTO stocks (code, market, name, type, bars, mtime, last_date)
    VALUES (?, ?, ?, 'A', ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      market = excluded.market, name = excluded.name, type = excluded.type,
      bars = excluded.bars, mtime = excluded.mtime, last_date = excluded.last_date
  `)

  for (const market of ['sh', 'sz', 'bj'] as TdxMarket[]) {
    const directory = join(tdxRoot, 'vipdoc', market, 'lday')
    const names = new Map((await loadStockNames(tdxRoot, market)).map(item => [item.code, item.name]))
    const files = await readdir(directory).catch(() => [])
    for (const file of files.filter(item => item.toLowerCase().endsWith('.day'))) {
      const code = codeFromDayFile(file)
      if (!code || !isAShareCode(market, code)) continue
      const key = `${market}:${code}`
      seen.add(key)
      const filePath = join(directory, file)
      const info = await stat(filePath)
      const mtime = info.mtime.toISOString()
      const existing = cached.get(key)
      const name = names.get(code) ?? existing?.name ?? code
      if (existing?.mtime === mtime && existing.bars === Math.floor(info.size / 32)) {
        stats.reused += 1
        if (existing.name !== name) upsert.run(code, market, name, existing.bars, mtime, existing.lastDate)
        continue
      }
      upsert.run(code, market, name, Math.floor(info.size / 32), mtime, await readLastDayDate(filePath))
      stats.refreshed += 1
    }
  }

  const remove = database.prepare('DELETE FROM stocks WHERE code = ?')
  for (const stock of cached.values()) {
    if (!seen.has(`${stock.market}:${stock.code}`)) {
      remove.run(stock.code)
      stats.removed += 1
    }
  }
  return { stocks: readCachedStocks(database), stats }
}
