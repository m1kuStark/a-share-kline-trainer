import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'

// M7-01 随机训练模式·服务端核心。合成 TDX 夹具，不通真实网络、不碰 8787/8791。
// oracle 独立性：全部期望值由本文件夹具（确定性日线序列）与契约
// docs/verification/2026-10/M7-01/design.md §2 独立推算（addDays 等为测试本地实现，
// 不 import 服务端平移函数）；隐藏断言对整个响应做 deep-walk 子串扫描。

const encryptedGbbqRecord = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')

function dayRecord(date: number, open: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(close * 100) + 10, 8)
  buffer.writeInt32LE(Math.round(close * 100) - 10, 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(close * 1_000_000, 20)
  buffer.writeInt32LE(1_000_000, 24)
  return buffer
}

function records(dates: string[]): Buffer {
  return Buffer.concat(dates.map((date, index) => dayRecord(
    Number(date.replaceAll('-', '')),
    10 + index * 0.1 - 0.05,
    10 + index * 0.1,
  )))
}

function weekdayDates(from: string, count: number): string[] {
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  while (out.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const MS_PER_DAY = 86_400_000

/** 测试本地日期平移 oracle（不 import 服务端实现） */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY)
}

/** RF-04 测试本地自然月加法 oracle（不 import 服务端 addMonths） */
function addMonthsLocal(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  const targetYear = Math.floor(total / 12)
  const targetMonth = (total % 12) + 1
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  const targetDay = Math.min(day, daysInTarget)
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

/** RF-04 契约本地实现：完整 months 自然月跨度（窗末日期不超出数据末日）＋200 根预热＋窗口≥2 根
 *  的可行起始日集合；期望值独立推算，不 import 服务端实现。 */
function contractMonthStarts(dates: string[], months: number, warmup = 200): string[] {
  const last = dates[dates.length - 1]
  const starts: string[] = []
  for (let i = warmup; i < dates.length - 1; i++) {
    const end = addMonthsLocal(dates[i], months)
    if (end > last) break
    if (dates[i + 1] <= end) starts.push(dates[i])
  }
  return starts
}

/** RF-04 契约本地实现：起始日＋自然月跨度对应的窗口日期（末根＝跨度内最后一个交易日） */
function contractMonthWindow(dates: string[], start: string, months: number): string[] {
  const end = addMonthsLocal(start, months)
  return dates.filter(date => date >= start && date <= end)
}

const LONG_DATES = weekdayDates('2024-01-02', 520)
const SHORT_DATES = weekdayDates('2024-01-02', 120)
const MID_DATES = weekdayDates('2024-01-02', 260)

interface FixtureStock { market: 'sh' | 'sz'; code: string; name: string; dates: string[] }

const STOCKS: FixtureStock[] = [
  { market: 'sh', code: '600001', name: 'STOCK-AA', dates: LONG_DATES },
  { market: 'sz', code: '000002', name: 'STOCK-BB', dates: LONG_DATES },
  { market: 'sh', code: '600003', name: 'STOCK-CC', dates: SHORT_DATES },
  { market: 'sh', code: '600005', name: 'STOCK-DD', dates: MID_DATES },
]

const NAME_OF = new Map(STOCKS.map(stock => [`${stock.market}${stock.code}`, stock.name]))

const FIXED_NOW = new Date('2026-10-05T07:01:00Z') // 上海 15:01，全部 2024-2025 夹具日线均为完整数据

interface Fixture {
  root: string
  database: DatabaseSync
  config: AppConfig
  app: ReturnType<typeof Fastify>
}

async function createFixture(stocks: FixtureStock[] = STOCKS): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-random-mode-'))
  for (const market of new Set(stocks.map(stock => stock.market))) {
    await mkdir(join(root, 'vipdoc', market, 'lday'), { recursive: true })
  }
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  for (const stock of stocks) {
    await writeFile(join(root, 'vipdoc', stock.market, 'lday', `${stock.market}${stock.code}.day`), records(stock.dates))
  }
  const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
  gbbq.writeUInt32LE(1, 0)
  encryptedGbbqRecord.copy(gbbq, 4)
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)
  // pttab.dat 兜底名称表（GBK 文本，ASCII 名称即可提供与代码不同的真实名称 oracle）
  await writeFile(
    join(root, 'T0002', 'hq_cache', 'pttab.dat'),
    stocks.map(stock => `${stock.market},${stock.code},${stock.name}`).join('\r\n'),
    'utf8',
  )
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  const app = Fastify()
  await registerApi(app, config, database)
  return { root, database, config, app }
}

