<script setup lang="ts">
import { computed } from 'vue'
import { statisticsNumber, type calculatePointMeasurement } from '../chartStatistics'

const props = defineProps<{
  start: { x: number; y: number }; end: { x: number; y: number }
  position: { x: number; y: number }; active: boolean
  model: NonNullable<ReturnType<typeof calculatePointMeasurement>>
}>()
const color = (value: number | null) => value === null || Number(value.toFixed(2)) === 0 ? 'flat' : value > 0 ? 'up' : 'down'
const rows = computed(() => [
  { label: '涨跌幅', value: statisticsNumber(props.model.changePct, '%', true), color: color(props.model.changePct) },
  { label: '起点价', value: statisticsNumber(props.model.startPrice) },
  { label: '终点价', value: statisticsNumber(props.model.endPrice) },
  { label: '价差', value: statisticsNumber(props.model.change, '', true), color: color(props.model.change) },
  { label: 'K线数量', value: `${props.model.count} 根` },
])
</script>

<template>
  <div class="point-measure-layer">
    <svg class="point-measure-guide" aria-hidden="true">
      <path :d="`M ${start.x} ${start.y} H ${end.x} V ${end.y}`" stroke-dasharray="4 3" />
      <line :x1="start.x" :y1="start.y" :x2="end.x" :y2="end.y" />
      <circle :cx="start.x" :cy="start.y" r="3" /><circle :cx="end.x" :cy="end.y" r="3" />
    </svg>
    <div class="point-measure-card" role="group" aria-label="两点测量" :style="{ left: `${position.x}px`, top: `${position.y}px` }">
      <strong>两点测量</strong>
      <dl><div v-for="row in rows" :key="row.label"><dt>{{ row.label }}</dt><dd :class="row.color">{{ row.value }}</dd></div></dl>
      <small>{{ active ? '松开左键保留结果' : 'Esc／再次点击清除' }}</small>
    </div>
  </div>
</template>

<style scoped>
.point-measure-layer { position: absolute; inset: 0; z-index: 7; pointer-events: none; }
.point-measure-guide { width: 100%; height: 100%; overflow: hidden; fill: none; stroke: #54b8cc; stroke-width: 1; }
.point-measure-guide circle { fill: #54b8cc; }
.point-measure-card { position: absolute; width: 180px; max-width: calc(100% - 8px); box-sizing: border-box; padding: 8px 10px; border: 1px solid #54b8cc; border-radius: 5px; color: var(--text-primary, #25364b); background: var(--surface-background, #fff); box-shadow: 0 4px 12px #0003; font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
strong { font-size: 11px; }
dl { margin: 3px 0; }
dl > div { display: flex; justify-content: space-between; gap: 8px; }
dt, small { color: var(--text-secondary, #64748b); }
dd { margin: 0; white-space: nowrap; }
small { display: block; font-size: 10px; }
.up { color: #ef4444; } .down { color: #16a34a; } .flat { color: var(--text-secondary, #64748b); }
</style>
