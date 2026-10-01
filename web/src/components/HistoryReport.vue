<script setup lang="ts">
// M4-HISTORY-01 只读事实成绩单：事实元信息、冻结规则、逐笔成交与收益率比较图。
// M4-01 增量：K线复盘只读回看——按需加载 /api/trainings/:id/bars（服务端守卫：运行中
// 训练存在时仅放行其自身，其他训练 409 同历史口径），只读渲染K线＋B/S标记＋已保存画线；
// 不提供任何编辑写入口，复盘K线止于结算日，不开放之后的行情。
// 请求版本守卫：A→B 切换后 A 的迟到/失败响应不得覆盖 B，也不得留下永续 loading。
import { computed, ref, watch } from 'vue'
import { ApiError, fetchEquityComparison, fetchTrainingBars, fetchTrainingReport, type EquityComparisonPayload, type HistoryReportPayload, type TrainingBarsPayload } from '../api'
import KlineChart from './KlineChart.vue'

const props = defineProps<{ id: number }>()
const emit = defineEmits<{ back: []; close: [] }>()

const report = ref<HistoryReportPayload | null>(null)
const loading = ref(false)
const errorMessage = ref('')
let loadVersion = 0

// K线复盘（只读）：按需加载，失败/守卫三态分明；A→B 切换时整体复位。
const reviewOpen = ref(false)
const review = ref<TrainingBarsPayload | null>(null)
const reviewLoading = ref(false)
const reviewError = ref('')
const reviewGuarded = ref(false)
let reviewVersion = 0
const comparison = ref<EquityComparisonPayload | null>(null)
const comparisonLoading = ref(false)
const comparisonError = ref('')
const comparisonBenchmarks = ref<string[]>([])
const comparisonSeries = computed(() => comparison.value?.series ?? [])
const comparisonRequestVersion = ref(0)
const hoverIndex = ref<number | null>(null)
const CHART_WIDTH = 760
const CHART_HEIGHT = 300
const PLOT = { left: 48, right: 62, top: 18, bottom: 42 }
const SERIES_COLORS = { user: '#d24b4b', sh000001: '#5b72c9', sz399303: '#d28a3d' } as const

async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  const targetId = props.id
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = await fetchTrainingReport(targetId)
    if (requestVersion !== loadVersion || targetId !== props.id) return
    report.value = payload
    void loadComparison()
  } catch (error) {
    if (requestVersion !== loadVersion || targetId !== props.id) return
    errorMessage.value = error instanceof Error ? error.message : '无法读取成绩单'
  } finally {
    if (requestVersion === loadVersion && targetId === props.id) loading.value = false
  }
}
watch(() => props.id, () => {
  reviewOpen.value = false
  review.value = null
  reviewError.value = ''
  reviewGuarded.value = false
  comparison.value = null
  comparisonError.value = ''
  comparisonBenchmarks.value = []
  hoverIndex.value = null
  comparisonRequestVersion.value++
  void load()
}, { immediate: true })

async function loadComparison(): Promise<void> {
  const requestVersion = ++comparisonRequestVersion.value
  const targetId = props.id
  comparisonLoading.value = true
  comparisonError.value = ''
  try {
    const payload = await fetchEquityComparison(targetId, comparisonBenchmarks.value)
    if (requestVersion !== comparisonRequestVersion.value || targetId !== props.id) return
    comparison.value = payload
  } catch (error) {
    if (requestVersion !== comparisonRequestVersion.value || targetId !== props.id) return
    comparisonError.value = error instanceof Error ? error.message : '无法读取收益率对比曲线'
  } finally {
    if (requestVersion === comparisonRequestVersion.value && targetId === props.id) comparisonLoading.value = false
  }
}
function toggleBenchmark(key: string): void {
  comparisonBenchmarks.value = comparisonBenchmarks.value.includes(key)
    ? comparisonBenchmarks.value.filter(value => value !== key)
    : [...comparisonBenchmarks.value, key]
  void loadComparison()
}