async function withFixture(run: (fixture: Fixture) => Promise<void>, stocks?: FixtureStock[]): Promise<void> {
  const fixture = await createFixture(stocks)
  try {
    await run(fixture)
  } finally {
    await fixture.app.close()
    fixture.database.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
}

interface TrainingDbRow {
  id: number
  tier: string
  code: string
  name: string
  market: string
  start_date: string
  planned_end: string
  status: string
  blind: number
  range_version: number | null
  range_mode: string | null
  range_bar_count: number | null
  requested_start: string | null
  requested_end: string | null
  random_mode: string | null
  random_time_offset_days: number | null
  created_at: string
  current_date: string | null
}

function trainingRows(database: DatabaseSync): TrainingDbRow[] {
  return database.prepare('SELECT * FROM trainings ORDER BY id').all() as unknown as TrainingDbRow[]
}

function singleTraining(database: DatabaseSync): TrainingDbRow {
  const rows = trainingRows(database)
  expect(rows.length).toBe(1)
  return rows[0]
}

function trainingCount(database: DatabaseSync): number {
  return (database.prepare('SELECT COUNT(*) AS count FROM trainings').get() as unknown as { count: number }).count
}

/** 契约口径的 random_stock 池判定（测试本地独立实现） */
function contractRangePool(start: string, end: string): string[] {
  return STOCKS.filter(stock => {
    const prefix = stock.dates.filter(date => date <= start)
    if (prefix.length < 201) return false // 200 根预热 + 窗首本身
    const last = stock.dates[stock.dates.length - 1]
    if (last < end) return false
    const startBar = prefix[prefix.length - 1]
    return stock.dates.some(date => date > startBar && date <= end)
  }).map(stock => stock.code)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/trainings/random creation', () => {
  it('creates a random_stock training from a valid date window and hides code and name while running', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const pool = contractRangePool('2025-06-02', '2025-09-30')
      expect(pool.sort()).toEqual(['000002', '600001']) // 夹具自证：池恰为两只长历史股票
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30' },
      })
      expect(response.statusCode).toBe(201)
      const training = response.json().training
      expect(training.code).toBeNull()
      expect(training.name).toBeNull()
      expect(['sh', 'sz']).toContain(training.market)
      expect(training.random).toEqual({ dimension: 'random_stock', hideStock: true, hideTime: false })
      expect(training.tier).toBe('RANGE')
      expect(training.range.mode).toBe('random')
      expect(training.range.barCount).toBeGreaterThanOrEqual(2)
      const row = singleTraining(database)
      expect(['600001', '000002']).toContain(row.code)
      expect(row.name).toBe(NAME_OF.get(`${row.market}${row.code}`))
      expect(row.random_mode).toBe('random_stock')
      expect(row.random_time_offset_days).toBeNull()
      expect(row.blind).toBe(0)
      expect(row.tier).toBe('RANGE')
      expect(row.range_mode).toBe('random')
      // 池内两只股票共用同一日期序列（LONG_DATES）
      const alignedStart = [...LONG_DATES].reverse().find(date => date <= '2025-06-02')
      expect(row.start_date).toBe(alignedStart)
      expect(row.planned_end).toBe('2025-09-30')
      expect(row.range_bar_count).toBe(LONG_DATES.filter(date => date >= row.start_date && date <= '2025-09-30').length)
      // random_stock 不隐藏时间：响应日期即真实日期
      expect(training.startDate).toBe(row.start_date)
      expect(training.plannedEnd).toBe('2025-09-30')
      expect(training.currentDate).toBe(row.start_date)
    })
  })

  it('creates a random_time training with exact window_bars and shifted dates while code stays visible', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(response.statusCode).toBe(201)
      const training = response.json().training
      expect(training.code).toBe('600001')
      expect(training.name).toBe('STOCK-AA')
      expect(training.random).toEqual({ dimension: 'random_time', hideStock: false, hideTime: true })
      const row = singleTraining(database)
      expect(row.code).toBe('600001')
      expect(row.random_mode).toBe('random_time')
      expect(row.random_time_offset_days).not.toBeNull()
      expect(row.random_time_offset_days).not.toBe(0)
      expect(Math.abs(row.random_time_offset_days as number)).toBeLessThanOrEqual(3650)
      const startIndex = LONG_DATES.indexOf(row.start_date)
      expect(startIndex).toBeGreaterThanOrEqual(200)
      expect(startIndex).toBeLessThanOrEqual(LONG_DATES.length - 10)
      expect(row.planned_end).toBe(LONG_DATES[startIndex + 9])
      expect(row.range_bar_count).toBe(10)
      // 响应日期整体偏移且常数一致
      const offset = daysBetween(row.start_date, training.startDate)
      expect(offset).toBe(row.random_time_offset_days)
      expect(training.plannedEnd).toBe(addDays(row.planned_end, offset))
      expect(training.currentDate).toBe(addDays(row.current_date ?? row.start_date, offset))
      expect(training.range.barCount).toBe(10)
      expect(training.range.startDate).toBe(addDays(row.start_date, offset))
      expect(training.range.endDate).toBe(addDays(row.planned_end, offset))
    })
  })

  it('creates a random_both training hiding both stock identity and time', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_both', window_bars: 10 },
      })
      expect(response.statusCode).toBe(201)
      const training = response.json().training
      expect(training.code).toBeNull()
      expect(training.name).toBeNull()
      expect(training.random).toEqual({ dimension: 'random_both', hideStock: true, hideTime: true })
      const row = singleTraining(database)
      // 契约池：目录 bars ≥ window_bars+200 → 600001/000002/600005
      expect(['600001', '000002', '600005']).toContain(row.code)
      expect(row.random_mode).toBe('random_both')
      expect(row.random_time_offset_days).not.toBeNull()
      const offset = daysBetween(row.start_date, training.startDate)
      expect(offset).toBe(row.random_time_offset_days)
      expect(training.startDate).not.toBe(row.start_date)
    })
  })

  it('rejects with 422 RANDOM_STOCK_UNIVERSE_EMPTY when no stock covers the requested window', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_stock', start_date: '2025-06-02', end_date: '2030-01-01' },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json().code).toBe('RANDOM_STOCK_UNIVERSE_EMPTY')
      expect(trainingCount(database)).toBe(0)
    })
  })

  it('rejects with 422 RANDOM_STOCK_UNIVERSE_EMPTY for random_both when catalog pool is empty', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_both', window_bars: 500 },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json().code).toBe('RANDOM_STOCK_UNIVERSE_EMPTY')
      expect(trainingCount(database)).toBe(0)
    })
  })

  it('rejects with 422 RANDOM_WINDOW_NOT_FIT when the stock cannot fit the window with warmup', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600003', window_bars: 10 },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json().code).toBe('RANDOM_WINDOW_NOT_FIT')
      expect(trainingCount(database)).toBe(0)
    })
  })
})

