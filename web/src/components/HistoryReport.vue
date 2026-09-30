<script setup lang="ts">
// M4-HISTORY-01 只读事实成绩单：事实元信息、冻结规则（origin/capturedAt）、逐笔成交、
// 已保存权益曲线与画线标注清单（只读，保留原始价格基准，不提供编辑器/行情K线）。
// M4-01 增量：K线复盘只读回看——按需加载 /api/trainings/:id/bars（服务端守卫：运行中
// 训练存在时仅放行其自身，其他训练 409 同历史口径），只读渲染K线＋B/S标记＋已保存画线；
// 不提供任何编辑写入口，复盘K线止于结算日，不开放之后的行情。
// 请求版本守卫：A→B 切换后 A 的迟到/失败响应不得覆盖 B，也不得留下永续 loading。
import { computed, ref, watch } from 'vue'
import { ApiError, fetchTrainingBars, fetchTrainingReport, type HistoryReportPayload, type TrainingBarsPayload } from '../api'
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
watch(() => props.id, () => {
  reviewOpen.value = false
  review.value = null
  reviewError.value = ''
  reviewGuarded.value = false
  void load()
}, { immediate: true })

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
  <section class="report-page" role="dialog" aria-modal="true" aria-label="成绩单">
    <header class="report-header">
      <div>
        <h1>训练成绩单</h1>
        <p v-if="report">第 {{ report.training.id }} 局 · {{ report.training.code }} {{ report.training.name }}（{{ info?.tierText }}）</p>
      </div>
      <button class="ghost-button report-modal-back" type="button" @click="emit('close')">返回历史列表</button>
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