function chartValue(key: keyof typeof SERIES_COLORS, index: number): number | null {
  const point = comparisonSeries.value[index]
  if (!point) return null
  if (key === 'user') return Number.isFinite(point.user) ? point.user : null
  const value = point[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function linePath(key: keyof typeof SERIES_COLORS, x: (index: number) => number, y: (value: number) => number): string {
  let path = ''
  comparisonSeries.value.forEach((_, index) => {
    const value = chartValue(key, index)
    if (value === null) return
    path += path.endsWith('M') || path === '' ? `M ${x(index)} ${y(value)}` : ` L ${x(index)} ${y(value)}`
    if (index > 0 && chartValue(key, index - 1) === null) path = path.replace(/ L ([^ ]+) ([^ ]+)$/, ' M $1 $2')
  })
  return path
}
const chartModel = computed(() => {
  const points = comparisonSeries.value
  if (!points.length) return null
  const keys: Array<keyof typeof SERIES_COLORS> = ['user', ...comparisonBenchmarks.value.filter(key => key in SERIES_COLORS) as Array<'sh000001' | 'sz399303'>]
  const values = keys.flatMap(key => points.map((_, index) => chartValue(key, index))).filter((value): value is number => value !== null)
  if (!values.length) return null
  let min = Math.min(...values, 0)
  let max = Math.max(...values, 0)
  const padding = Math.max((max - min) * 0.08, 0.01)
  min -= padding
  max += padding
  const x = (index: number) => points.length === 1 ? (PLOT.left + CHART_WIDTH - PLOT.right) / 2 : PLOT.left + index / (points.length - 1) * (CHART_WIDTH - PLOT.left - PLOT.right)
  const y = (value: number) => PLOT.top + (max - value) / (max - min) * (CHART_HEIGHT - PLOT.top - PLOT.bottom)
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max - index / 4 * (max - min)
    return { value, y: y(value), label: `${(value * 100).toFixed(1)}%` }
  })
  const xTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((index, position, all) => all.indexOf(index) === position)
    .map(index => ({ index, x: x(index), label: points[index].date }))
  return { points, keys, x, y, min, max, ticks, xTicks, zeroY: y(0), paths: Object.fromEntries(keys.map(key => [key, linePath(key, x, y)])) as Record<string, string> }
})
const tooltipPoint = computed(() => {
  const model = chartModel.value
  return model && hoverIndex.value !== null ? model.points[hoverIndex.value] : null
})
function setHover(event: MouseEvent | PointerEvent): void {
  const model = chartModel.value
  if (!model) return
  const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  hoverIndex.value = Math.round(ratio * (model.points.length - 1))
}
function clearHover(): void { hoverIndex.value = null }

async function toggleReview(): Promise<void> {
  if (reviewOpen.value) {
    reviewOpen.value = false
    return
  }
  reviewOpen.value = true
  if (review.value) return
  await loadReview()
}

async function loadReview(): Promise<void> {
  const requestVersion = ++reviewVersion
  const targetId = props.id
  reviewLoading.value = true
  reviewError.value = ''
  reviewGuarded.value = false
  try {
    const payload = await fetchTrainingBars(targetId, '1D')
    if (requestVersion !== reviewVersion || targetId !== props.id) return
    review.value = payload
  } catch (error) {
    if (requestVersion !== reviewVersion || targetId !== props.id) return
    if (error instanceof ApiError && error.code === 'HISTORY_ACTIVE_TRAINING') {
      reviewGuarded.value = true
    } else {
      reviewError.value = error instanceof Error ? error.message : '无法读取复盘K线'
    }
  } finally {
    if (requestVersion === reviewVersion && targetId === props.id) reviewLoading.value = false
  }
}

function fetchEarlier(before: string, count: number): Promise<{ bars: TrainingBarsPayload['bars']; hasMore: boolean }> {
  return fetchTrainingBars(props.id, '1D', { before, count }).then(payload => ({ bars: payload.bars, hasMore: payload.hasMore }))
}