// RF-04 随机时间维度复用经典训练周期：random_time/random_both 支持 window_months 档位参数
// （1/3/6/12/24，与经典 TIER_MONTHS 同口径），窗口＝「N 个自然月日期跨度、起点随机、
// 跨度完整落在数据内」（不换算固定根数）；window_bars 旧口径保留（自定义根数档）。
describe('RF-04 random window by classic tier months (window_months)', () => {
  it('creates a random_time training whose window is a full 3-month calendar span with random start', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_months: 3 },
      })
      expect(response.statusCode).toBe(201)
      const training = response.json().training
      expect(training.code).toBe('600001')
      expect(training.name).toBe('STOCK-AA')
      expect(training.random).toEqual({ dimension: 'random_time', hideStock: false, hideTime: true })
      // 录制契约冻结（validation.ts RANGE_MODES＋旧五档不得携带 range 元数据）：随机训练 tier 恒为 RANGE 哨兵
      expect(training.tier).toBe('RANGE')
      const row = singleTraining(database)
      const starts = contractMonthStarts(LONG_DATES, 3)
      expect(starts.length, '夹具自证：600001 应存在 3 个月档可行起点').toBeGreaterThan(0)
      expect(starts).toContain(row.start_date)
      const windowDates = contractMonthWindow(LONG_DATES, row.start_date, 3)
      expect(windowDates.length).toBeGreaterThanOrEqual(2)
      expect(row.planned_end).toBe(windowDates[windowDates.length - 1])
      expect(row.range_bar_count).toBe(windowDates.length)
      expect(row.range_mode).toBe('random')
      // 偏移语义与 window_bars 相同：响应日期整体常数偏移
      const offset = daysBetween(row.start_date, training.startDate)
      expect(offset).toBe(row.random_time_offset_days)
      expect(training.plannedEnd).toBe(addDays(row.planned_end, offset))
      expect(training.range.startDate).toBe(addDays(row.start_date, offset))
      expect(training.range.endDate).toBe(addDays(row.planned_end, offset))
      expect(training.range.barCount).toBe(windowDates.length)
      // notes 记录档位口径（月跨度，非根数）
      expect(training.range.notes.join(' ')).toContain('3 个自然月')
    })
  })

  it('picks window_months start deterministically from the injectable rng across the feasible set', async () => {
    await withFixture(async ({ database, config }) => {
      vi.setSystemTime(FIXED_NOW)
      const { createRandomTraining } = await import('../src/train/random-mode.js')
      const first = await createRandomTraining(database, config, {
        dimension: 'random_time', code: '600001', window_months: 3, random: () => 0,
      })
      expect(first.code).toBe('600001')
      const firstRow = singleTraining(database)
      const starts = contractMonthStarts(LONG_DATES, 3)
      expect(firstRow.start_date).toBe(starts[0]) // rng=0 → 首个可行起点（预热边界之后首个完整跨度起点）
      expect(contractMonthWindow(LONG_DATES, firstRow.start_date, 3).length).toBe(firstRow.range_bar_count)
      await database.prepare('UPDATE trainings SET status = ?').run('settled')
      const tail = await createRandomTraining(database, config, {
        dimension: 'random_time', code: '600001', window_months: 3, random: () => 0.999999,
      })
      expect(tail.code).toBe('600001')
      const tailRow = trainingRows(database).at(-1) as TrainingDbRow
      expect(tailRow.start_date).toBe(starts[starts.length - 1]) // rng≈1 → 末个可行起点
      expect(tailRow.random_time_offset_days).not.toBe(0)
      // 时长口径一致：任意可行起点的窗口均为完整 3 个自然月跨度（交易末日 ≤ 跨度末日且 ≥ 跨度起点）
      for (const row of [firstRow, tailRow]) {
        const spanEnd = addMonthsLocal(row.start_date, 3)
        expect(row.planned_end <= spanEnd).toBe(true)
        expect(daysBetween(row.start_date, row.planned_end)).toBeGreaterThanOrEqual(80)
      }
    })
  })

  it('creates a random_both training with window_months picking from stocks that fit the span', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_both', window_months: 1 },
      })
      expect(response.statusCode).toBe(201)
      const training = response.json().training
      expect(training.code).toBeNull()
      expect(training.name).toBeNull()
      expect(training.random).toEqual({ dimension: 'random_both', hideStock: true, hideTime: true })
      const row = singleTraining(database)
      // 契约池：目录中能放下完整 1 个月跨度＋200 预热的股票（600001/000002/600005；600003 预热不足）
      const stock = STOCKS.find(item => item.code === row.code) as FixtureStock
      expect(['600001', '000002', '600005']).toContain(row.code)
      expect(contractMonthStarts(stock.dates, 1)).toContain(row.start_date)
      const windowDates = contractMonthWindow(stock.dates, row.start_date, 1)
      expect(windowDates.length).toBeGreaterThanOrEqual(2)
      expect(row.planned_end).toBe(windowDates[windowDates.length - 1])
      expect(row.range_bar_count).toBe(windowDates.length)
      expect(training.range.barCount).toBe(windowDates.length)
      expect(training.range.notes.join(' ')).toContain('1 个自然月')
    })
  })

  it('keeps the legacy window_bars caliber working alongside window_months', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const response = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(response.statusCode).toBe(201)
      const row = singleTraining(database)
      expect(row.range_bar_count).toBe(10) // 旧口径（根数）不回归
      expect(trainingRows(database).length).toBe(1)
    })
  })

  it('settles a window_months training and surfaces it in range rankings under its exact window key', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_months: 3 },
      })
      expect(created.statusCode).toBe(201)
      const row = singleTraining(database)
      await app.inject({ method: 'POST', url: `/api/trainings/${row.id}/settle` })
      const rankings = await app.inject({ method: 'GET', url: '/api/rankings?view=range' })
      expect(rankings.statusCode).toBe(200)
      const groups = rankings.json().rangeGroups as Array<{ key: string; complete: Array<{ id: number }>; earlySettled: Array<{ id: number }> }>
      const group = groups.find(item => item.key === `RANGE:${row.start_date}:${row.planned_end}`)
      expect(group, '月跨度随机训练应按其精确窗口键进入范围排行（tier 哨兵口径不变）').toBeTruthy()
      expect([...(group?.complete ?? []), ...(group?.earlySettled ?? [])].map(item => item.id)).toContain(row.id)
    })
  })

  it('rejects with 422 RANDOM_WINDOW_NOT_FIT when warmup or the full month span cannot fit', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      // 600003＝120 根：预热 200 根即不足
      const warmupCase = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600003', window_months: 1 },
      })
      expect(warmupCase.statusCode).toBe(422)
      expect(warmupCase.json().code).toBe('RANDOM_WINDOW_NOT_FIT')
      // 600005＝260 根：预热足够，但从任何可行起点都无法容纳完整 3 个自然月跨度（数据止于 ~2025-01）
      const spanCase = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600005', window_months: 3 },
      })
      expect(spanCase.statusCode).toBe(422)
      expect(spanCase.json().code).toBe('RANDOM_WINDOW_NOT_FIT')
      expect(contractMonthStarts(MID_DATES, 3), '夹具自证：600005 无完整 3 个月跨度可行起点').toEqual([])
      expect(trainingCount(database)).toBe(0)
    })
  })

  it('rejects window_months misuse with 400 and zero side effects', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const cases: Array<Record<string, unknown>> = [
        { dimension: 'random_time', code: '600001', window_months: 5 }, // 非经典档位月数
        { dimension: 'random_time', code: '600001', window_months: 0 },
        { dimension: 'random_time', code: '600001', window_months: -3 },
        { dimension: 'random_time', code: '600001', window_months: 2.5 },
        { dimension: 'random_time', code: '600001', window_months: '3M' },
        { dimension: 'random_time', code: '600001', window_months: null },
        { dimension: 'random_time', code: '600001', window_months: 3, window_bars: 100 }, // 二选一
        { dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30', window_months: 3 },
        { dimension: 'random_time', code: '600001', window_months: 3, start_date: '2025-06-02' },
        { dimension: 'random_both', window_months: 12, code: '600001' },
      ]
      for (const payload of cases) {
        const response = await app.inject({ method: 'POST', url: '/api/trainings/random', payload })
        expect(response.statusCode, `payload ${JSON.stringify(payload)} should be 400`).toBe(400)
        expect(response.json().error).toBeTruthy()
        expect(trainingCount(database), `payload ${JSON.stringify(payload)} must not write`).toBe(0)
      }
    })
  })
})

