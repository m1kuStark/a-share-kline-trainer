<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { statisticsNumber as number, type RangeStatistics } from '../chartStatistics'
const props = defineProps<{ statistics: RangeStatistics; period: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
onMounted(() => dialog.value?.showModal())
const color = (value: number | null) => {
  const rounded = value === null || !Number.isFinite(value) ? 0 : Number(value.toFixed(2))
  return rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down'
}
</script>

<template>
  <dialog ref="dialog" class="range-stat-dialog" aria-labelledby="range-stat-title" @cancel.prevent="emit('close')" @click="event => { if (event.target === dialog) emit('close') }">
    <div class="range-stat-body">
      <header><h2 id="range-stat-title" tabindex="-1" autofocus>区间统计 · {{ period }}</h2><button aria-label="关闭区间统计" @click="emit('close')">关闭</button></header>
      <p class="range-stat-dates">{{ statistics.start }} 至 {{ statistics.end }} · {{ statistics.count }} 根 K 线（含首尾）</p>
      <dl>
        <div><dt>区间涨跌幅</dt><dd :class="color(statistics.changePct)">{{ number(statistics.changePct, '%', true) }}</dd></div>
        <div><dt>区间涨跌额</dt><dd :class="color(statistics.change)">{{ number(statistics.change, '', true) }}</dd></div>
        <div><dt>区间振幅</dt><dd>{{ number(statistics.amplitudePct, '%') }}</dd></div>
        <div><dt>起始开盘价</dt><dd>{{ number(statistics.open) }}</dd></div>
        <div><dt>结束收盘价</dt><dd>{{ number(statistics.close) }}</dd></div>
        <div><dt>区间最高价</dt><dd>{{ number(statistics.high) }}<small>{{ statistics.highDate }}</small></dd></div>
        <div><dt>区间最低价</dt><dd>{{ number(statistics.low) }}<small>{{ statistics.lowDate }}</small></dd></div>
        <div><dt>最高价相对基准</dt><dd :class="color(statistics.highPct)">{{ number(statistics.highPct, '%', true) }}</dd></div>
        <div><dt>最低价相对基准</dt><dd :class="color(statistics.lowPct)">{{ number(statistics.lowPct, '%', true) }}</dd></div>
        <div><dt>总成交量（手）</dt><dd>{{ number(statistics.volume === null ? null : statistics.volume / 100) }}</dd></div>
        <div><dt>平均每根成交量（手）</dt><dd>{{ number(statistics.volume === null ? null : statistics.volume / statistics.count / 100) }}</dd></div>
        <div><dt>总成交额（万元）</dt><dd>{{ number(statistics.amount === null ? null : statistics.amount / 10000) }}</dd></div>
        <div><dt>平均每根成交额（万元）</dt><dd>{{ number(statistics.amount === null ? null : statistics.amount / statistics.count / 10000) }}</dd></div>
        <div><dt>上涨 / 下跌 / 平盘</dt><dd><span class="up">{{ statistics.up }}</span> / <span class="down">{{ statistics.down }}</span> / {{ statistics.flat }} 根</dd></div>
        <div v-if="statistics.unclassified"><dt>缺前收未分类</dt><dd>{{ statistics.unclassified }} 根</dd></div>
        <div><dt>累计换手率</dt><dd>--<small>缺少历史流通股本</small></dd></div>
      </dl>
      <p class="range-stat-note">涨跌基准：{{ statistics.baseKind === 'previousClose' ? '首根前一根收盘价' : '首根开盘价（缺少有效前收）' }} {{ number(statistics.base) }}。振幅＝（最高－最低）÷基准。涨跌根数按各根收盘与前收比较。</p>
      <p class="range-stat-note">统计当前已加载、截至推进日的{{ period }}数据；价格沿用图表复权口径。周／月可能包含形成中的 K 线。</p>
    </div>
  </dialog>
</template>

<style scoped>
.range-stat-dialog { width: min(620px, calc(100vw - 24px)); max-width: calc(100vw - 24px); max-height: calc(100dvh - 32px); padding: 0; overflow: auto; box-sizing: border-box; color: var(--text-primary, #25364b); background: var(--surface-background, #fff); border: 1px solid var(--surface-border, #dfe5eb); border-radius: 8px; box-shadow: 0 12px 40px #0005; }
.range-stat-dialog::backdrop { background: #0006; }
.range-stat-body { padding: 18px; }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
h2 { font-size: 16px; margin: 0; }
button { padding: 5px 12px; background: var(--control-background, #f5f7fa); color: inherit; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 4px; }
button:focus-visible { outline: 2px solid #54b8cc; }
.range-stat-dates, .range-stat-note { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--text-secondary, #64748b); }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; margin: 12px 0; }
dl > div { display: flex; justify-content: space-between; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--surface-border, #dfe5eb); font-size: 12px; }
dt { flex: 1; color: var(--text-secondary, #64748b); }
dd { margin: 0; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; max-width: 65%; }
small { display: block; font-size: 10px; color: var(--text-secondary, #64748b); }
.up { color: #ef4444; } .down { color: #16a34a; } .flat { color: var(--text-secondary, #64748b); }
@media (max-width: 560px) { dl { grid-template-columns: minmax(0, 1fr); } .range-stat-body { padding: 12px; } }
</style>
