<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Timeframe, TradeView } from './api'
import { groupTradeMarkers, type TradeMarkerCluster } from './tradeMarkerLayout'
import {
  markerKeyOf,
  reduceDetails,
  type DetailsEvent,
  type DetailsPanelState,
} from './tradeMarkerDetails'
import TradeMarkerDetails from './TradeMarkerDetails.vue'

const props = defineProps<{
  trades: TradeView[]
  timeframe: Timeframe
  project: (timestamp: number) => number | null
  width: number
  revision: number
}>()

const markers = computed(() => {
  void props.revision
  return groupTradeMarkers(props.trades, props.timeframe, props.project, props.width)
})

const keyedMarkers = computed(() => markers.value.map(marker => ({ ...marker, key: markerKeyOf(marker) })))

const panel = ref<DetailsPanelState | null>(null)
const panelStyle = ref<Record<string, string>>({})

function dispatch(event: DetailsEvent): void {
  panel.value = reduceDetails(panel.value, event)
}

const currentMarker = computed(() => keyedMarkers.value.find(marker => marker.key === panel.value?.markerKey) ?? null)
const panelTrades = computed(() => currentMarker.value?.trades ?? [])
// F3：固定面板的徽标离屏（聚合集合不含该笔）时，选中成交仍从当前 props.trades 取得——
// 只用受限当前数据渲染，绝不缓存已消失/未来成交；回放后退 trades 收缩时此处为 null，浮层立即移除
const panelSelected = computed(() =>
  panelTrades.value.find(item => item.seq === panel.value?.selectedSeq)
  ?? props.trades.find(item => item.seq === panel.value?.selectedSeq)
  ?? null,
)

function markerLabel(marker: TradeMarkerCluster): string {
  const letter = marker.side === 'buy' ? 'B' : 'S'
  return marker.count === 1 ? letter : `${letter}${marker.count > 99 ? '99+' : marker.count}`
}

function markerTitle(marker: TradeMarkerCluster): string {
  const side = marker.side === 'buy' ? '买入' : '卖出'
  return `${side} ${marker.count} 笔\n${marker.trades.map(trade => (
    `${trade.blindLabel ?? trade.date}  ${trade.shares.toLocaleString('zh-CN')} 股  ${trade.price.toFixed(2)} 元`
  )).join('\n')}`
}

// 指针/焦点离开标记和浮层后延迟收起（跨越徽标与浮层间隙时不闪烁）；固定或点击打开的不受影响
const presence = { pointerMarker: false, pointerPanel: false, focusMarker: false, focusPanel: false }
let hoverCloseTimer: number | null = null
let ignoreNextMarkerFocus = false

function cancelHoverClose(): void {
  if (hoverCloseTimer !== null) {
    window.clearTimeout(hoverCloseTimer)
    hoverCloseTimer = null
  }
}

function scheduleHoverClose(): void {
  cancelHoverClose()
  hoverCloseTimer = window.setTimeout(() => {
    hoverCloseTimer = null
    if (!presence.pointerMarker && !presence.pointerPanel && !presence.focusMarker && !presence.focusPanel) {
      dispatch({ type: 'pointer-leave' })
    }
  }, 120)
}

function onMarkerEnter(marker: TradeMarkerCluster): void {
  presence.pointerMarker = true
  cancelHoverClose()
  dispatch({ type: 'preview', marker })
}

function onMarkerLeave(): void {
  presence.pointerMarker = false
  scheduleHoverClose()
}

function onMarkerFocus(marker: TradeMarkerCluster): void {
  if (ignoreNextMarkerFocus) {
    ignoreNextMarkerFocus = false
    presence.focusMarker = true
    return
  }
  presence.focusMarker = true
  cancelHoverClose()
  dispatch({ type: 'preview', marker })
}

function onMarkerBlur(event: FocusEvent): void {
  presence.focusMarker = false
  const next = event.relatedTarget as HTMLElement | null
  if (!next?.closest('.trade-marker-details')) scheduleHoverClose()
}

function activate(marker: TradeMarkerCluster, seq?: number): void {
  cancelHoverClose()
  dispatch({ type: 'activate', marker, seq })
}

function onSelect(seq: number): void {
  if (currentMarker.value) dispatch({ type: 'select', marker: currentMarker.value, seq })
}

function closePanel(refocusBadge: boolean): void {
  const key = panel.value?.markerKey
  dispatch({ type: 'close' })
  cancelHoverClose()
  presence.pointerMarker = false
  presence.pointerPanel = false
  presence.focusMarker = false
  presence.focusPanel = false
  if (refocusBadge && key) {
    const el = badgeEls.get(key)
    if (el && document.activeElement !== el) {
      ignoreNextMarkerFocus = true
      el.focus()
    }
  }
}

