import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import { createTraining, previewTrainingRange, RANGE_PREVIEW_TTL_MS } from '../src/train/engine.js'

// TRAIN-02 第一片：服务端训练范围预览/创建复核。合成夹具，不通达信目录、不写个人库。
// 日历：2026-07-01(三)…07-31(五) 共23根 + 08-03…08-14(五) 共10根 = 33 根。

const encryptedGbbqRecord = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')

function weekdayDates(from: string, through: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  while (cursor.toISOString().slice(0, 10) <= through) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const DATES = weekdayDates('2026-07-01', '2026-08-14')
const LAST = DATES[DATES.length - 1] // 2026-08-14 周五

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

function records(dates: string[], closeOf?: (date: string, index: number) => number): Buffer {
  return Buffer.concat(dates.map((date, index) => dayRecord(
    Number(date.replaceAll('-', '')),
    (closeOf?.(date, index) ?? 10 + index * 0.1) - 0.05,
    closeOf?.(date, index) ?? 10 + index * 0.1,
  )))
}

async function createFixture(): Promise<{ root: string; database: DatabaseSync; app: ReturnType<typeof Fastify> }> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-range-preview-'))
  await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), records(DATES))
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600000.day'), records(DATES))
  const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
  gbbq.writeUInt32LE(1, 0)
  encryptedGbbqRecord.copy(gbbq, 4)
  await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  const app = Fastify()
  await registerApi(app, config, database)
  return { root, database, app }
}