describe('random session hiding while running', () => {
  it('keeps every running random session response free of stock code and name substrings via deep walk', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_both', window_bars: 12, orders_enabled: true },
      })
      expect(created.statusCode).toBe(201)
      const row = singleTraining(database)
      const realCode = row.code
      const realName = row.name
      expect(realName).not.toBe(realCode) // pttab 名称与代码不同，子串断言对两者独立有效
      const id = row.id
      const responses: Array<{ label: string; body: string }> = [{ label: 'create', body: created.body }]
      const collect = async (label: string, method: string, url: string, payload?: unknown): Promise<void> => {
        const response = await app.inject({ method, url, payload })
        expect(response.statusCode).toBeLessThan(500)
        responses.push({ label, body: response.body })
      }
      await collect('active', 'GET', '/api/trainings/active')
      await collect('snapshot', 'GET', `/api/trainings/${id}`)
      await collect('bars-1d', 'GET', `/api/trainings/${id}/bars`)
      await collect('bars-1w', 'GET', `/api/trainings/${id}/bars?tf=1W`)
      await collect('bars-1m', 'GET', `/api/trainings/${id}/bars?tf=1M`)
      await collect('next', 'POST', `/api/trainings/${id}/next`)
      await collect('orders-get', 'GET', `/api/trainings/${id}/orders`)
      const closePrice = (database.prepare('SELECT current_close AS close FROM trainings WHERE id = ?').get(id) as unknown as { close: number }).close
      await collect('orders-post', 'POST', `/api/trainings/${id}/orders`, {
        side: 'buy', order_type: 'limit', trigger_price: Math.round(closePrice * 1.2 * 100) / 100, shares: 100,
      })
      await collect('trade', 'POST', `/api/trainings/${id}/trade`, { side: 'buy', shares: 100 })
      await collect('drawings-put', 'PUT', `/api/trainings/${id}/drawings`, [
        { id: 'd1', name: 'priceLine', points: [{ timestamp: Date.parse('2025-01-06T00:00:00Z'), value: 10 }] },
      ])
      await collect('drawings-get', 'GET', `/api/trainings/${id}/drawings`)
      await collect('recording-context', 'GET', `/api/trainings/${id}/recording-context`)
      for (const { label, body } of responses) {
        expect(body, `response ${label} leaked stock code`).not.toContain(realCode)
        expect(body, `response ${label} leaked stock name`).not.toContain(realName)
      }
    })
  })

  it('shifts all market dates by one constant session offset preserving gaps and leaving ISO wall-clock real', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(created.statusCode).toBe(201)
      const row = singleTraining(database)
      const offset = row.random_time_offset_days as number
      const id = row.id
      const active = await app.inject({ method: 'GET', url: '/api/trainings/active' })
      const training = active.json().training
      expect(training.currentDate).toBe(addDays(row.current_date ?? row.start_date, offset))
      expect(training.startDate).toBe(addDays(row.start_date, offset))
      // 挂钟 ISO 时间戳保持真实（createdAt 不是市场日期）
      expect(training.createdAt).toBe(row.created_at)
      // 日线：可见集合 = 该股 ≤ current 的全部日线，逐根平移
      const realBars = LONG_DATES.filter(date => date <= (row.current_date ?? row.start_date))
      const daily = await app.inject({ method: 'GET', url: `/api/trainings/${id}/bars` })
      const shiftedBars = (daily.json().bars as Array<{ date: string }>).map(bar => bar.date)
      expect(shiftedBars).toEqual(realBars.map(date => addDays(date, offset)))
      // 间距与缺口结构保留：相邻差分序列一致
      const realGaps = realBars.slice(1).map((date, index) => daysBetween(realBars[index], date))
      const shiftedGaps = shiftedBars.slice(1).map((date, index) => daysBetween(shiftedBars[index], date))
      expect(shiftedGaps).toEqual(realGaps)
      // 周线：真实周一键平移后逐根对齐（期望集按契约独立推算）
      const weekly = await app.inject({ method: 'GET', url: `/api/trainings/${id}/bars?tf=1W` })
      const shiftedWeekly = (weekly.json().bars as Array<{ date: string }>).map(bar => bar.date)
      const expectedWeekly = [...new Set(realBars.map(date => {
        const day = new Date(`${date}T00:00:00Z`)
        const mondayShift = (day.getUTCDay() + 6) % 7
        const monday = new Date(day.getTime() - mondayShift * MS_PER_DAY).toISOString().slice(0, 10)
        return addDays(monday, offset)
      }))]
      expect(shiftedWeekly).toEqual(expectedWeekly)
      // 月键：真实月（该月内含可见日线）首日平移后取月
      const monthly = await app.inject({ method: 'GET', url: `/api/trainings/${id}/bars?tf=1M` })
      const shiftedMonths = (monthly.json().bars as Array<{ date: string }>).map(bar => bar.date)
      const expectedMonths = [...new Set(realBars.map(date => date.slice(0, 7)))]
        .map(month => addDays(`${month}-01`, offset).slice(0, 7))
      expect(shiftedMonths).toEqual(expectedMonths)
    })
  })

  it('round-trips shifted before queries and drawing timestamps into real server space', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(created.statusCode).toBe(201)
      const row = singleTraining(database)
      const offset = row.random_time_offset_days as number
      const id = row.id
      const current = row.current_date ?? row.start_date
      const realBars = LONG_DATES.filter(date => date <= current)
      const daily = await app.inject({ method: 'GET', url: `/api/trainings/${id}/bars` })
      const shiftedBars = (daily.json().bars as Array<{ date: string }>).map(bar => bar.date)
      // 客户端只能拿到偏移空间：以 shiftedBars[5] 为 before 取更早 7 根
      const chunk = await app.inject({
        method: 'GET', url: `/api/trainings/${id}/bars?before=${shiftedBars[5]}&count=7`,
      })
      expect(chunk.statusCode).toBe(200)
      const expectedReal = realBars.filter(date => date < realBars[5]).slice(-7)
      expect((chunk.json().bars as Array<{ date: string }>).map(bar => bar.date))
        .toEqual(expectedReal.map(date => addDays(date, offset)))
      // 画线：偏移空间 timestamp 落库为真实空间，读取时再正向偏移（对称）
      const realAnchor = realBars[3]
      const shiftedTimestamp = Date.parse(`${addDays(realAnchor, offset)}T00:00:00Z`)
      const put = await app.inject({
        method: 'PUT', url: `/api/trainings/${id}/drawings`,
        payload: [{ id: 'd1', name: 'priceLine', points: [{ timestamp: shiftedTimestamp, value: 10 }] }],
      })
      expect(put.statusCode).toBe(200)
      const stored = JSON.parse((database.prepare('SELECT payload FROM drawings WHERE training_id = ?').get(id) as unknown as { payload: string }).payload)
      expect(stored[0].points[0].timestamp).toBe(Date.parse(`${realAnchor}T00:00:00Z`))
      const get = await app.inject({ method: 'GET', url: `/api/trainings/${id}/drawings` })
      expect(get.statusCode).toBe(200)
      expect((get.json().drawings as Array<{ points: Array<{ timestamp: number }> }>)[0].points[0].timestamp)
        .toBe(shiftedTimestamp)
    })
  })
})