const TIER_LABELS: Record<string, string> = { '1M': '1个月', '3M': '3个月', '6M': '6个月', '1Y': '1年', '2Y': '2年' }
const RANGE_MODE_LABELS: Record<string, string> = { preset: '自定义·预设', latest: '自定义·到最新', bars: '自定义·日K根数' }
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

</script>

<template>
  <section class="report-page" role="dialog" aria-modal="true" aria-label="成绩单">
    <header class="report-header">
      <div>
        <h1>训练成绩单</h1>
        <p v-if="report">{{ report.training.code }} {{ report.training.name }} · {{ info?.tierText }} · {{ report.training.startDate }} ~ {{ report.training.settleDate }}</p>
      </div>
      <button class="report-modal-close" type="button" aria-label="关闭成绩单" title="关闭成绩单" @click="emit('close')">×</button>
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

      <div class="report-rule-tags" aria-label="本局规则">
        <span class="report-rule-tag">{{ report.rules.tPlusOne ? 'T+1' : 'T+0' }}</span>
        <span class="report-rule-tag">{{ report.rules.feesEnabled ? '费用开' : '费用关' }}</span>
        <span class="report-rule-tag">收盘成交</span>
        <span class="report-rule-tag">{{ info?.adjustText }}</span>
        <span class="report-rule-tag">{{ info?.rulesOriginText }}</span>
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

      <h2>收益率曲线</h2>
      <div class="report-comparison-controls">
        <strong>同期指数</strong>
        <label><input type="checkbox" :checked="comparisonBenchmarks.includes('sh000001')" @change="toggleBenchmark('sh000001')" />上证指数</label>
        <label><input type="checkbox" :checked="comparisonBenchmarks.includes('sz399303')" @change="toggleBenchmark('sz399303')" />国证 2000</label>
      </div>
      <div v-if="comparison && comparisonBenchmarks.length" class="report-benchmark-statuses">
        <span v-for="key in comparisonBenchmarks" :key="key" class="report-benchmark-status" :class="{ unavailable: !comparison.benchmarks[key]?.ok }">
          {{ key === 'sh000001' ? '上证指数' : '国证 2000' }}：{{ comparison.benchmarks[key]?.ok ? '已加载' : (comparison.benchmarks[key]?.reason ?? '不可用') }}
        </span>
      </div>
      <p v-if="comparisonError" class="history-error" role="alert">{{ comparisonError }}</p>
      <p v-else-if="comparisonLoading" class="history-loading" role="status">读取同期指数…</p>
      <figure v-else-if="chartModel" class="report-curve">
        <div class="report-curve-stage">
          <svg class="equity-curve-svg" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="训练收益率与同期指数比较曲线">
            <line :x1="PLOT.left" :y1="chartModel.zeroY" :x2="CHART_WIDTH - PLOT.right" :y2="chartModel.zeroY" class="curve-zero" />
            <line v-for="tick in chartModel.ticks" :key="tick.label" :x1="PLOT.left" :y1="tick.y" :x2="CHART_WIDTH - PLOT.right" :y2="tick.y" class="curve-grid" />
            <path v-for="key in chartModel.keys" :key="key" :d="chartModel.paths[key]" fill="none" :stroke="SERIES_COLORS[key]" :stroke-width="key === 'user' ? 2.4 : 1.8" />
            <line v-if="hoverIndex !== null" :x1="chartModel.x(hoverIndex)" :y1="PLOT.top" :x2="chartModel.x(hoverIndex)" :y2="CHART_HEIGHT - PLOT.bottom" class="curve-hover-line" />
            <circle v-if="hoverIndex !== null" v-for="key in chartModel.keys" :key="`point-${key}`" v-show="chartValue(key, hoverIndex) !== null" :cx="chartModel.x(hoverIndex)" :cy="chartModel.y(chartValue(key, hoverIndex) ?? 0)" r="3.5" :fill="SERIES_COLORS[key]" />
            <text v-for="tick in chartModel.ticks" :key="`y-${tick.label}`" :x="CHART_WIDTH - PLOT.right + 8" :y="tick.y + 4" class="curve-axis-label">{{ tick.label }}</text>
            <text v-for="tick in chartModel.xTicks" :key="`x-${tick.label}`" :x="tick.x" :y="CHART_HEIGHT - 12" text-anchor="middle" class="curve-axis-label">{{ tick.label }}</text>
            <rect :x="PLOT.left" :y="PLOT.top" :width="CHART_WIDTH - PLOT.left - PLOT.right" :height="CHART_HEIGHT - PLOT.top - PLOT.bottom" fill="transparent" aria-label="收益率曲线悬停区域" @pointermove="setHover" @pointerleave="clearHover" />
          </svg>
          <div v-if="tooltipPoint && hoverIndex !== null" class="report-curve-tooltip" role="status">
            <strong>{{ tooltipPoint.date }}</strong>
            <span>横轴：{{ tooltipPoint.date }}</span>
            <span :style="{ color: SERIES_COLORS.user }">训练：{{ (tooltipPoint.user * 100).toFixed(2) }}%</span>
            <span v-if="typeof tooltipPoint.sh000001 === 'number' && Number.isFinite(tooltipPoint.sh000001)" :style="{ color: SERIES_COLORS.sh000001 }">上证：{{ (tooltipPoint.sh000001 * 100).toFixed(2) }}%</span>
            <span v-if="typeof tooltipPoint.sz399303 === 'number' && Number.isFinite(tooltipPoint.sz399303)" :style="{ color: SERIES_COLORS.sz399303 }">国证 2000：{{ (tooltipPoint.sz399303 * 100).toFixed(2) }}%</span>
          </div>
        </div>
        <figcaption>
          <span v-if="chartModel.keys.includes('user')" class="legend-user">训练收益率</span>
          <span v-if="chartModel.keys.includes('sh000001')" class="legend-sh">上证指数</span>
          <span v-if="chartModel.keys.includes('sz399303')" class="legend-sz">国证 2000</span>
        </figcaption>
      </figure>
      <p v-else class="report-empty">该区间没有可展示的收益率点。</p>

      <h2>K线复盘 <button class="ghost-button report-review-toggle" @click="toggleReview">{{ reviewOpen ? '收起复盘' : '展开复盘' }}</button></h2>
      <div v-if="reviewOpen" class="report-review">
        <p v-if="reviewGuarded" class="history-guard" role="status">
          <strong>结束当前训练后可复盘历史</strong>
          <span>当前有进行中的训练；为避免旧局K线泄漏当前局的未来行情，复盘在训练进行期间关闭。</span>
        </p>
        <p v-else-if="reviewError" class="history-error" role="alert">
          <span>{{ reviewError }}</span>
          <button class="ghost-button" @click="loadReview()">重试</button>
        </p>
        <p v-else-if="reviewLoading || !review" class="history-loading" role="status">加载复盘K线…</p>
        <template v-else>
          <div class="report-review-chart">
            <KlineChart
              :bars="review.bars"
              :trades="review.trades"
              :cost-price="review.account.costPrice"
              :chart-cost-price="review.chartCostPrice"
              :drawing-price-basis="review.drawingPriceBasis ?? null"
              :has-more-bars="review.hasMore"
              :fetch-earlier="fetchEarlier"
              :saved-drawings="report.drawings"
              :read-only="true"
            />
          </div>
          <p class="report-note">复盘为只读回看：K线止于结算日 {{ report.training.settleDate }}，展示逐笔成交标记与当日保存的画线（不可编辑），权益曲线见上方；不开放结算日之后的行情。</p>
        </template>
      </div>
      <p v-else class="report-empty">复盘未展开。展开后只读回看该局K线、逐笔成交标记与已保存画线。</p>

      <p v-if="report.drawingsStatus === 'unavailable'" class="history-error" role="alert">复盘画线数据不可用：{{ report.drawingsReason }}</p>
    </template>
  </section>
</template>
