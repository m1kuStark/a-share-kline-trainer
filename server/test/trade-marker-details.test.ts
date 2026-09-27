import { describe, expect, it } from 'vitest'
import type { TradeView } from '../../web/src/api'
import { groupTradeMarkers, type TradeMarkerCluster } from '../../web/src/tradeMarkerLayout'
import {
  buildListRow,
  buildTradeFacts,
  markerKeyOf,
  reduceDetails,
  tradeDisplayDate,
  type DetailsPanelState,
} from '../../web/src/tradeMarkerDetails'

const day = (date: string) => Date.parse(`${date}T00:00:00Z`)

function trade(seq: number, date: string, overrides: Partial<TradeView> = {}): TradeView {
  return { seq, date, side: 'buy', price: 10 + seq, shares: 100 * seq, amount: 1000 * seq, fee: seq, ...overrides }
}

const positions = ['2026-09-01', '2026-09-02', '2026-09-03']
const clusterTrades = positions.map((date, index) => trade(index + 1, date))
const cluster: TradeMarkerCluster = {
  side: 'buy', x: 100, width: 26, count: 3, trades: clusterTrades,
}
const single: TradeMarkerCluster = { side: 'sell', x: 300, width: 18, count: 1, trades: [trade(9, '2026-09-04', { side: 'sell' })] }

describe('trade marker details state machine', () => {
  it('activates a single-trade marker straight into that trade, unpinned', () => {
    const state = reduceDetails(null, { type: 'activate', marker: single })
    expect(state).toEqual({ source: 'open', pinned: false, markerKey: markerKeyOf(single), selectedSeq: 9 })
  })

  it('opens a cluster on its first trade and never synthesizes per-trade facts into one row', () => {
    const state = reduceDetails(null, { type: 'activate', marker: cluster })
    expect(state!.selectedSeq).toBe(1)
    const facts = buildTradeFacts(clusterTrades[0])
    expect(facts.find(fact => fact.label === '金额')!.value).toBe('1,000.00 元')
    expect(facts.find(fact => fact.label === '费用')!.value).toBe('1.00 元')
    // 每行都是单笔自己的事实：金额不得是三笔合计，费用不得合计
    expect(facts.find(fact => fact.label === '金额')!.value).not.toContain('6,000')
    for (const item of clusterTrades) {
      const row = buildListRow(item)
      expect(row).toContain(`#${item.seq}`)
      expect(row).toContain(tradeDisplayDate(item))
    }
  })

  it('updates the selection to another trade of the same cluster and follows its own facts', () => {
    let state = reduceDetails(null, { type: 'activate', marker: cluster })
    state = reduceDetails(state, { type: 'select', marker: cluster, seq: 3 })
    expect(state!.selectedSeq).toBe(3)
    expect(buildTradeFacts(clusterTrades[2]).find(fact => fact.label === '成交价')!.value).toBe('13.00 元')
    // 越界选择（不是本聚合内的成交）不得改变当前选择
    expect(reduceDetails(state, { type: 'select', marker: single, seq: 9 })).toEqual(state)
    expect(reduceDetails(state, { type: 'select', marker: cluster, seq: 99 })).toEqual(state)
  })

  it('collapses a hover preview when the pointer and focus leave, but keeps a click-open panel', () => {
    let state: DetailsPanelState | null = reduceDetails(null, { type: 'preview', marker: cluster })
    expect(state!.source).toBe('hover')
    state = reduceDetails(state, { type: 'pointer-leave' })
    expect(state).toBeNull()
    state = reduceDetails(null, { type: 'activate', marker: cluster })
    expect(reduceDetails(state, { type: 'pointer-leave' })).toEqual(state)
  })

  it('a hover preview never steals an already opened or pinned panel', () => {
    let state = reduceDetails(null, { type: 'activate', marker: single, seq: 9 })
    state = reduceDetails(state, { type: 'pin' })
    expect(reduceDetails(state, { type: 'preview', marker: cluster })).toEqual(state)
    const opened = reduceDetails(null, { type: 'activate', marker: single })
    expect(reduceDetails(opened, { type: 'preview', marker: cluster })).toEqual(opened)
  })

  it('pin survives pointer leave, outside press and marker re-clustering; unpin restores ordinary closing', () => {
    let state = reduceDetails(null, { type: 'activate', marker: cluster, seq: 2 })
    state = reduceDetails(state, { type: 'pin' })
    expect(state!.pinned).toBe(true)
    expect(reduceDetails(state, { type: 'pointer-leave' })).toEqual(state)
    expect(reduceDetails(state, { type: 'outside-pointerdown' })).toEqual(state)
    // 周期切换后聚合重算：同一笔成交落入新聚合，选择与固定都保持
    const weekly: TradeMarkerCluster = { side: 'buy', x: 44, width: 26, count: 3, trades: [...clusterTrades].reverse() }
    state = reduceDetails(state, { type: 'sync', markers: [weekly], trades: clusterTrades })
    expect(state!.selectedSeq).toBe(2)
    expect(state!.markerKey).toBe(markerKeyOf(weekly))
    // 解除固定后恢复普通关闭行为：外部按下关闭
    state = reduceDetails(state, { type: 'unpin' })
    expect(state!.pinned).toBe(false)
    expect(reduceDetails(state, { type: 'outside-pointerdown' })).toBeNull()
  })

  it('Esc and the close action close even a pinned panel', () => {
    let state: DetailsPanelState | null = reduceDetails(null, { type: 'activate', marker: cluster })
    state = reduceDetails(state, { type: 'pin' })
    expect(reduceDetails(state, { type: 'escape' })).toBeNull()
    state = reduceDetails(reduceDetails(null, { type: 'activate', marker: cluster }), { type: 'pin' })
    expect(reduceDetails(state, { type: 'close' })).toBeNull()
  })

  it('a pinned panel keeps the selection when its badge is temporarily offscreen, an open panel closes', () => {
    let state: DetailsPanelState | null = reduceDetails(null, { type: 'activate', marker: cluster, seq: 2 })
    // 标记滚出视口：聚合集合里找不到该笔
    state = reduceDetails(state, { type: 'sync', markers: [single], trades: clusterTrades })
    expect(state).toBeNull()
    state = reduceDetails(reduceDetails(null, { type: 'activate', marker: cluster, seq: 2 }), { type: 'pin' })
    expect(reduceDetails(state, { type: 'sync', markers: [single], trades: clusterTrades })).toEqual(state)
  })

  it('clears selection and pin immediately when the selected trade no longer exists (replay backwards, training switch)', () => {
    let state: DetailsPanelState | null = reduceDetails(null, { type: 'activate', marker: cluster, seq: 3 })
    state = reduceDetails(state, { type: 'pin' })
    expect(reduceDetails(state, { type: 'sync', markers: [cluster], trades: clusterTrades.slice(0, 2) })).toBeNull()
    // 未打开时同步是无害空操作
    expect(reduceDetails(null, { type: 'sync', markers: [], trades: [] })).toBeNull()
  })
})