describe('random session reveal and classic compatibility', () => {
  it('reveals real stock and dates after settle and abandon and in history endpoints', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_both', window_bars: 10 },
      })
      expect(created.statusCode).toBe(201)
      const row = singleTraining(database)
      const id = row.id
      // 运行中历史端点 409（既有防未来守卫，同时构成“运行中不返回”约束）
      const historyWhileRunning = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(historyWhileRunning.statusCode).toBe(409)
      const settled = await app.inject({ method: 'POST', url: `/api/trainings/${id}/settle` })
      expect(settled.statusCode).toBe(200)
      const settleBody = settled.json()
      expect(settleBody.training.code).toBe(row.code)
      expect(settleBody.training.name).toBe(row.name)
      expect(settleBody.training.startDate).toBe(row.start_date)
      expect(settleBody.training.plannedEnd).toBe(row.planned_end)
      expect(settleBody.equityCurve[0].date).toBe(row.start_date)
      const snapshot = await app.inject({ method: 'GET', url: `/api/trainings/${id}` })
      expect(snapshot.json().training.code).toBe(row.code)
      const history = await app.inject({ method: 'GET', url: '/api/trainings/history' })
      expect(history.statusCode).toBe(200)
      expect(history.body).toContain(row.code)
      expect(history.body).toContain(row.name)
      const report = await app.inject({ method: 'GET', url: `/api/trainings/${id}/report` })
      expect(report.statusCode).toBe(200)
      expect(report.body).toContain(row.code)
      expect(report.body).toContain(row.start_date)
      expect(report.body).toContain(row.planned_end)
      // 放弃同样进入结束态并揭晓
      const second = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(second.statusCode).toBe(201)
      const secondRow = trainingRows(database).at(-1) as TrainingDbRow
      const abandoned = await app.inject({ method: 'POST', url: `/api/trainings/${secondRow.id}/abandon` })
      expect(abandoned.statusCode).toBe(200)
      expect(abandoned.json().training.code).toBe(secondRow.code)
      expect(abandoned.json().training.startDate).toBe(secondRow.start_date)
    })
  })

  it('keeps classic tier creation fully unmasked with no random field', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { tier: '1M', code: '600001', start_date: '2025-06-02' },
      })
      expect(created.statusCode).toBe(201)
      const training = created.json().training
      expect(training.code).toBe('600001')
      expect(training.name).toBe('STOCK-AA')
      expect(training.random).toBeUndefined()
      expect(training.startDate).toBe([...LONG_DATES].reverse().find(date => date <= '2025-06-02'))
      const active = await app.inject({ method: 'GET', url: '/api/trainings/active' })
      expect(active.json().training.code).toBe('600001')
      const row = singleTraining(database)
      expect(row.random_mode).toBeNull()
      expect(row.random_time_offset_days).toBeNull()
    })
  })
})