async function withFixture(run: (context: Awaited<ReturnType<typeof createFixture>> & { config: AppConfig }) => Promise<void>): Promise<void> {
  const fixture = await createFixture()
  try {
    await run({ ...fixture, config: { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: fixture.root } })
  } finally {
    await fixture.app.close()
    fixture.database.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
}

function previewPayload(range: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: '600519', market: 'sh', range, adjustMode: 'forward', ...extra }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/training-ranges/preview', () => {
  it('preset 预览返回冻结元信息且不泄露OHLC', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`)) // 上海 15:01，08-14 已完整
      const response = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      expect(response.statusCode).toBe(200)
      const preview = response.json().preview
      expect(preview.version).toBe(1)
      expect(preview.code).toBe('600519')
      expect(preview.market).toBe('sh')
      expect(preview.request).toEqual({ mode: 'preset', startDate: '2026-07-01', months: 1 })
      expect(preview.requestedStart).toBe('2026-07-01')
      expect(preview.requestedEnd).toBe('2026-08-01')
      expect(preview.startDate).toBe('2026-07-01')
      expect(preview.endDate).toBe('2026-07-31')
      expect(preview.barCount).toBe(23)
      expect(preview.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof preview.previewId).toBe('string')
      expect(Number.isNaN(Date.parse(preview.expiresAt))).toBe(false)
      expect(preview.notes).toEqual(expect.arrayContaining([
        expect.stringContaining('仅按现有日线'),
        expect.stringContaining('尾段'),
      ]))
      const serialized = response.body
      expect(serialized).not.toMatch(/"(open|high|low|close|bars|equity|amount|volume)"/)
    })
  })

  it('latest 预览钉定本地末根且 requestedEnd 为空', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const response = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'latest', startDate: '2026-07-01' }),
      })
      expect(response.statusCode).toBe(200)
      const preview = response.json().preview
      expect(preview.requestedEnd).toBeNull()
      expect(preview.endDate).toBe(LAST)
      expect(preview.barCount).toBe(33)
    })
  })

  it('bars 预览自指定起始日取N根，N=1也有明确结束', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const five = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'bars', startDate: '2026-07-01', count: 5 }),
      })
      expect(five.statusCode).toBe(200)
      expect(five.json().preview).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-07', barCount: 5 })
      const one = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'bars', startDate: '2026-07-01', count: 1 }),
      })
      expect(one.statusCode).toBe(200)
      expect(one.json().preview).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-01', barCount: 1 })
    })
  })

  it('同一快照重复预览指纹稳定', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const first = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      const second = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      expect(first.json().preview.sourceFingerprint).toBe(second.json().preview.sourceFingerprint)
      expect(first.json().preview.previewId).not.toBe(second.json().preview.previewId)
    })
  })

  it('上海15:00边界剔除当日未完整日线', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T06:59:00Z`)) // 上海 14:59，当日K线未完整
      const before = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'latest', startDate: '2026-07-01' }),
      })
      expect(before.json().preview.endDate).toBe('2026-08-13')
      expect(before.json().preview.barCount).toBe(32)
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`)) // 上海 15:01
      const after = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'latest', startDate: '2026-07-01' }),
      })
      expect(after.json().preview.endDate).toBe(LAST)
      expect(after.json().preview.barCount).toBe(33)
      expect(after.json().preview.sourceFingerprint).not.toBe(before.json().preview.sourceFingerprint)
    })
  })

  it('请求畸形返回400 INVALID_INPUT，未知mode不能伪装成tier', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      for (const range of [{ mode: 'preset', startDate: '2026-07-01', months: 5 }, { mode: 'bars', startDate: '2026-07-01', count: 0 }, { mode: '3M', startDate: '2026-07-01' }]) {
        const response = await app.inject({
          method: 'POST', url: '/api/training-ranges/preview', payload: previewPayload(range),
        })
        expect(response.statusCode).toBe(400)
        expect(response.json().code).toBe('INVALID_INPUT')
      }
    })
  })

  it('数据状态失败复用RANGE-01错误码并返回409/404', async () => {
    await withFixture(async ({ app }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const cases: Array<{ range: Record<string, unknown>; status: number; code: string }> = [
        { range: { mode: 'preset', startDate: '2026-07-01', months: 6 }, status: 409, code: 'INSUFFICIENT_DATA' },
        { range: { mode: 'bars', startDate: '2026-07-01', count: 100 }, status: 409, code: 'INSUFFICIENT_DATA' },
        { range: { mode: 'preset', startDate: '2026-06-01', months: 1 }, status: 409, code: 'BEFORE_HISTORY' },
        { range: { mode: 'preset', startDate: '2026-09-01', months: 1 }, status: 409, code: 'AFTER_DATA' },
      ]
      for (const item of cases) {
        const response = await app.inject({
          method: 'POST', url: '/api/training-ranges/preview', payload: previewPayload(item.range),
        })
        expect(response.statusCode).toBe(item.status)
        expect(response.json().code).toBe(item.code)
      }
    })
  })

  it('尾段未证实工作日返回UNCONFIRMED_COVERAGE（unknown覆盖）', async () => {
    await withFixture(async ({ app }) => {
      // 数据停在 08-14，但系统已到 08-21（周五）收盘：08-17~08-20 为未证实工作日
      vi.setSystemTime(new Date('2026-08-21T07:01:00Z'))
      const response = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-20', months: 1 }),
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('UNCONFIRMED_COVERAGE')
    })
  })

  it('股票无本地日线返回404', async () => {
    await withFixture(async ({ app }) => {
      const response = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'latest', startDate: '2026-07-01' }, { code: '000001', market: 'sz' }),
      })
      expect(response.statusCode).toBe(404)
    })
  })
})

describe('POST /api/trainings 范围创建复核', () => {
  async function previewPreset(app: Awaited<ReturnType<typeof createFixture>>['app'], months = 1, now = `${LAST}T07:01:00Z`) {
    vi.setSystemTime(new Date(now))
    const response = await app.inject({
      method: 'POST', url: '/api/training-ranges/preview',
      payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months }),
    })
    expect(response.statusCode).toBe(200)
    return response.json().preview
  }

  it('复核一致创建成功并把范围元数据冻结到训练记录', async () => {
    await withFixture(async ({ app, database }) => {
      const preview = await previewPreset(app)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
          previewId: preview.previewId, adjust_mode: 'forward', initial_cash: 500_000,
        },
      })
      expect(created.statusCode).toBe(201)
      const training = created.json().training
      expect(training.tier).toBe('RANGE')
      expect(training.startDate).toBe('2026-07-01')
      expect(training.plannedEnd).toBe('2026-07-31')
      expect(training.range).toEqual({
        version: 1,
        mode: 'preset',
        requestedStart: '2026-07-01',
        requestedEnd: '2026-08-01',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        barCount: 23,
        sourceFingerprint: preview.sourceFingerprint,
        notes: preview.notes,
      })
      const row = database.prepare(
        'SELECT range_version, range_mode, requested_start, requested_end, range_start, range_end, range_bar_count, range_source_fingerprint, range_notes FROM trainings WHERE id = ?',
      ).get(training.id) as unknown as Record<string, unknown>
      expect(row).toMatchObject({
        range_version: 1,
        range_mode: 'preset',
        requested_start: '2026-07-01',
        requested_end: '2026-08-01',
        range_start: '2026-07-01',
        range_end: '2026-07-31',
        range_bar_count: 23,
        range_source_fingerprint: preview.sourceFingerprint,
      })
      expect(JSON.parse(String(row.range_notes))).toEqual(preview.notes)
      expect(database.prepare('SELECT date, equity FROM equity_curve WHERE training_id = ?').get(training.id))
        .toMatchObject({ date: '2026-07-01', equity: 500_000 })

      const snapshot = await app.inject({ method: 'GET', url: `/api/trainings/${training.id}` })
      expect(snapshot.statusCode).toBe(200)
      expect(snapshot.json().training.range).toEqual(training.range)

      const advanced = await app.inject({ method: 'POST', url: `/api/trainings/${training.id}/next` })
      expect(advanced.statusCode).toBe(200)
      expect(advanced.json().snapshot.training.currentDate).toBe('2026-07-02')
    })
  })

  it('自定义范围创建保留显式开盘阶段与条件单开关', async () => {
    await withFixture(async ({ app }) => {
      const preview = await previewPreset(app)
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
          previewId: preview.previewId, adjust_mode: 'forward', initial_cash: 500_000,
          clock_mode: 'open_close', orders_enabled: true,
        },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json().training).toMatchObject({
        clockMode: 'open_close',
        ordersEnabled: true,
        currentPhase: 'open',
        currentOpen: 9.95,
        currentClose: null,
      })
    })
  })

  it('日线字节变化导致指纹不匹配返回409 RANGE_PREVIEW_STALE', async () => {
    await withFixture(async ({ app, root }) => {
      const preview = await previewPreset(app)
      // 改写已完成日线中一根的收盘价：同一预览的快照字节已失效
      await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), records(DATES, (date) => date === '2026-07-01' ? 99 : undefined))
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
          previewId: preview.previewId, adjust_mode: 'forward',
        },
      })
      expect(created.statusCode).toBe(409)
      expect(created.json().code).toBe('RANGE_PREVIEW_STALE')
      expect(created.json().error).toContain('重新预览')
    })
  })

  it('请求/复权方式/股票与预览不一致均返回409', async () => {
    await withFixture(async ({ app }) => {
      const preview = await previewPreset(app)
      const base = { code: '600519', previewId: preview.previewId }
      const wrongRequest = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { ...base, range: { mode: 'preset', startDate: '2026-07-01', months: 3 } },
      })
      expect(wrongRequest.statusCode).toBe(409)
      expect(wrongRequest.json().code).toBe('RANGE_PREVIEW_STALE')
      const wrongAdjust = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { ...base, range: { mode: 'preset', startDate: '2026-07-01', months: 1 }, adjust_mode: 'raw' },
      })
      expect(wrongAdjust.statusCode).toBe(409)
      expect(wrongAdjust.json().code).toBe('RANGE_PREVIEW_STALE')
      const wrongCode = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600000', range: { mode: 'preset', startDate: '2026-07-01', months: 1 }, previewId: preview.previewId,
        },
      })
      expect(wrongCode.statusCode).toBe(409)
      expect(wrongCode.json().code).toBe('RANGE_PREVIEW_STALE')
    })
  })

  it('过期与未知previewId返回409 RANGE_PREVIEW_STALE', async () => {
    await withFixture(async ({ app }) => {
      const preview = await previewPreset(app)
      vi.setSystemTime(new Date(new Date(`${LAST}T07:01:00Z`).getTime() + RANGE_PREVIEW_TTL_MS + 60_000))
      const expired = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 }, previewId: preview.previewId },
      })
      expect(expired.statusCode).toBe(409)
      expect(expired.json().code).toBe('RANGE_PREVIEW_STALE')
      const unknown = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 }, previewId: 'no-such-preview' },
      })
      expect(unknown.statusCode).toBe(409)
      expect(unknown.json().code).toBe('RANGE_PREVIEW_STALE')
    })
  })

  it('tier与range互斥、缺previewId返回400', async () => {
    await withFixture(async ({ app }) => {
      const preview = await previewPreset(app)
      const both = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          tier: '3M', code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 }, previewId: preview.previewId,
        },
      })
      expect(both.statusCode).toBe(400)
      const missing = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 } },
      })
      expect(missing.statusCode).toBe(400)
    })
  })
})

describe('旧tier兼容', () => {
  it('旧body创建/查询/推进不带range对象，数据库保持tier默认', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: { tier: '1M', code: '600519', start_date: '2026-07-01', initial_cash: 1_000_000 },
      })
      expect(created.statusCode).toBe(201)
      const training = created.json().training
      expect(training.tier).toBe('1M')
      expect(training.plannedEnd).toBe('2026-08-01')
      expect('range' in training).toBe(false)
      const row = database.prepare('SELECT range_version, range_mode FROM trainings WHERE id = ?').get(training.id) as unknown as Record<string, unknown>
      expect(row).toEqual({ range_version: 0, range_mode: 'tier' })
      const snapshot = await app.inject({ method: 'GET', url: `/api/trainings/${training.id}` })
      expect('range' in snapshot.json().training).toBe(false)
      const advanced = await app.inject({ method: 'POST', url: `/api/trainings/${training.id}/next` })
      expect(advanced.statusCode).toBe(200)
      expect(advanced.json().snapshot.training.currentDate).toBe('2026-07-02')
    })
  })
})

describe('并发创建与事务边界（GPT-WAKE-02 修复）', () => {
  it('同一previewId并发创建仅一次成功且只有一个running', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const previewed = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      const preview = previewed.json().preview
      const payload = {
        code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
        previewId: preview.previewId, adjust_mode: 'forward',
      }
      const settled = await Promise.allSettled([
        app.inject({ method: 'POST', url: '/api/trainings', payload }),
        app.inject({ method: 'POST', url: '/api/trainings', payload }),
      ])
      const statuses = settled.map(entry => entry.status === 'fulfilled' ? entry.value.statusCode : `rejected:${String(entry.reason)}`)
      expect(statuses.filter(status => status === 201)).toHaveLength(1)
      expect(statuses.filter(status => status === 409)).toHaveLength(1)
      expect(database.prepare("SELECT COUNT(*) AS n FROM trainings WHERE status = 'running'").get())
        .toMatchObject({ n: 1 })
      expect(database.prepare('SELECT COUNT(*) AS n FROM equity_curve').get()).toMatchObject({ n: 1 })
    })
  })

  it('旧tier并发创建同样仅一次成功', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const payload = { tier: '1M', code: '600519', start_date: '2026-07-01', initial_cash: 1_000_000 }
      const settled = await Promise.allSettled([
        app.inject({ method: 'POST', url: '/api/trainings', payload }),
        app.inject({ method: 'POST', url: '/api/trainings', payload }),
      ])
      const statuses = settled.map(entry => entry.status === 'fulfilled' ? entry.value.statusCode : `rejected:${String(entry.reason)}`)
      expect(statuses.filter(status => status === 201)).toHaveLength(1)
      expect(statuses.filter(status => status === 409)).toHaveLength(1)
      expect(database.prepare("SELECT COUNT(*) AS n FROM trainings WHERE status = 'running'").get())
        .toMatchObject({ n: 1 })
    })
  })

  it('初始权益写入失败回滚整个创建，不留孤儿训练行', async () => {
    await withFixture(async ({ app, database }) => {
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      database.exec("CREATE TRIGGER force_equity_failure BEFORE INSERT ON equity_curve WHEN NEW.equity = 777777 BEGIN SELECT RAISE(ABORT, 'forced equity failure'); END")
      const previewed = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      const preview = previewed.json().preview
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
          previewId: preview.previewId, adjust_mode: 'forward', initial_cash: 777777,
        },
      })
      expect(created.statusCode).toBe(500)
      expect(database.prepare('SELECT COUNT(*) AS n FROM trainings').get()).toMatchObject({ n: 0 })
      expect(database.prepare('SELECT COUNT(*) AS n FROM equity_curve').get()).toMatchObject({ n: 0 })
      // 回滚后训练可正常创建（预览token未被破坏）
      const retry = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
          previewId: preview.previewId, adjust_mode: 'forward',
        },
      })
      expect(retry.statusCode).toBe(201)
    })
  })
})

describe('权息字节快照指纹（GPT-WAKE-02 修复）', () => {
  // sh600519 合成加密记录（与既有夹具同源）：明文尾 4 字节即 rightsShares float32，
  // 改 0→1 只动明文尾，记录数/尺寸不变；派生 m 由 1.1→1.2。
  const gbbqRights0 = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f00000000', 'hex')
  const gbbqRights1 = Buffer.from('9a7f1ae8eafde7194156de939ea709c237a8c90d0924e4d63f0000803f', 'hex')

  function gbbqFile(records: Buffer[]): Buffer {
    const out = Buffer.alloc(4 + records.length * 29)
    out.writeUInt32LE(records.length, 0)
    records.forEach((record, index) => record.copy(out, 4 + index * 29))
    return out
  }

  it('gbbq字节变化且保留size/mtime：重预览指纹变化，旧token创建409', async () => {
    await withFixture(async ({ app, root }) => {
      const gbbqPath = join(root, 'T0002', 'hq_cache', 'gbbq')
      await writeFile(gbbqPath, gbbqFile([gbbqRights0]))
      vi.setSystemTime(new Date(`${LAST}T07:01:00Z`))
      const first = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      expect(first.statusCode).toBe(200)
      const fingerprint = first.json().preview.sourceFingerprint

      // 同尺寸改写 rightsShares 0→1 并还原 mtime：stat 缓存判定"无变化"
      const info = await stat(gbbqPath)
      await writeFile(gbbqPath, gbbqFile([gbbqRights1]))
      await utimes(gbbqPath, info.atime, info.mtime)
      const after = await stat(gbbqPath)
      expect(after.size).toBe(info.size)
      expect(after.mtime.toISOString()).toBe(info.mtime.toISOString())

      const second = await app.inject({
        method: 'POST', url: '/api/training-ranges/preview',
        payload: previewPayload({ mode: 'preset', startDate: '2026-07-01', months: 1 }),
      })
      expect(second.statusCode).toBe(200)
      expect(second.json().preview.sourceFingerprint).not.toBe(fingerprint)

      // 旧token：创建复核重新读字节，指纹不匹配必须拒绝
      const created = await app.inject({
        method: 'POST', url: '/api/trainings',
        payload: {
          code: '600519', range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
          previewId: first.json().preview.previewId, adjust_mode: 'forward',
        },
      })
      expect(created.statusCode).toBe(409)
      expect(created.json().code).toBe('RANGE_PREVIEW_STALE')
    })
  })
})

describe('数据库兼容迁移', () => {
  it('旧库增列保留旧行且默认range_version=0/range_mode=tier，可继续创建范围训练', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tdx-range-migrate-'))
    await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
    await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
    await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), records(DATES))
    const gbbq = Buffer.alloc(4 + encryptedGbbqRecord.length)
    gbbq.writeUInt32LE(1, 0)
    encryptedGbbqRecord.copy(gbbq, 4)
    await writeFile(join(root, 'T0002', 'hq_cache', 'gbbq'), gbbq)
    const database = new DatabaseSync(':memory:')
    try {
      // 旧schema：无任何range列
      database.exec(`
        CREATE TABLE trainings (
          id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, code TEXT NOT NULL,
          name TEXT NOT NULL, market TEXT NOT NULL DEFAULT 'sh', start_date TEXT NOT NULL,
          planned_end TEXT NOT NULL, status TEXT NOT NULL, blind INTEGER NOT NULL DEFAULT 0,
          adjust_mode TEXT NOT NULL DEFAULT 'forward', initial_cash REAL NOT NULL,
          created_at TEXT NOT NULL, current_date TEXT, current_close REAL,
          settle_date TEXT, early_settle INTEGER NOT NULL DEFAULT 0, note TEXT
        );
      `)
      database.prepare(`
        INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, blind, adjust_mode, initial_cash, created_at, current_date, current_close)
        VALUES ('3M', '600519', '贵州茅台', 'sh', '2026-01-05', '2026-04-05', 'settled', 0, 'forward', 1000000, '2026-01-05T00:00:00Z', '2026-02-06', 11.2)
      `).run()

      migrateDatabase(database)
      migrateDatabase(database) // 幂等

      const legacy = database.prepare('SELECT * FROM trainings WHERE id = 1').get() as unknown as Record<string, unknown>
      expect(legacy).toMatchObject({
        tier: '3M', status: 'settled', start_date: '2026-01-05', current_close: 11.2,
        range_version: 0, range_mode: 'tier',
        requested_start: null, requested_end: null, range_start: null, range_end: null,
        range_bar_count: null, range_source_fingerprint: null, range_notes: null,
      })

      // 迁移后的旧库可直接创建范围训练（新列可写，不动旧行）
      const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
      const preview = await previewTrainingRange(database, config, {
        code: '600519', market: 'sh',
        range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
        adjustMode: 'forward', now: new Date(`${LAST}T07:01:00Z`),
      })
      const created = await createTraining(database, config, {
        code: '600519',
        range: { mode: 'preset', startDate: '2026-07-01', months: 1 },
        previewId: preview.preview.previewId,
        adjust_mode: 'forward',
        now: new Date(`${LAST}T07:01:00Z`),
      })
      expect(created.range).toMatchObject({ version: 1, mode: 'preset', endDate: '2026-07-31' })
      const count = database.prepare('SELECT COUNT(*) AS n FROM trainings').get() as unknown as { n: number }
      expect(count.n).toBe(2)
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
