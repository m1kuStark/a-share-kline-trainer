<script setup lang="ts">
// M4-HISTORY-01 只读事实成绩单：事实元信息、冻结规则（origin/capturedAt）、逐笔成交、
// 已保存权益曲线与画线标注清单（只读，保留原始价格基准，不提供编辑器/行情K线）。
// 请求版本守卫：A→B 切换后 A 的迟到/失败响应不得覆盖 B，也不得留下永续 loading。
import { computed, ref, watch } from 'vue'
import { ApiError, fetchTrainingReport, type HistoryReportPayload } from '../api'
import { DRAW_TOOLS } from '../drawTools'

const props = defineProps<{ id: number }>()
const emit = defineEmits<{ back: [] }>()

const report = ref<HistoryReportPayload | null>(null)
const loading = ref(false)
const errorMessage = ref('')
let loadVersion = 0

async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  const targetId = props.id
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = await fetchTrainingReport(targetId)
    if (requestVersion !== loadVersion || targetId !== props.id) return
    report.value = payload
  } catch (error) {
    if (requestVersion !== loadVersion || targetId !== props.id) return
    errorMessage.value = error instanceof Error ? error.message : '无法读取成绩单'
  } finally {
    if (requestVersion === loadVersion && targetId === props.id) loading.value = false
  }
}
watch(() => props.id, () => { void load() }, { immediate: true })

const TIER_LABELS: Record<string, string> = { '1M': '1个月', '3M': '3个月', '6M': '6个月', '1Y': '1年', '2Y': '2年' }
const RANGE_MODE_LABELS: Record<string, string> = { preset: '自定义·预设', latest: '自定义·到最新', bars: '自定义·日K根数' }
const PANE_LABELS: Record<string, string> = { candle_pane: '主图', VOL: '成交量', MACD: 'MACD' }
const info = computed(() => {
  const training = report.value?.training
  if (!training) return null
  return {
    tierText: training.tier === 'RANGE' ? (RANGE_MODE_LABELS[training.rangeMode] ?? '自定义范围') : (TIER_LABELS[training.tier] ?? training.tier),
    classificationText: training.classification === 'early-settled' ? '提前结算' : '到期结算',
    adjustText: training.adjustMode === 'forward' ? '前复权' : '不复权',
    rulesOriginText: report.value?.rules.origin === 'legacy-migration' ? '迁移时点观察（如实标注）' : '创建时冻结',
  }
})
function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'
}
function price(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '--'
}
const percent = computed(() => {
  const rate = report.value?.returnRate
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '--'
  const value = rate * 100
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
})
function sideText(side: 'buy' | 'sell'): string {
  return side === 'buy' ? '买入' : '卖出'
}
function toolLabel(name: string): string {
  return DRAW_TOOLS.find(tool => tool.name === name)?.label ?? name
}
function anchorDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

// 权益曲线几何：纯 SVG 折线（不引入图表库、不新增行情K线）；单点画圆点。
const curve = computed(() => {
  const points = report.value?.equityCurve ?? []
  if (!points.length) return null
  const width = 640, height = 180, padX = 8, padY = 16
  const equities = points.map(point => point.equity).filter(value => Number.isFinite(value))
  if (!equities.length) return null
  const min = Math.min(...equities), max = Math.max(...equities)
  const span = max - min || 1
  const x = (index: number) => points.length === 1 ? width / 2 : padX + index / (points.length - 1) * (width - padX * 2)
  const y = (value: number) => padY + (max - value) / span * (height - padY * 2)
  return {
    polyline: points.map((point, index) => `${x(index)},${y(point.equity)}`).join(' '),
    single: points.length === 1,
    singleX: x(0), singleY: y(equities[0]),
    first: points[0], last: points[points.length - 1],
  }
})
</script>

