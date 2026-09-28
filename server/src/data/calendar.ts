// 离线交易日历与来源元信息：上交所2026年全年休市安排（年度公告口径），生产不联网。
// 证据与快照哈希见 docs/verification/2026-09/DATA-05/calendar-source.json；
// 本文件是 19 个工作日闭市日的内嵌副本，两处由 server/test/data-calendar.test.ts 强制一致。
// 限制（不得对外宣称超出）：仅上交所单源，未完成深交所独立交叉核验；
// 官方年度总览未注明发布日期（publishedDate 保持 null）；仅覆盖 2026 年度，
// 范围外日期由 assessFreshness 保守返回 unknown；临时休市调整需出新版本。

import type { TradingCalendar } from './freshness.js'

/** 上交所2026年休市表：19个工作日闭市日；周末休市由纯模块的 isWeekday 处理，不在此列出。 */
export const SSE_CALENDAR_2026: TradingCalendar = {
  id: 'sse-2026-annual',
  from: '2026-01-01',
  through: '2026-12-31',
  closedDates: [
    '2026-01-01',
    '2026-01-02',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-02-23',
    '2026-04-06',
    '2026-05-01',
    '2026-05-04',
    '2026-05-05',
    '2026-06-19',
    '2026-09-25',
    '2026-10-01',
    '2026-10-02',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
  ],
}

export interface CalendarSourceInfo {
  id: string
  from: string
  through: string
  /** 快照版本标识（按证据抓取日命名） */
  version: string
  sourceUrl: string
  sourceTitle: string
  timezone: string
  retrievedAt: string
  snapshotSha256: string
  officialNotice: string
  /** 官方页面未注明发布日期，保持 null，不得回填页面生成时间 */
  publishedDate: string | null
  corroborationNote: string
}

export const SSE_CALENDAR_2026_SOURCE: CalendarSourceInfo = {
  id: SSE_CALENDAR_2026.id,
  from: SSE_CALENDAR_2026.from,
  through: SSE_CALENDAR_2026.through,
  version: 'snapshot-2026-09-25',
  sourceUrl: 'https://www.sse.com.cn/disclosure/dealinstruc/closed/',
  sourceTitle: '2026年休市安排',
  timezone: 'Asia/Shanghai',
  retrievedAt: '2026-09-25T09:44:48.583049+00:00',
  snapshotSha256: 'd388a2493ab57d685aa768bda52d01877fb90f38972fcf2595be64975bdc6d28',
  officialNotice: '上证公告〔2025〕45号',
  publishedDate: null,
  corroborationNote: '仅上交所单源；深交所独立交叉核验未完成，不宣称双源',
}

/** 注入协调器的日历捆绑：日历本体＋可展示的来源元信息。 */
export interface CalendarBundle {
  calendar: TradingCalendar
  source: CalendarSourceInfo
}

export const OFFICIAL_SSE_2026_BUNDLE: CalendarBundle = { calendar: SSE_CALENDAR_2026, source: SSE_CALENDAR_2026_SOURCE }
