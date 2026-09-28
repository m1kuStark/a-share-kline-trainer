import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { assessFreshness } from '../src/data/freshness.js'
import { SSE_CALENDAR_2026, SSE_CALENDAR_2026_SOURCE } from '../src/data/calendar.js'

// 离线2026上交所日历模块：与已验收证据快照（docs/verification/2026-09/DATA-05/calendar-source.json）
// 逐字段一致，并把"单源、发布日期未知、不宣称双源"的口径钉死在测试里。
// 全部时间用固定 UTC 时刻表达，不依赖运行主机时区。

const evidencePath = new URL('../../docs/verification/2026-09/DATA-05/calendar-source.json', import.meta.url)

describe('离线2026上交所日历模块', () => {
  it('与已验收证据快照逐字段一致（closedDates/from/through/来源元信息）', async () => {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as {
      from: string
      through: string
      closedDates: string[]
      source: { url: string; snapshotSha256: string; retrievedAt: string; annualNoticeReference: string }
    }
    expect(SSE_CALENDAR_2026.from).toBe(evidence.from)
    expect(SSE_CALENDAR_2026.through).toBe(evidence.through)
    expect([...SSE_CALENDAR_2026.closedDates]).toEqual(evidence.closedDates)
    expect(SSE_CALENDAR_2026.closedDates).toHaveLength(19)
    expect(SSE_CALENDAR_2026_SOURCE.sourceUrl).toBe(evidence.source.url)
    expect(SSE_CALENDAR_2026_SOURCE.snapshotSha256).toBe(evidence.source.snapshotSha256)
    expect(SSE_CALENDAR_2026_SOURCE.retrievedAt).toBe(evidence.source.retrievedAt)
    expect(SSE_CALENDAR_2026_SOURCE.officialNotice).toBe(evidence.source.annualNoticeReference)
  })

  it('来源元信息不宣称双源，发布日期保持未知(null)，id/version 齐备', () => {
    expect(SSE_CALENDAR_2026_SOURCE.publishedDate).toBeNull()
    expect(SSE_CALENDAR_2026_SOURCE.corroborationNote).toContain('深交所')
    expect(SSE_CALENDAR_2026_SOURCE.corroborationNote).toContain('未完成')
    expect(SSE_CALENDAR_2026_SOURCE.id).toBeTruthy()
    expect(SSE_CALENDAR_2026_SOURCE.version).toBeTruthy()
    expect(SSE_CALENDAR_2026_SOURCE.timezone).toBe('Asia/Shanghai')
  })

  it('2026-09-25 中秋休市：全日应收收盘日为 2026-09-24（14:59 与 15:00 一致）', () => {
    for (const iso of ['2026-09-25T06:59:00Z', '2026-09-25T07:00:00Z', '2026-09-25T15:30:00Z']) {
      const result = assessFreshness({ now: new Date(iso), sourceMaxDate: '2026-09-24', calendar: SSE_CALENDAR_2026 })
      expect(result.state, iso).toBe('current')
      expect(result.expectedDate, iso).toBe('2026-09-24')
    }
  })

  it('官方休市+周末连续回退：周六09-26与国庆10-05分别回退到09-24与09-30', () => {
    const saturday = assessFreshness({ now: new Date('2026-09-26T07:00:00Z'), sourceMaxDate: '2026-09-24', calendar: SSE_CALENDAR_2026 })
    expect(saturday.expectedDate).toBe('2026-09-24')
    expect(saturday.state).toBe('current')
    const national = assessFreshness({ now: new Date('2026-10-05T07:00:00Z'), sourceMaxDate: '2026-09-30', calendar: SSE_CALENDAR_2026 })
    expect(national.expectedDate).toBe('2026-09-30')
    expect(national.state).toBe('current')
  })

  it('正常交易日 15:00 分界：14:59 应收前一日、15:00 起含当日', () => {
    const before = assessFreshness({ now: new Date('2026-09-28T06:59:00Z'), sourceMaxDate: '2026-09-24', calendar: SSE_CALENDAR_2026 })
    expect(before.expectedDate).toBe('2026-09-24')
    expect(before.state).toBe('current')
    const at = assessFreshness({ now: new Date('2026-09-28T07:00:00Z'), sourceMaxDate: '2026-09-28', calendar: SSE_CALENDAR_2026 })
    expect(at.expectedDate).toBe('2026-09-28')
    expect(at.state).toBe('current')
  })

  it('年度边界保守：1月1日休市日与2027年越界均返回 unknown 且不编造应收日', () => {
    const newYear = assessFreshness({ now: new Date('2026-01-01T07:00:00Z'), sourceMaxDate: '2025-12-31', calendar: SSE_CALENDAR_2026 })
    expect(newYear.state).toBe('unknown')
    expect(newYear.expectedDate).toBeNull()
    const beyond = assessFreshness({ now: new Date('2027-01-04T07:00:00Z'), sourceMaxDate: '2026-12-31', calendar: SSE_CALENDAR_2026 })
    expect(beyond.state).toBe('unknown')
    expect(beyond.expectedDate).toBeNull()
  })

  it('扫描无变化不等于市场最新：source 落后应收日时仍是 stale', () => {
    const result = assessFreshness({ now: new Date('2026-09-28T07:00:00Z'), sourceMaxDate: '2026-09-24', calendar: SSE_CALENDAR_2026 })
    expect(result.state).toBe('stale')
    expect(result.expectedDate).toBe('2026-09-28')
    expect(result.reason).toContain('来源末日不证明所有股票完整')
  })
})