// 布局重算（周期切换/平移缩放/成交变化）后重锚定：选中成交消失立即清选择和固定
watch([markers, () => props.trades], () => {
  dispatch({ type: 'sync', markers: markers.value, trades: props.trades })
})

const badgeEls = new Map<string, HTMLElement>()

function setBadgeEl(key: string, el: unknown): void {
  if (el instanceof HTMLElement) badgeEls.set(key, el)
  else badgeEls.delete(key)
}

function updatePanelPosition(): void {
  const state = panel.value
  if (!state) return
  const el = badgeEls.get(state.markerKey)
  // 固定面板的徽标滚出视口时保留上次位置（成交仍是当前事实）；组件卸载即整体清理
  if (!el) return
  const rect = el.getBoundingClientRect()
  const panelWidth = Math.min(288, window.innerWidth - 16)
  const left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, rect.left + rect.width / 2 - panelWidth / 2))
  if (rect.top >= 186) {
    panelStyle.value = { left: `${left}px`, top: '', bottom: `${Math.max(8, window.innerHeight - rect.top + 6)}px` }
  } else {
    panelStyle.value = { left: `${left}px`, top: `${rect.bottom + 6}px`, bottom: '' }
  }
}

watch([panel, keyedMarkers, () => props.revision], updatePanelPosition, { flush: 'post' })

function onPanelPointerEnter(): void {
  presence.pointerPanel = true
  cancelHoverClose()
}

function onPanelPointerLeave(): void {
  presence.pointerPanel = false
  scheduleHoverClose()
}

function onPanelFocusIn(): void {
  presence.focusPanel = true
  cancelHoverClose()
}

function onPanelFocusOut(event: FocusEvent): void {
  presence.focusPanel = false
  const next = event.relatedTarget as HTMLElement | null
  if (!next?.closest('.trade-marker-details')) scheduleHoverClose()
}

function onWindowPointerDown(event: PointerEvent): void {
  if (!panel.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.trade-marker-details') || target?.closest('.trade-marker-badge')) return
  dispatch({ type: 'outside-pointerdown' })
}

function onWindowResize(): void {
  updatePanelPosition()
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown)
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown)
  window.removeEventListener('resize', onWindowResize)
  cancelHoverClose()
})
</script>

<template>
  <div
    class="trade-marker-rail"
    role="group"
    aria-label="成交标记"
    @keydown.esc="closePanel(true)"
  >
    <span
      v-for="marker in keyedMarkers"
      :key="marker.key"
      :ref="el => setBadgeEl(marker.key, el)"
      class="trade-marker-badge"
      :data-side="marker.side"
      :data-count="marker.count"
      :style="{ left: `${marker.x - marker.width / 2}px`, width: `${marker.width}px` }"
      :aria-label="markerTitle(marker)"
      :aria-expanded="panel?.markerKey === marker.key ? 'true' : 'false'"
      role="button"
      tabindex="0"
      @pointerenter="onMarkerEnter(marker)"
      @pointerleave="onMarkerLeave()"
      @focus="onMarkerFocus(marker)"
      @blur="onMarkerBlur($event)"
      @click="activate(marker)"
      @keydown.enter.prevent.stop="activate(marker)"
      @keydown.space.prevent.stop="activate(marker)"
    >{{ markerLabel(marker) }}</span>
  </div>
  <TradeMarkerDetails
    v-if="panel && panelSelected"
    :trades="panelTrades"
    :selected="panelSelected"
    :pinned="panel.pinned"
    :position="panelStyle"
    @select="onSelect"
    @toggle-pin="dispatch(panel.pinned ? { type: 'unpin' } : { type: 'pin' })"
    @close="closePanel(true)"
    @pointer-enter="onPanelPointerEnter"
    @pointer-leave="onPanelPointerLeave"
    @focus-in="onPanelFocusIn"
    @focus-out="onPanelFocusOut"
  />
</template>

<style scoped>
.trade-marker-rail {
  position: relative;
  height: 40px;
  min-height: 40px;
  flex: 0 0 40px;
  width: 100%;
  overflow: hidden;
  background: var(--trade-marker-rail-bg, #ffffff);
  border-top: 1px solid var(--trade-marker-rail-border, #e8edf2);
  box-sizing: border-box;
}

.trade-marker-badge {
  position: absolute;
  top: 2px;
  height: 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 2px;
  background: #e88918;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 17px;
  letter-spacing: 0;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.trade-marker-badge[data-side="sell"] {
  top: 21px;
  background: #24a6d9;
}

.trade-marker-badge:focus-visible {
  outline: 1px solid #ffffff;
  outline-offset: -2px;
}

:global(body.dark .trade-marker-rail) {
  --trade-marker-rail-bg: #000000;
  --trade-marker-rail-border: #202020;
}
</style>
