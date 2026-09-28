import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import {
  HttpError, abandonTraining, advanceTraining, createTraining, equityCurveOf,
  previewTrainingRange, settleTraining, tradeTraining, trainingSnapshot,
} from '../src/train/engine.js'

// 测试内联辅助：以既有列形态导出 trainings 行，供零写断言（不新增 allowlist 外文件）。
function trainingsRows(database: DatabaseSync): Array<Record<string, unknown>> {
  return database.prepare(
    'SELECT id, tier, code, status, initial_cash, adjust_mode FROM trainings ORDER BY id',
  ).all() as unknown as Array<Record<string, unknown>>
}

// M5-DEFAULTS-01（control-handoff-20260928-50）：创建默认资金/复权——服务端主导的
// 显式 > 持久默认 > 缺省内建，提交边界解析，RANGE 预览复权一致性，损坏默认拒绝。
// 合成 TDX 夹具（临时目录），不触碰真实数据。

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

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T00:00:00Z`)
  while (dates.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

async function createFixture(): Promise<{ root: string; dates: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-m5defaults-'))
  const directory = join(root, 'vipdoc', 'sh', 'lday')
  await mkdir(directory, { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  const dates = weekdayDates('2026-07-01', 32)
  const records = dates.map((date, index) => dayRecord(
    Number(date.replaceAll('-', '')),
    10 + index * 0.1 - 0.05,
    10 + index * 0.1,
  ))
  await writeFile(join(directory, 'sh600000.day'), Buffer.concat(records))
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), Buffer.alloc(4))
  return { root, dates }
}

async function withFixture(run: (context: { database: DatabaseSync; config: AppConfig; dates: string[] }) => Promise<void>): Promise<void> {
  const { root, dates } = await createFixture()
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  try {
    await run({ database, config, dates })
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}

function setFlag(database: DatabaseSync, key: string, value: string): void {
  database.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function setDefaults(database: DatabaseSync, initialCash: string, adjustMode: string): void {
  setFlag(database, 'training_initial_cash', initialCash)
  setFlag(database, 'training_adjust_mode', adjustMode)
}

describe('M5-DEFAULTS：创建优先级（显式 > 持久默认 > 缺省内建）', () => {
  it('五档省略资金/复权：采用持久默认并写入既有列，初始权益等于最终资金', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'raw')
      const training = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] })
      expect(training.initialCash).toBe(800000)
      expect(training.adjustMode).toBe('raw')
      expect(equityCurveOf(database, training.id)[0]).toEqual({ date: dates[0], equity: 800000 })
    })
  })

  it('缺键内建：无任何默认键时省略创建得 1,000,000/forward', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const training = await createTraining(database, config, { tier: '3M', code: '600000', start_date: dates[0] })
      expect(training.initialCash).toBe(1_000_000)
      expect(training.adjustMode).toBe('forward')
    })
  })

  it('缺省在提交边界解析：beforeCommit 等待期间改默认进入最终快照', async () => {
    await withFixture(async ({ database, config, dates }) => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const pending = createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0],
        beforeCommit: () => gate,
      })
      setDefaults(database, '750000.5', 'raw')
      release()
      const training = await pending
      expect(training.initialCash).toBe(750000.5)
      expect(training.adjustMode).toBe('raw')
    })
  })

  it('显式合法值逐字段优先：与默认不同的显式资金/复权保持不变（两种混合缺省）', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'raw')
      const explicitCash = await createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: 600000,
      })
      expect(explicitCash.initialCash).toBe(600000)
      expect(explicitCash.adjustMode).toBe('raw')
      await settleTraining(database, explicitCash.id)
      const explicitMode = await createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], adjust_mode: 'forward',
      })
      expect(explicitMode.initialCash).toBe(800000)
      expect(explicitMode.adjustMode).toBe('forward')
    })
  })

  it('显式 null / 错误类型是非法输入 400，不视为省略', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'raw')
      await expect(createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: null,
      })).rejects.toThrow(/初始资金/)
      await expect(createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: '600000' as unknown as number,
      })).rejects.toThrow(/初始资金/)
      await expect(createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], adjust_mode: null,
      })).rejects.toThrow(/复权方式/)
      expect(trainingsRows(database)).toHaveLength(0)
    })
  })

  it('损坏默认：省略创建 409 TRAINING_DEFAULTS_UNREADABLE 零写；显式两字段不依赖损坏默认可创建', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, 'not-a-number', 'sideways')
      const error = await createTraining(database, config, { tier: '1M', code: '600000', start_date: dates[0] }).then(
        () => null, (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).statusCode).toBe(409)
      expect((error as HttpError).code).toBe('TRAINING_DEFAULTS_UNREADABLE')
      expect(trainingsRows(database)).toHaveLength(0)
      const ok = await createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: 300000, adjust_mode: 'forward',
      })
      expect(ok.initialCash).toBe(300000)
    })
  })
})

describe('M5-DEFAULTS：RANGE 预览与复权一致性', () => {
  async function preview(database: DatabaseSync, config: AppConfig, dates: string[], adjustMode?: 'forward' | 'raw') {
    const now = new Date('2026-09-01T08:00:00.000Z')
    const range = { mode: 'preset' as const, startDate: dates[0], months: 1 as const }
    const { preview: result } = await previewTrainingRange(database, config, {
      code: 'sh600000', range, now, ...(adjustMode === undefined ? {} : { adjustMode }),
    })
    return result
  }

  it('预览未给复权：采用当时有效默认并在返回中可解释', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'raw')
      const result = await preview(database, config, dates)
      expect(result.adjustMode).toBe('raw')
    })
  })

  it('预览后默认复权漂移：提交省略复权 409 RANGE_PREVIEW_STALE 零写', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'forward')
      const now = new Date('2026-09-01T08:00:00.000Z')
      const range = { mode: 'preset' as const, startDate: dates[0], months: 1 as const }
      const { preview: stored } = await previewTrainingRange(database, config, { code: 'sh600000', range, now })
      expect(stored.adjustMode).toBe('forward')
      // 预览之后默认复权漂移为 raw
      setDefaults(database, '800000', 'raw')
      const error = await createTraining(database, config, {
        code: 'sh600000', range, previewId: stored.previewId, now,
      }).then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).statusCode).toBe(409)
      expect((error as HttpError).code).toBe('RANGE_PREVIEW_STALE')
      expect(trainingsRows(database)).toHaveLength(0)
      expect(equityCurveOf(database, 1)).toHaveLength(0)
    })
  })

  it('提交显式复权与预览一致可创建；省略资金用提交边界最新默认', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'raw')
      const now = new Date('2026-09-01T08:00:00.000Z')
      const range = { mode: 'preset' as const, startDate: dates[0], months: 1 as const }
      const { preview: stored } = await previewTrainingRange(database, config, { code: 'sh600000', range, now })
      // 提交显式与预览一致（raw）
      const explicit = await createTraining(database, config, {
        code: 'sh600000', range, previewId: stored.previewId, now, adjust_mode: 'raw',
      })
      expect(explicit.adjustMode).toBe('raw')
      expect(explicit.initialCash).toBe(800000)
      await settleTraining(database, explicit.id)
      // 新预览 + 省略复权 + 等待期间改资金默认：复权一致可创建，资金用提交边界最新值
      setDefaults(database, '900000.25', 'raw')
      const { preview: stored2 } = await previewTrainingRange(database, config, { code: 'sh600000', range, now })
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const pending = createTraining(database, config, {
        code: 'sh600000', range, previewId: stored2.previewId, now, beforeCommit: () => gate,
      })
      setDefaults(database, '950000', 'raw')
      release()
      const created = await pending
      expect(created.adjustMode).toBe('raw')
      expect(created.initialCash).toBe(950000)
    })
  })

  it('提交显式复权与预览不一致仍 409（既有保护保留）', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, '800000', 'raw')
      const now = new Date('2026-09-01T08:00:00.000Z')
      const range = { mode: 'preset' as const, startDate: dates[0], months: 1 as const }
      const { preview: stored } = await previewTrainingRange(database, config, { code: 'sh600000', range, now })
      await expect(createTraining(database, config, {
        code: 'sh600000', range, previewId: stored.previewId, now, adjust_mode: 'forward',
      })).rejects.toThrow(/复权方式与预览不一致/)
    })
  })

  it('损坏默认下 RANGE 预览省略复权 409；显式复权预览不受影响', async () => {
    await withFixture(async ({ database, config, dates }) => {
      setDefaults(database, 'oops', 'raw')
      const now = new Date('2026-09-01T08:00:00.000Z')
      const range = { mode: 'preset' as const, startDate: dates[0], months: 1 as const }
      const error = await previewTrainingRange(database, config, { code: 'sh600000', range, now }).then(
        () => null, (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).code).toBe('TRAINING_DEFAULTS_UNREADABLE')
      const { preview: stored } = await previewTrainingRange(database, config, { code: 'sh600000', range, now, adjustMode: 'forward' })
      expect(stored.adjustMode).toBe('forward')
    })
  })
})

describe('M5-DEFAULTS：默认修改不漂移当前局', () => {
  it('A 局以自定义创建后改默认：A 的资金/复权/规则与快照不变', async () => {
    await withFixture(async ({ database, config, dates }) => {
      const trainingA = await createTraining(database, config, {
        tier: '1M', code: '600000', start_date: dates[0], initial_cash: 800000, adjust_mode: 'raw',
      })
      await tradeTraining(database, trainingA.id, { side: 'buy', weightPct: 50 })
      const snapshotBefore = trainingSnapshot(database, trainingA.id)
      const curveBefore = equityCurveOf(database, trainingA.id)
      setDefaults(database, '1200000', 'forward')
      await advanceTraining(database, config, trainingA.id)
      const snapshotAfter = trainingSnapshot(database, trainingA.id)
      expect(snapshotAfter.training.initialCash).toBe(800000)
      expect(snapshotAfter.training.adjustMode).toBe('raw')
      expect(snapshotAfter.training.rules).toEqual(snapshotBefore.training.rules)
      expect(equityCurveOf(database, trainingA.id).slice(0, curveBefore.length)).toEqual(curveBefore)
      expect(snapshotAfter.account.equity).toBeGreaterThan(400000)
      await abandonTraining(database, trainingA.id)
    })
  })
})
