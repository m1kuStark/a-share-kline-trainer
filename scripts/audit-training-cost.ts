import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { buildChartSpace, trainingSnapshot } from '../server/src/train/engine.js'
import { readDayFile } from '../server/src/tdx/dayfile.js'
import { migrateDatabase } from '../server/src/db.js'

// Clone the relevant ledger into memory; never rewind the user's training database.
const trainingId = Number(process.argv[2] ?? 25)
const tag = process.argv[3] ?? 'before'
if (!Number.isSafeInteger(trainingId) || !/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid audit arguments')
const source = new DatabaseSync(join(homedir(), '.a-share-kline-trainer', 'trainer.sqlite'), { readOnly: true })
const database = new DatabaseSync(':memory:')
const row = source.prepare('SELECT * FROM trainings WHERE id=?').get(trainingId) as Record<string, any>
if (!row) throw new Error('Training not found')
const tables = ['trainings', 'trades', 'position_events', 'adj_factors', 'settings', 'equity_curve']
for (const table of tables) {
  const schema = source.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table) as { sql: string }
  database.exec(schema.sql)
  const values = table === 'trainings' ? [row]
    : table === 'adj_factors' ? source.prepare('SELECT * FROM adj_factors WHERE market=? AND code=?').all(row.market, row.code)
      : table === 'settings' ? source.prepare('SELECT * FROM settings').all()
        : source.prepare(`SELECT * FROM ${table} WHERE training_id=?`).all(trainingId)
  for (const value of values) {
    const keys = Object.keys(value)
    database.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(value) as any[])
  }
}
const trades = database.prepare('SELECT * FROM trades ORDER BY seq').all() as Array<Record<string, any>>
migrateDatabase(database)
// This independent audit covers bonus/dividend ledgers; paid-rights basis has its own literal-fixture tests.
if (database.prepare('SELECT 1 FROM adj_factors WHERE rights_shares > 0 LIMIT 1').get()) {
  throw new Error('Paid-rights stock requires a separate subscription-cost audit')
}
const events = database.prepare('SELECT * FROM position_events ORDER BY date,seq').all() as Array<Record<string, any>>
const tdxRoot = process.env.TDX_ROOT?.trim()
if (!tdxRoot) throw new Error('TDX_ROOT must point to the local read-only TongDaXin root')
const daily = await readDayFile(join(tdxRoot, 'vipdoc', row.market, 'lday', `${row.market}${row.code}.day`))
const cutoffs = [...new Set([...trades.map(t => t.trade_date), ...events.map(e => e.date)])].sort()
const checks: Record<string, unknown>[] = []
for (const date of cutoffs) {
  database.exec('SAVEPOINT checkpoint')
  try {
    database.prepare('DELETE FROM trades WHERE trade_date>?').run(date)
    database.prepare('DELETE FROM position_events WHERE date>?').run(date)
    const close = daily.find(bar => bar.date === date)?.close
    if (!close) throw new Error(`Missing close at ${date}`)
    database.prepare('UPDATE trainings SET current_date=?,current_close=? WHERE id=?').run(date, close, trainingId)
    let cash = Number(row.initial_cash), shares = 0, cost = 0
    const items = [...trades.filter(t => t.trade_date <= date).map(t => ({ date: t.trade_date, seq: t.seq, kind: 'trade', value: t })), ...events.filter(e => e.date <= date).map(e => ({ date: e.date, seq: e.seq, kind: 'event', value: e }))]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.kind !== b.kind ? a.kind === 'event' ? -1 : 1 : a.seq - b.seq))
    for (const item of items) {
      const v = item.value
      if (item.kind === 'event') { shares += v.shares_delta; cash += v.cash_delta }
      else if (v.side === 'buy') { shares += v.shares; cost += v.amount + v.fee; cash -= v.amount + v.fee }
      else { cost *= (shares - v.shares) / shares; shares -= v.shares; cash += v.amount - v.fee; if (shares === 0) cost = 0 }
    }
    const expected = shares > 0 ? cost / shares : null
    const snapshot = trainingSnapshot(database, trainingId)
    const chart = buildChartSpace(database, trainingId, snapshot.trades)
    const chartCost = chart.costPrice ?? snapshot.account.costPrice
    checks.push({ date, close, shares, manualCost: expected, accountCost: snapshot.account.costPrice, chartCost, unrealized: shares * close - cost, totalProfit: cash + shares * close - row.initial_cash, accountMatches: Math.abs(snapshot.account.cash - cash) < 1e-5 && snapshot.account.shares === shares && (expected === null ? snapshot.account.costPrice === null : Math.abs(snapshot.account.costPrice! - expected) < 1e-6), chartMatches: expected === null ? chartCost === null : chartCost !== null && Math.abs(chartCost - expected) < 1e-6 })
  } finally { database.exec('ROLLBACK TO checkpoint'); database.exec('RELEASE checkpoint') }
}
source.close()
database.close()
const report = { trainingId, code: row.code, trades: trades.length, corporateEvents: events, checks }
const path = resolve(`docs/verification/cost-audit-${trainingId}-${tag}.json`)
await writeFile(path, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ path, checkpoints: checks.length, accountMismatches: checks.filter(c => !c.accountMatches).length, chartMismatches: checks.filter(c => !c.chartMatches).length, profitButLineAbove: checks.filter(c => Number(c.unrealized) > 0 && Number(c.chartCost) > Number(c.close)) }))