describe('trade marker details blind projection', () => {
  it('shows the relative blind label and never leaks the real date in any displayed fact', () => {
    const blind: TradeView = { ...trade(1, '2025-06-02'), blindIndex: 2, blindLabel: 'T-2' }
    expect(tradeDisplayDate(blind)).toBe('T-2')
    for (const fact of buildTradeFacts(blind)) expect(fact.value).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(buildListRow(blind)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // 无盲训投影时如实显示真实日期
    expect(tradeDisplayDate(trade(1, '2025-06-02'))).toBe('2025-06-02')
  })
})

describe('trade marker details integrate with the accepted rail layout', () => {
  it('re-anchors to the cluster that contains the selection after a real layout recomputation', () => {
    const markers = groupTradeMarkers(clusterTrades, '1D', timestamp => 40 + ((timestamp - day('2026-09-01')) / 86_400_000) * 70, 240)
    expect(markers).toHaveLength(3)
    let state = reduceDetails(null, { type: 'activate', marker: markers[0]!, seq: 1 })
    const merged = groupTradeMarkers(clusterTrades, '1W', () => 100, 240)
    expect(merged).toHaveLength(1)
    state = reduceDetails(state, { type: 'sync', markers: merged, trades: clusterTrades })
    expect(state!.markerKey).toBe(markerKeyOf(merged[0]!))
    expect(state!.selectedSeq).toBe(1)
  })
})
