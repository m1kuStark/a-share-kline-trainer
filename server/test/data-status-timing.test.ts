import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import { SSE_CALENDAR_2026, SSE_CALENDAR_2026_SOURCE, type CalendarBundle } from '../src/data/calendar.js'
import { createDataRefreshCoordinator, type DataRefreshCoordinator } from '../src/data/refresh.js'
import { registerOnlineSource, type DailySource } from '../src/data/source.js'
import type { AppConfig } from '../src/config.js'
import type { FreshnessResult } from '../src/data/freshness.js'

// 状态API的时间语义：freshness 在每次廉价 GET /api/data/status 时用注入时钟重算，
// 跨 15:00、跨日期、跨官方休市日能立即重判，不触发任何扫描；日历缺失/越界保守 unknown。
// 全部时间用固定 UTC 时刻表达（上海=UTC+8），结果不依赖运行主机时区。

const OFFICIAL_BUNDLE: CalendarBundle = { calendar: SSE_CALENDAR_2026, source: SSE_CALENDAR_2026_SOURCE }

function makeSource(sourceMaxDate: string, scanError?: Error): { source: DailySource; scanCalls: () => number } {
  let calls = 0
  const source: DailySource = {
    kind: 'online', name: '计时测试在线源', available: async () => true,
    scan: async () => {
      calls += 1
      if (scanError) throw scanError
      // 首扫建立基线；此后同数据复扫＝无变化
      return {
        kind: 'online', name: '计时测试在线源', totalStocks: 1, added: 0, removed: 0,
        revised: 0, baseline: calls === 1, sourceMaxDate, files: [],
      }
    },
  }
  return { source, scanCalls: () => calls }
}

function makeCoordinator(options: { now: () => Date; calendar: CalendarBundle | null; scanError?: Error }): {
  database: DatabaseSync
  coordinator: DataRefreshCoordinator
  scanCalls: () => number
  unregister: () => void
} {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const { source, scanCalls } = makeSource('2026-09-24', options.scanError)
  const unregister = registerOnlineSource(source)
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: null }
  const coordinator = createDataRefreshCoordinator(database, config, { now: options.now, calendar: options.calendar })
  return { database, coordinator, scanCalls, unregister }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error('等待条件超时')
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}

type StatusBody = {
  state: string
  needsUpdate: boolean
  freshness: FreshnessResult
  calendar: { id: string; from: string; through: string; sourceUrl: string; version: string } | null
}

async function getStatus(coordinator: DataRefreshCoordinator): Promise<StatusBody> {
  return await coordinator.getStatus() as unknown as StatusBody
}

/** 先完成一次成功扫描，建立 lastSuccess 基线（sourceMaxDate 固定 2026-09-24）。 */
async function seedBaseline(coordinator: DataRefreshCoordinator): Promise<void> {
  const started = await coordinator.start()
  expect(started).not.toBeNull()
  await waitFor(async () => (await coordinator.getStatus()).state !== 'running')
}

