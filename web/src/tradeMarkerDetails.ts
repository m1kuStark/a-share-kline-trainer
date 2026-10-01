import type { TradeView } from './api'
import type { TradeMarkerCluster } from './tradeMarkerLayout'

/** 详情浮层打开来源：hover＝悬停/焦点进入（离开即收）；open＝点击（Esc/关闭/外部按下收） */
export type DetailsSource = 'hover' | 'open'

export interface DetailsPanelState {
  source: DetailsSource
  /** 固定：仅页面内临时状态；解除后回到普通关闭行为，不写数据库/录像/localStorage */
  pinned: boolean
  markerKey: string
  selectedSeq: number
}

export function markerKeyOf(marker: Pick<TradeMarkerCluster, 'side' | 'trades'>): string {
  return `${marker.side}:${marker.trades[0]?.seq ?? -1}`
}

/** 双盲进行中优先显示相对日期标签，绝不泄露真实日期 */
export function tradeDisplayDate(trade: Pick<TradeView, 'date' | 'blindLabel'>): string {
  return trade.blindLabel ?? trade.date
}

export type DetailsEvent =
  | { type: 'preview'; marker: TradeMarkerCluster; seq?: number }
  | { type: 'activate'; marker: TradeMarkerCluster; seq?: number }
  | { type: 'select'; marker: TradeMarkerCluster; seq: number }
  | { type: 'pin' }
  | { type: 'unpin' }
  | { type: 'note-saved' }
  | { type: 'pointer-leave' }
  | { type: 'outside-pointerdown' }
  | { type: 'escape' }
  | { type: 'close' }
  | { type: 'sync'; markers: readonly TradeMarkerCluster[]; trades: readonly TradeView[] }

/** 只读详情浮层状态机：纯函数，组件只派发事件并渲染结果 */
export function reduceDetails(state: DetailsPanelState | null, event: DetailsEvent): DetailsPanelState | null {
  switch (event.type) {
    case 'preview': {
      // 已点击打开或固定的面板不被其它标记的悬停抢占
      if (state && (state.source === 'open' || state.pinned)) return state
      const seq = event.seq ?? event.marker.trades[0]?.seq
      if (seq === undefined) return state
      return { source: 'hover', pinned: false, markerKey: markerKeyOf(event.marker), selectedSeq: seq }
    }
    case 'activate': {
      const seq = event.seq ?? event.marker.trades[0]?.seq
      if (seq === undefined) return state
      return { source: 'open', pinned: false, markerKey: markerKeyOf(event.marker), selectedSeq: seq }
    }
    case 'select': {
      if (!state) return state
      // 只能选择当前面板聚合内的成交：跨标记选择不得劫持面板
      if (markerKeyOf(event.marker) !== state.markerKey) return state
      if (!event.marker.trades.some(item => item.seq === event.seq)) return state
      return { ...state, selectedSeq: event.seq }
    }
    case 'pin':
      return state ? { ...state, pinned: true } : state
    case 'unpin':
      return state ? { ...state, pinned: false, source: 'open' } : state
    case 'note-saved':
      // 保存笔记释放临时固定；离开徽标/面板后按悬停行为自动收起。
      return state ? { ...state, pinned: false, source: 'hover' } : state
    case 'pointer-leave':
      return state && !state.pinned && state.source === 'hover' ? null : state
    case 'outside-pointerdown':
      return state && !state.pinned ? null : state
    case 'escape':
    case 'close':
      return null
    case 'sync': {
      if (!state) return state
      // 选中的成交已不存在（回放后退、训练切换）：立即清选择和固定，不显示缓存中的未来交易
      if (!event.trades.some(item => item.seq === state.selectedSeq)) return null
      const host = event.markers.find(marker => marker.trades.some(item => item.seq === state!.selectedSeq))
      // 标记滚出视口：固定面板保留（成交仍是当前事实），未固定的面板关闭
      if (!host) return state.pinned ? state : null
      return { ...state, markerKey: markerKeyOf(host) }
    }
  }
}

export interface TradeFact {
  label: string
  value: string
}

function money(value: number): string {
  return `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`
}

/** 单笔成交的展示事实，全部来自 TradeView 已有字段；chartPrice 不冒充成交价 */
export function buildTradeFacts(trade: TradeView): TradeFact[] {
  return [
    { label: '日期', value: tradeDisplayDate(trade) },
    { label: '方向', value: trade.side === 'buy' ? '买入' : '卖出' },
    { label: '序号', value: `#${trade.seq}` },
    { label: '成交价', value: money(trade.price) },
    { label: '股数', value: `${trade.shares.toLocaleString('zh-CN')} 股` },
    { label: '金额', value: money(trade.amount) },
    { label: '费用', value: money(trade.fee) },
  ]
}

/** 聚合笔次列表的一行摘要：单笔自己的事实，绝不把多笔合成一笔 */
export function buildListRow(trade: TradeView): string {
  return `${tradeDisplayDate(trade)} · #${trade.seq} · ${trade.shares.toLocaleString('zh-CN')}股 · ${money(trade.price)}`
}
