<script setup lang="ts">
import type { HoverCardModel } from '../phasePrice'

// 常驻行情条（PR #7）：训练页通过 Teleport 并入状态行（不额外占主图高度），
// 回放页无状态行槽位时内联渲染。纯展示层：不 emit、不写持久层。
const props = defineProps<{ periodLabel: string; quote: HoverCardModel | null; source: string }>()
const fallbackRows = [{ label: '开', value: '--' }, { label: '高', value: '--' }, { label: '低', value: '--' }, { label: '收', value: '--' }]
</script>

<template>
  <div class="chart-quote" role="group" aria-label="K线行情">
    <span class="chart-quote-date">{{ periodLabel }} {{ quote?.date ?? '--' }}</span>
    <span v-for="row in (quote?.rows ?? fallbackRows)" :key="row.label" class="chart-quote-field" :data-field="row.label">{{ row.label }} <b>{{ row.value }}</b></span>
    <span class="chart-quote-field" data-field="涨幅">{{ periodLabel === '周K' ? '周涨幅' : periodLabel === '月K' ? '月涨幅' : '日涨幅' }} <b :class="quote?.pct.cls">{{ quote?.pct.text ?? '--' }}</b></span>
    <span class="chart-quote-source">{{ source }}</span>
  </div>
</template>
