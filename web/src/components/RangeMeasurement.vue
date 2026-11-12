<script setup lang="ts">
import { ref } from 'vue'
import { statisticsNumber as number, type TwoPointMeasurement } from '../chartStatistics'

const props = defineProps<{
  box: { left: number; top: number; width: number; height: number }
  panel: { x: number; y: number }
  model: TwoPointMeasurement
  period: string
}>()
const emit = defineEmits<{
  close: []
  edgeMove: [payload: { edge: 'start' | 'end'; clientX: number }]
}>()
const dragging = ref<'start' | 'end' | null>(null)
const color = (value: number | null) => {
  const rounded = value === null || !Number.isFinite(value) ? 0 : Number(value.toFixed(2))
  return rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down'
}
function begin(edge: 'start' | 'end', event: PointerEvent): void {
  dragging.value = edge
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}
function move(edge: 'start' | 'end', event: PointerEvent): void {
  if (dragging.value !== edge) return
  emit('edgeMove', { edge, clientX: event.clientX })
  event.preventDefault()
  event.stopPropagation()
}
function end(event: PointerEvent): void {
  dragging.value = null
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <div class="range-measure-layer" aria-hidden="false">
    <div class="range-measure-box" :style="{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }" />
    <div class="range-measure-handle is-start" role="separator" aria-label="起始 K 线边界" data-edge="start"
      :style="{ left: `${box.left - 4}px`, top: `${box.top}px`, height: `${box.height}px` }"
      @pointerdown="begin('start', $event)" @pointermove="move('start', $event)" @pointerup="end" @pointercancel="end" />
    <div class="range-measure-handle is-end" role="separator" aria-label="结束 K 线边界" data-edge="end"
      :style="{ left: `${box.left + box.width - 4}px`, top: `${box.top}px`, height: `${box.height}px` }"
      @pointerdown="begin('end', $event)" @pointermove="move('end', $event)" @pointerup="end" @pointercancel="end" />
    <div class="range-measure-panel" role="group" aria-label="两点测量" :style="{ left: `${panel.x}px`, top: `${panel.y}px` }">
      <header>
        <strong>两点测量 · {{ period }}</strong>
        <button aria-label="关闭两点测量" @click="emit('close')">关闭</button>
      </header>
      <p class="range-measure-dates">{{ model.startDate }} → {{ model.endDate }} · {{ model.count }} 根 K 线（含首尾）</p>
      <dl>
        <div><dt>起点收盘价</dt><dd>{{ number(model.startClose) }}</dd></div>
        <div><dt>终点收盘价</dt><dd>{{ number(model.endClose) }}</dd></div>
        <div><dt>涨跌幅</dt><dd :class="color(model.changePct)">{{ number(model.changePct, '%', true) }}</dd></div>
        <div><dt>价差</dt><dd :class="color(model.change)">{{ number(model.change, '', true) }}</dd></div>
        <div><dt>K线数量</dt><dd>{{ model.count }} 根</dd></div>
        <div><dt>区间涨跌幅</dt><dd :class="color(model.range.changePct)">{{ number(model.range.changePct, '%', true) }}</dd></div>
        <div><dt>区间最高价</dt><dd>{{ number(model.range.high) }}<small>{{ model.range.highDate }}</small></dd></div>
        <div><dt>区间最低价</dt><dd>{{ number(model.range.low) }}<small>{{ model.range.lowDate }}</small></dd></div>
        <div><dt>区间振幅</dt><dd>{{ number(model.range.amplitudePct, '%') }}</dd></div>
        <div><dt>总成交量（手）</dt><dd>{{ number(model.range.volume === null ? null : model.range.volume / 100) }}</dd></div>
        <div><dt>总成交额（万元）</dt><dd>{{ number(model.range.amount === null ? null : model.range.amount / 10000) }}</dd></div>
        <div><dt>上涨 / 下跌 / 平盘</dt><dd><span class="up">{{ model.range.up }}</span> / <span class="down">{{ model.range.down }}</span> / {{ model.range.flat }} 根</dd></div>
      </dl>
      <p class="range-measure-note">涨跌幅/价差按起止两根收盘价；区间统计含首尾。拖动左右边可调整范围并实时更新，Esc 关闭。</p>
    </div>
  </div>
</template>

<style scoped>
.range-measure-layer { position: absolute; inset: 0; z-index: 7; pointer-events: none; }
.range-measure-box { position: absolute; border: 1px dashed #54b8cc; background: color-mix(in srgb, #54b8cc 10%, transparent); box-sizing: border-box; pointer-events: none; }
.range-measure-handle { position: absolute; width: 9px; cursor: ew-resize; pointer-events: auto; touch-action: none; }
.range-measure-handle::before { content: ''; position: absolute; left: 3px; top: 0; bottom: 0; width: 3px; border-radius: 2px; background: #54b8cc; }
.range-measure-handle:focus-visible { outline: 2px solid #54b8cc; }
.range-measure-panel { position: absolute; width: 300px; max-width: calc(100% - 8px); box-sizing: border-box; padding: 8px 10px; border: 1px solid #54b8cc; border-radius: 6px; color: var(--text-primary, #25364b); background: var(--surface-background, #fff); box-shadow: 0 6px 18px #0004; font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; pointer-events: auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
header strong { font-size: 11px; }
header button { padding: 2px 8px; font-size: 11px; color: inherit; background: var(--control-background, #f5f7fa); border: 1px solid var(--surface-border, #dfe5eb); border-radius: 4px; cursor: pointer; }
header button:focus-visible { outline: 2px solid #54b8cc; }
.range-measure-dates, .range-measure-note { margin: 3px 0; color: var(--text-secondary, #64748b); font-size: 10px; line-height: 15px; }
dl { margin: 3px 0; max-height: 232px; overflow: auto; }
dl > div { display: flex; justify-content: space-between; gap: 8px; }
dt { color: var(--text-secondary, #64748b); }
dd { margin: 0; white-space: nowrap; text-align: right; }
dd small { display: block; color: var(--text-secondary, #64748b); font-size: 9px; }
.up { color: #ef4444; } .down { color: #16a34a; } .flat { color: var(--text-secondary, #64748b); }
</style>
