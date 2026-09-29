// DATA-04 统一行情读取入口——TDX 读取器行为、来源解析/注册、以及「非 TDX 夹具运行训练」
// 的全生命周期回归（创建→K线→交易→推进含权息→结算→范围预览/创建→覆盖等待→503 合约）。
// 合成读取器不触任何文件与网络；TDX 用例使用合成 .day/gbbq 临时夹具。

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import {
  MarketReaderUnavailableError, createTdxMarketReader, registerMarketReader, resolveMarketReader,
  type MarketDataReader,
} from '../src/data/reader.js'
import { publishBatchVersion } from '../src/data/snapshot.js'
import { parseGbbqBuffer, type AdjustmentEvent } from '../src/tdx/gbbq.js'
import type { DayBar } from '../src/tdx/dayfile.js'
import {
  abandonTraining, advanceTraining, createTraining, previewTrainingRange, settleTraining,
  tradeTraining, trainingBars, trainingSnapshot,
} from '../src/train/engine.js'

// ===== 夹具 =====

const encryptedGbbqRecord = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')

function dayRecord(dateIso: string, open: number, close: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(Number(dateIso.replaceAll('-', '')), 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(close * 100) + 10, 8)
  buffer.writeInt32LE(Math.round(close * 100) - 10, 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(close * 1_000_000, 20)
  buffer.writeInt32LE(1_000_000, 24)
  return buffer
}

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T00:00:00Z`)
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

const DATES = weekdayDates('2026-07-01', 20)
const CLOSES = DATES.map((_, index) => 10 + index * 0.1)
const BARS: DayBar[] = DATES.map((date, index) => ({
  date,
  open: CLOSES[index] - 0.05,
  high: CLOSES[index] + 0.1,
  low: CLOSES[index] - 0.1,
  close: CLOSES[index],
  amount: CLOSES[index] * 1_000_000,
  volume: 1_000_000,
}))

function configOf(tdxRoot: string | null): AppConfig {
  return { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot }
}

function memoryDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  return database
}

/** 非 TDX 合成读取器：内存日线（sh600000）＋一条权息（每10股派8、送1，落在 DATES[5]） */
function syntheticReader(options: { available?: boolean } = {}): MarketDataReader {
  const events: AdjustmentEvent[] = [{
    market: 'sh', code: '600000', date: DATES[5], category: 1,
    dividend: 8, rightsPrice: 0, bonusShares: 1, rightsShares: 0, m: 1, c: -0.8,
  }]
  return {
    kind: 'other',
    name: '合成来源',
    available: async () => options.available ?? true,
    readBars: async (market, code, query) => {
      if (market !== 'sh' || code !== '600000') throw new Error(`合成来源无 ${market}${code} 日线`)
      return BARS.filter(bar => (!query?.from || bar.date >= query.from) && (!query?.to || bar.date <= query.to))
    },
    readActions: async (market, code) => {
      if (market !== 'sh' || code !== '600000') return []
      return events.map(event => ({ ...event }))
    },
    readCatalog: async () => [{ code: '600000', market: 'sh', name: '合成浦发', lastDate: DATES.at(-1)!, bars: BARS.length }],
    readCoverage: async () => ({ lastDate: DATES.at(-1)!, rows: BARS.length }),
    readVersion: async () => 'synthetic-v1',
    ensureCaches: async () => {},
  }
}

async function createTdxFixture(): Promise<{ root: string; dayPath: string; gbbqPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-reader-'))
  const directory = join(root, 'vipdoc', 'sh', 'lday')
  await mkdir(directory, { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const dayPath = join(directory, 'sh600519.day')
  await writeFile(dayPath, Buffer.concat(BARS.map((bar, index) => dayRecord(bar.date, bar.open, bar.close))))
  const gbbqPath = join(root, 'T0002', 'hq_cache', 'gbbq')
  const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
  gbbq.writeUInt32LE(1, 0)
  encryptedGbbqRecord.copy(gbbq, 4)
  await writeFile(gbbqPath, gbbq)
  return { root, dayPath, gbbqPath }
}

// ===== 1. TDX 读取器 =====

describe('TDX 市场读取器（createTdxMarketReader）', () => {
  it('readBars：全量与 from/to 闭区间窗口', async () => {
    const { root } = await createTdxFixture()
    try {
      const reader = createTdxMarketReader(memoryDatabase(), configOf(root))
      expect(await reader.available()).toBe(true)
      expect((await reader.readBars('sh', '600519')).length).toBe(BARS.length)
      const window = await reader.readBars('sh', '600519', { from: DATES[2], to: DATES[4] })
      expect(window.map(bar => bar.date)).toEqual([DATES[2], DATES[3], DATES[4]])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('readActions：cached 读持久缓存、fresh 绕过缓存解码现势字节；ensureCaches 后两口径对齐', async () => {
    const { root, gbbqPath } = await createTdxFixture()
    try {
      const reader = createTdxMarketReader(memoryDatabase(), configOf(root))
      // 缓存为空：cached 返回空，fresh 直接解码 gbbq 字节（GPT-WAKE-02 口径经读取器保持）
      expect(await reader.readActions('sh', '600519')).toEqual([])
      const fresh = await reader.readActions('sh', '600519', { fresh: true })
      const expected = parseGbbqBuffer(await readFile(gbbqPath))
        .filter(event => event.market === 'sh' && event.code === '600519')
        .sort((left, right) => left.date.localeCompare(right.date))
      expect(fresh).toEqual(expected)
      expect(fresh.length).toBeGreaterThan(0)
      // 缓存保障后：cached 与 fresh 一致
      await reader.ensureCaches()
      expect(await reader.readActions('sh', '600519')).toEqual(fresh)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('readCatalog / readCoverage / readVersion：目录刷新、覆盖与整批版本', async () => {
    const { root } = await createTdxFixture()
    try {
      const database = memoryDatabase()
      const reader = createTdxMarketReader(database, configOf(root))
      expect(await reader.readVersion()).toBeNull()
      const catalog = await reader.readCatalog()
      expect(catalog).toEqual([{ code: '600519', market: 'sh', name: '600519', lastDate: DATES.at(-1), bars: BARS.length }])
      expect(await reader.readCoverage('sh', '600519')).toEqual({ lastDate: DATES.at(-1), rows: BARS.length })
      expect(await reader.readCoverage('sh', '000001')).toEqual({ lastDate: null, rows: null })
      publishBatchVersion(database, 'batch-xyz')
      expect(await reader.readVersion()).toBe('batch-xyz')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// ===== 2. 来源解析与注册 =====

describe('读取器解析（resolveMarketReader）', () => {
  it('config.tdxRoot 非空 → TDX 优先（与刷新扫描的来源选择同口径）', async () => {
    const unregister = registerMarketReader(syntheticReader())
    try {
      const resolved = await resolveMarketReader(memoryDatabase(), configOf('C:/not-used'))
      expect(resolved.kind).toBe('tdx')
      expect(resolved.name).toBe('通达信本地数据')
    } finally {
      unregister()
    }
  })

  it('无 tdxRoot：按注册顺序取第一个 available() 的读取器；全不可用报明确错误', async () => {
    const database = memoryDatabase()
    const unregisterA = registerMarketReader(syntheticReader({ available: false }))
    const unregisterB = registerMarketReader(syntheticReader())
    try {
      const resolved = await resolveMarketReader(database, configOf(null))
      expect(resolved.kind).toBe('other')
      expect(resolved.name).toBe('合成来源')
      unregisterA()
      unregisterB()
      await expect(resolveMarketReader(database, configOf(null))).rejects.toBeInstanceOf(MarketReaderUnavailableError)
    } finally {
      unregisterA()
      unregisterB()
      database.close()
    }
  })
})

// ===== 3. 非 TDX 夹具运行训练（本轮验收核心） =====

describe('合成读取器上的训练全生命周期', () => {
  it('创建→K线→买入→推进（权息入账）→结算，全程 tdxRoot=null、零文件', async () => {
    const database = memoryDatabase()
    const unregister = registerMarketReader(syntheticReader())
    const config = configOf(null)
    try {
      const created = await createTraining(database, config, { tier: '1M', code: '600000', start_date: DATES[0] })
      expect(created.name).toBe('合成浦发')
      expect(created.startDate).toBe(DATES[0])
      expect(created.tier).toBe('1M')

      const bars = await trainingBars(database, config, created.id, '1D')
      expect(bars.length).toBeGreaterThan(0)
      expect(bars[0].close).toBeCloseTo(CLOSES[0], 6)

      const traded = await tradeTraining(database, created.id, { side: 'buy', weightPct: 50 })
      const shares = traded.snapshot.account.shares
      expect(shares).toBeGreaterThan(0)

      // 推进越过权息日（DATES[5]）：每10股派8→现金增加；每10股送1→股数增加
      let advanced = await advanceTraining(database, config, created.id)
      for (let index = 0; index < 6 && advanced.snapshot.training.currentDate !== DATES[5]; index += 1) {
        advanced = await advanceTraining(database, config, created.id)
      }
      expect(advanced.snapshot.training.currentDate).toBe(DATES[5])
      expect(advanced.snapshot.account.shares).toBeCloseTo(shares * 1.1, 4)
      expect(advanced.snapshot.account.cash).toBeCloseTo(traded.snapshot.account.cash + shares * 0.8, 4)
      const events = database.prepare(
        "SELECT COUNT(*) AS count FROM position_events WHERE training_id = ? AND kind = 'corporate_action'",
      ).get(created.id) as unknown as { count: number }
      expect(events.count).toBe(1)

      const settled = await settleTraining(database, created.id)
      expect(settled.status).toBe('settled')
    } finally {
      unregister()
      database.close()
    }
  })

  it('范围模式：预览指纹与创建复核走统一读取入口（fresh 权息），tdxRoot=null 全程可跑', async () => {
    const database = memoryDatabase()
    const unregister = registerMarketReader(syntheticReader())
    const config = configOf(null)
    try {
      const { preview } = await previewTrainingRange(database, config, {
        code: '600000', market: 'sh',
        range: { mode: 'bars', startDate: DATES[0], count: 5 },
      })
      expect(preview.startDate).toBe(DATES[0])
      expect(preview.barCount).toBe(5)
      expect(preview.sourceFingerprint).not.toBe('')

      const created = await createTraining(database, config, {
        range: { mode: 'bars', startDate: DATES[0], count: 5 },
        previewId: preview.previewId,
        code: '600000',
      })
      expect(created.range?.barCount).toBe(5)
      expect(created.status).toBe('running')
      const abandoned = abandonTraining(database, created.id)
      expect(abandoned.status).toBe('abandoned')
    } finally {
      unregister()
      database.close()
    }
  })

  it('覆盖等待：个股止于数据尾且未到计划结束 → 409 等待而非虚构覆盖', async () => {
    const database = memoryDatabase()
    const limited = syntheticReader()
    const fullBars = limited.readBars
    // 只保留 6 根日线：1M 训练计划结束远超数据尾
    limited.readBars = async (market, code, query) => (await fullBars(market, code, query)).slice(0, 6)
    const unregister = registerMarketReader(limited)
    const config = configOf(null)
    try {
      const created = await createTraining(database, config, { tier: '1M', code: '600000', start_date: DATES[0] })
      for (let index = 0; index < 5; index += 1) await advanceTraining(database, config, created.id)
      await expect(advanceTraining(database, config, created.id)).rejects.toThrow(/等待日线数据/)
    } finally {
      unregister()
      database.close()
    }
  })

  it('无可用来源：保持 503 状态码与中文原因（HttpError 合约）', async () => {
    const database = memoryDatabase()
    try {
      await expect(createTraining(database, configOf(null), { tier: '1M', code: '600519', start_date: DATES[0] }))
        .rejects.toMatchObject({ statusCode: 503 })
      await expect(createTraining(database, configOf(null), { tier: '1M', code: '600519', start_date: DATES[0] }))
        .rejects.toThrow(/未发现 TDX 数据目录/)
    } finally {
      database.close()
    }
  })
})

// ===== 4. 行为保持：TDX 路径回归锚点 =====

describe('TDX 路径经统一入口后的行为保持', () => {
  it('创建落库与快照可用；目录外代码返回 400', async () => {
    const { root } = await createTdxFixture()
    const database = memoryDatabase()
    try {
      const created = await createTraining(database, configOf(root), { tier: '1M', code: '600519', start_date: DATES[0] })
      expect(created.currentDate).toBe(DATES[0])
      const snapshot = trainingSnapshot(database, created.id)
      expect(snapshot.training.id).toBe(created.id)
      await expect(createTraining(database, configOf(root), { tier: '1M', code: '000001', start_date: DATES[0] }))
        .rejects.toMatchObject({ statusCode: 400 })
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('range 快照缺失日线 → 404 TDX data not found（保持既有状态码合约）', async () => {
    const { root, dayPath } = await createTdxFixture()
    const database = memoryDatabase()
    try {
      await rm(dayPath)
      await expect(previewTrainingRange(database, configOf(root), {
        code: '600000', market: 'sh', range: { mode: 'bars', startDate: DATES[0], count: 5 },
      })).rejects.toMatchObject({ statusCode: 404 })
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