describe('数据状态时间语义（DATA-05）', () => {
  it('同一 Monday 14:59/15:00：无需任何扫描，GET 状态即从 current 重判为 stale', async () => {
    let now = new Date('2026-09-28T06:59:00Z') // 上海周一 14:59
    const harness = makeCoordinator({ now: () => now, calendar: OFFICIAL_BUNDLE })
    const { database, coordinator, scanCalls, unregister } = harness
    try {
      await seedBaseline(coordinator)
      expect(scanCalls()).toBe(1)

      const before = await getStatus(coordinator)
      expect(before.freshness.expectedDate).toBe('2026-09-24')
      expect(before.freshness.state).toBe('current')
      expect(before.calendar?.id).toBe(SSE_CALENDAR_2026.id)
      expect(before.calendar?.sourceUrl).toContain('sse.com.cn')
      expect(before.calendar?.version).toBeTruthy()

      now = new Date('2026-09-28T07:00:00Z') // 上海周一 15:00：当日已收盘
      const after = await getStatus(coordinator)
      expect(after.freshness.expectedDate).toBe('2026-09-28')
      expect(after.freshness.state).toBe('stale')
      // 廉价重判：没有发生任何新扫描
      expect(scanCalls()).toBe(1)
      // legacy needsUpdate 仍保留（最近工作日启发、真实时钟），兼容旧消费方
      expect(typeof after.needsUpdate).toBe('boolean')
    } finally {
      unregister()
      database.close()
    }
  })

  it('官方休市日重判：09-25（中秋）与周末全天应收 09-24；10-05 国庆应收 09-30', async () => {
    let now = new Date('2026-09-25T07:00:00Z')
    const { database, coordinator, unregister } = makeCoordinator({ now: () => now, calendar: OFFICIAL_BUNDLE })
    try {
      await seedBaseline(coordinator)
      const holiday = await getStatus(coordinator)
      expect(holiday.freshness.state).toBe('current')
      expect(holiday.freshness.expectedDate).toBe('2026-09-24')

      now = new Date('2026-09-26T07:00:00Z') // 周六
      expect((await getStatus(coordinator)).freshness.expectedDate).toBe('2026-09-24')

      now = new Date('2026-10-05T07:00:00Z') // 国庆休市
      const national = await getStatus(coordinator)
      expect(national.freshness.expectedDate).toBe('2026-09-30')
      expect(national.freshness.state).toBe('stale')
    } finally {
      unregister()
      database.close()
    }
  })

  it('扫描 unchanged 不改变 stale 判定：无变化任务后仍要求应收日数据', async () => {
    let now = new Date('2026-09-28T07:00:00Z')
    const { database, coordinator, scanCalls, unregister } = makeCoordinator({ now: () => now, calendar: OFFICIAL_BUNDLE })
    try {
      await seedBaseline(coordinator)
      // 第二次扫描：数据无变化（sourceMaxDate 仍 09-24），任务终态 unchanged
      const started = await coordinator.start()
      expect(started).not.toBeNull()
      await waitFor(async () => (await coordinator.getStatus()).state !== 'running')
      expect(scanCalls()).toBe(2)
      const status = await getStatus(coordinator)
      expect(status.state).toBe('unchanged')
      expect(status.freshness.state).toBe('stale')
      expect(status.freshness.expectedDate).toBe('2026-09-28')
      expect(status.freshness.sourceMaxDate).toBe('2026-09-24')
    } finally {
      unregister()
      database.close()
    }
  })

  it('显式无日历（null 注入）→ unknown、不编造应收日；legacy needsUpdate 仍保留', async () => {
    let now = new Date('2026-09-28T07:00:00Z')
    const { database, coordinator, unregister } = makeCoordinator({ now: () => now, calendar: null })
    try {
      await seedBaseline(coordinator)
      const status = await getStatus(coordinator)
      expect(status.freshness.state).toBe('unknown')
      expect(status.freshness.expectedDate).toBeNull()
      expect(status.freshness.sourceMaxDate).toBe('2026-09-24')
      expect(status.calendar).toBeNull()
      expect(typeof status.needsUpdate).toBe('boolean')
    } finally {
      unregister()
      database.close()
    }
  })

  it('2027 越界未覆盖 → unknown（不得假装已知）', async () => {
    let now = new Date('2027-01-04T07:00:00Z')
    const { database, coordinator, unregister } = makeCoordinator({ now: () => now, calendar: OFFICIAL_BUNDLE })
    try {
      await seedBaseline(coordinator)
      const status = await getStatus(coordinator)
      expect(status.freshness.state).toBe('unknown')
      expect(status.freshness.expectedDate).toBeNull()
      expect(status.freshness.reason).toContain('未覆盖')
    } finally {
      unregister()
      database.close()
    }
  })

  it('固定 UTC 时刻结果确定：同instant两次GET的 checkedAt/期望日一致（不依赖主机时区）', async () => {
    let now = new Date('2026-09-24T07:00:00Z')
    const { database, coordinator, unregister } = makeCoordinator({ now: () => now, calendar: OFFICIAL_BUNDLE })
    try {
      await seedBaseline(coordinator)
      const first = await getStatus(coordinator)
      const second = await getStatus(coordinator)
      expect(second.freshness).toEqual(first.freshness)
      expect(first.freshness.checkedAt).toBe(now.toISOString())
      expect(first.freshness.expectedDate).toBe('2026-09-24')
      expect(first.freshness.state).toBe('current')
    } finally {
      unregister()
      database.close()
    }
  })
})