describe('random selection determinism and input validation', () => {
  it('derives every random decision from the injectable rng deterministically', async () => {
    await withFixture(async ({ database: firstDb, config: firstConfig }) => {
      vi.setSystemTime(FIXED_NOW)
      const { createRandomTraining } = await import('../src/train/random-mode.js')
      // random_stock：池按目录代码排序为 [000002, 600001]，rng=0 取首位、rng=0.9 取末位
      const firstStock = await createRandomTraining(firstDb, firstConfig, {
        dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30', random: () => 0,
      })
      expect(firstStock.code).toBeNull()
      const firstRow = singleTraining(firstDb)
      expect(firstRow.code).toBe('000002')
      expect(firstRow.random_time_offset_days).toBeNull()
      await withFixture(async ({ database: secondDb, config: secondConfig }) => {
        const secondStock = await createRandomTraining(secondDb, secondConfig, {
          dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30', random: () => 0,
        })
        expect(secondStock.code).toBeNull()
        const secondRow = singleTraining(secondDb)
        expect(secondRow.code).toBe(firstRow.code)
        expect(secondRow.start_date).toBe(firstRow.start_date)
        expect(secondRow.planned_end).toBe(firstRow.planned_end)
      })
      // 先结束首局（单活动训练约束），再验证 rng=0.9 取池末位
      await firstDb.prepare('UPDATE trainings SET status = ?').run('settled')
      const highRoll = await createRandomTraining(firstDb, firstConfig, {
        dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30', random: () => 0.9,
      })
      expect(highRoll.code).toBeNull()
      const highRow = trainingRows(firstDb).at(-1) as TrainingDbRow
      expect(highRow.code).toBe('600001')
      // random_time：rng=0 → 起点恰为第 201 根（含 200 根预热）；rng≈1 → 最后一个可行起点
      await firstDb.prepare('UPDATE trainings SET status = ?').run('settled')
      const zeroWindow = await createRandomTraining(firstDb, firstConfig, {
        dimension: 'random_time', code: '600001', window_bars: 10, random: () => 0,
      })
      expect(zeroWindow.code).toBe('600001')
      const zeroRow = trainingRows(firstDb).at(-1) as TrainingDbRow
      expect(zeroRow.start_date).toBe(LONG_DATES[200])
      expect(zeroRow.planned_end).toBe(LONG_DATES[209])
      await firstDb.prepare('UPDATE trainings SET status = ? WHERE id = ?').run('settled', zeroRow.id)
      const tailWindow = await createRandomTraining(firstDb, firstConfig, {
        dimension: 'random_time', code: '600001', window_bars: 10, random: () => 0.999999,
      })
      const tailRow = trainingRows(firstDb).at(-1) as TrainingDbRow
      expect(tailRow.start_date).toBe(LONG_DATES[510])
      expect(tailRow.planned_end).toBe(LONG_DATES[519])
      // 偏移常量：同种子重放一致、非零
      expect(zeroRow.random_time_offset_days).not.toBe(0)
      expect(tailRow.random_time_offset_days).not.toBe(0)
    })
  })

  it('validates request bodies with 400 and zero side effects', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(FIXED_NOW)
      const cases: Array<Record<string, unknown>> = [
        {},
        { dimension: 'random_everything' },
        { dimension: 'random_time', code: '600001', window_bars: 0 },
        { dimension: 'random_time', code: '600001', window_bars: 10.5 },
        { dimension: 'random_time', code: '600001', window_bars: -3 },
        { dimension: 'random_time', window_bars: 10 },
        { dimension: 'random_time', code: '999999' },
        { dimension: 'random_time', code: '600001', window_bars: 10, start_date: '2025-06-02' },
        { dimension: 'random_stock' },
        { dimension: 'random_stock', end_date: '2025-09-30' },
        { dimension: 'random_stock', start_date: '2025-09-30', end_date: '2025-06-02' },
        { dimension: 'random_stock', start_date: '2025/06/02', end_date: '2025-09-30' },
        { dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30', code: '600001' },
        { dimension: 'random_stock', start_date: '2025-06-02', end_date: '2025-09-30', window_bars: 10 },
        { dimension: 'random_both', code: '600001' },
        { dimension: 'random_both', start_date: '2025-06-02' },
        { dimension: 'random_time', code: '600001', initial_cash: -5 },
        { dimension: 'random_time', code: '600001', adjust_mode: 'backward' },
        { dimension: 'random_time', code: '600001', clock_mode: 'sometimes' },
      ]
      for (const payload of cases) {
        const response = await app.inject({ method: 'POST', url: '/api/trainings/random', payload })
        expect(response.statusCode, `payload ${JSON.stringify(payload)} should be 400`).toBe(400)
        expect(response.json().error).toBeTruthy()
        expect(trainingCount(database), `payload ${JSON.stringify(payload)} must not write`).toBe(0)
      }
      // 单活动训练约束沿用经典提交边界
      const first = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(first.statusCode).toBe(201)
      const second = await app.inject({
        method: 'POST', url: '/api/trainings/random',
        payload: { dimension: 'random_time', code: '600001', window_bars: 10 },
      })
      expect(second.statusCode).toBe(409)
      expect(trainingCount(database)).toBe(1)
    })
  })

  it('shifts date substrings inside longer strings and preserves ISO datetimes via the pure shifter', async () => {
    const { shiftDateSubstrings } = await import('../src/train/random-mode.js')
    const shifted = shiftDateSubstrings('个股日线止于 2025-03-10，尚未确认覆盖至计划结束 2025-04-20；区间起点 2025-01-06。', 45)
    expect(shifted).toBe(`个股日线止于 ${addDays('2025-03-10', 45)}，尚未确认覆盖至计划结束 ${addDays('2025-04-20', 45)}；区间起点 ${addDays('2025-01-06', 45)}。`)
    const iso = shiftDateSubstrings('created 2025-03-10T08:00:00.000Z and 2026-10-05T07:01:00.000Z', 45)
    expect(iso).toBe('created 2025-03-10T08:00:00.000Z and 2026-10-05T07:01:00.000Z')
    const negative = shiftDateSubstrings('尾日 2025-12-31', -400)
    expect(negative).toBe(`尾日 ${addDays('2025-12-31', -400)}`)
  })
})