<template>
  <section class="report-page" aria-label="成绩单">
    <header class="report-header">
      <div>
        <h1>训练成绩单</h1>
        <p v-if="report">第 {{ report.training.id }} 局 · {{ report.training.code }} {{ report.training.name }}（{{ info?.tierText }}）</p>
      </div>
      <button class="ghost-button" @click="emit('back')">返回历史列表</button>
    </header>

    <div v-if="errorMessage" class="history-error" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="ghost-button" @click="load()">重试</button>
    </div>
    <p v-else-if="loading || !report" class="history-loading" role="status">加载中…</p>

    <template v-else>
      <div class="report-grid">
        <div><span>结算方式</span><strong>{{ info?.classificationText }}</strong></div>
        <div><span>训练区间</span><strong>{{ report.training.startDate }} ~ {{ report.training.settleDate }}</strong></div>
        <div><span>结算日</span><strong>{{ report.training.settleDate }}</strong></div>
        <div><span>初始资金</span><strong>{{ money(report.training.initialCash) }}</strong></div>
        <div><span>最终权益</span><strong>{{ money(report.finalEquity) }}</strong></div>
        <div>
          <span>总收益率</span>
          <strong :class="{ up: report.returnRate > 0, down: report.returnRate < 0 }">{{ percent }}</strong>
        </div>
        <div><span>交易笔数</span><strong>{{ report.tradeCount }}</strong></div>
        <div><span>复权方式</span><strong>{{ info?.adjustText }}</strong></div>
      </div>

      <div class="report-rules">
        本局规则（{{ info?.rulesOriginText }}，{{ report.rules.capturedAt }}）：费用 {{ report.rules.feesEnabled ? '开' : '关' }} · T+1 {{ report.rules.tPlusOne ? '开' : '关' }} · 按当日收盘价成交；最终权益为已含费用与权息的持久记录，逐笔费用仅为展示，不重复扣减。
      </div>

      <h2>逐笔成交</h2>
      <table v-if="report.trades.length" class="report-trades">
        <thead>
          <tr><th>序号</th><th>日期</th><th>买卖</th><th>价格</th><th>股数</th><th>金额</th><th>费用</th></tr>
        </thead>
        <tbody>
          <tr v-for="trade in report.trades" :key="trade.seq" class="report-trade-row">
            <td>{{ trade.seq }}</td>
            <td>{{ trade.date }}</td>
            <td :class="trade.side === 'buy' ? 'up' : 'down'">{{ sideText(trade.side) }}</td>
            <td>{{ price(trade.price) }}</td>
            <td>{{ trade.shares }}</td>
            <td>{{ money(trade.amount) }}</td>
            <td>{{ money(trade.fee) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="report-empty">零成交：初始资金按结算日持久权益原样呈现，未虚构平仓。</p>

      <h2>已保存权益曲线</h2>
      <figure v-if="curve" class="report-curve">
        <svg class="equity-curve-svg" :viewBox="`0 0 640 180`" role="img" aria-label="已保存权益曲线">
          <polyline v-if="!curve.single" :points="curve.polyline" fill="none" stroke="currentColor" stroke-width="1.5" />
          <circle v-else :cx="curve.singleX" :cy="curve.singleY" r="3" fill="currentColor" />
        </svg>
        <figcaption>
          {{ curve.first.date }} {{ money(curve.first.equity) }} → {{ curve.last.date }} {{ money(curve.last.equity) }}
          （{{ report.equityCurve.length }} 个持久权益点，限定 {{ report.training.startDate }} ~ {{ report.training.settleDate }}）
        </figcaption>
      </figure>
      <p v-else class="report-empty">该区间没有可展示的持久权益点。</p>

      <h2>画线标注</h2>
      <p v-if="report.drawingsStatus === 'unavailable'" class="history-error" role="alert">{{ report.drawingsReason }}</p>
      <p v-else-if="!report.drawings?.length" class="report-empty">未保存画线。</p>
      <ul v-else class="report-drawings">
        <li v-for="drawing in report.drawings" :key="drawing.id" class="report-drawing-item">
          <strong>{{ toolLabel(drawing.name) }}</strong>
          <span>窗格：{{ PANE_LABELS[drawing.paneId ?? 'candle_pane'] ?? drawing.paneId }}</span>
          <span>锚点 {{ drawing.points.length }} 个：
            <template v-for="(point, index) in drawing.points" :key="index">{{ index ? '；' : '' }}{{ anchorDate(point.timestamp) }} @ {{ price(point.value) }}</template>
          </span>
          <span v-if="drawing.priceBasis" class="report-drawing-basis">数值为保存时的前复权基准（保留原始价格基准，不做换算）</span>
        </li>
      </ul>
      <p class="report-note">画线为只读标注清单；完整 K 线复盘与原始图表回看不在本页范围内。</p>
    </template>
  </section>
</template>
