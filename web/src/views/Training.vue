<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import KlineChart from '../components/KlineChart.vue'
import {
  abandonTraining, advanceTraining, fetchTrainingBars, settleTraining, tradeTraining,
  type Bar, type Tier, type Timeframe, type TrainingSnapshot,
} from '../api'
import { DRAW_TOOLS } from '../drawTools'

const props = defineProps<{ snapshot: TrainingSnapshot }>()
const emit = defineEmits<{ ended: [] }>()

const snapshot = ref<TrainingSnapshot>(props.snapshot)
const bars = ref<Bar[]>([])
const hasMoreBars = ref(true)
const tf = ref<Timeframe>('1D')
const chartCostPrice = ref<number | null>(null)
const loading = ref(false)
const message = ref('空格 推进下一日 · B 买入 · S 卖出 · ↑ 放大 ↓ 缩小 · 主图框选：右滑放大 / 左滑缩小 · ←→ 十字光标 · 滚轮平移 · Home 复位 · 双击副图放大/还原')
const errorMessage = ref('')
const visibleCount = ref(150)
const weight = ref(50)
const customWeight = ref<number | null>(null)
const sellShares = ref<number | null>(null)
const chartRef = ref<InstanceType<typeof KlineChart> | null>(null)
const settledView = ref<TrainingSnapshot | null>(null)
// 画线模式状态：null＝默认模式；非 null＝画线模式（控制台工具条点击切换，Esc 退出）
const drawTool = ref<string | null>(null)
const toolbarCollapsed = ref(false)

const training = computed(() => snapshot.value.training)
const account = computed(() => snapshot.value.account)
const returnPct = computed(() => ((account.value.equity - training.value.initialCash) / training.value.initialCash) * 100)
const isTyping = (event: KeyboardEvent) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)
const tierLabel = computed(() => ({ '1M': '1个月', '3M': '3个月', '6M': '6个月', '1Y': '1年', '2Y': '2年' }[training.value.tier as Tier] ?? training.value.tier))
const statusText = computed(() => {
  if (!drawTool.value) return message.value
  const label = DRAW_TOOLS.find(tool => tool.name === drawTool.value)?.label ?? drawTool.value
  return `画线模式：${label}（Esc 退出）`
})

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = await fetchTrainingBars(training.value.id, tf.value)
    snapshot.value = { training: payload.training, account: payload.account, trades: payload.trades }
    bars.value = payload.bars
    chartCostPrice.value = payload.chartCostPrice ?? null
    hasMoreBars.value = payload.hasMore
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    loading.value = false
  }
}

// 动态历史加载：视窗移动到已加载窗口之前时，向服务端分批取更早的 K 线（每批 300 根）
async function fetchEarlier(before: string, count: number): Promise<{ bars: Bar[]; hasMore: boolean }> {
  const payload = await fetchTrainingBars(training.value.id, tf.value, { before, count })
  return { bars: payload.bars, hasMore: payload.hasMore }
}

async function advance(): Promise<void> {
  if (loading.value || training.value.status !== 'running') return
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await advanceTraining(training.value.id)
    snapshot.value = result.snapshot
    if (result.settled) {
      settledView.value = result.snapshot
      message.value = `已到期结算：结算日 ${snapshot.value.training.settleDate}`
    } else {
      message.value = `推进至 ${snapshot.value.training.currentDate ?? '今日'}，收盘 ${result.bar ? result.bar.close.toFixed(2) : '--'}`
    }
    await load()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '推进失败'
  } finally {
    loading.value = false
  }
}

async function trade(side: 'buy' | 'sell'): Promise<void> {
  if (loading.value || training.value.status !== 'running') return
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = side === 'sell' && sellShares.value
      ? { side, shares: sellShares.value }
      : { side, weightPct: customWeight.value ?? weight.value }
    const result = await tradeTraining(training.value.id, payload)
    snapshot.value = result.snapshot
    message.value = `${side === 'buy' ? '买入' : '卖出'}成交：${result.plan.shares} 股 @ ${result.plan.price.toFixed(2)}`
    sellShares.value = null
    customWeight.value = null
    await load()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '交易失败'
  } finally {
    loading.value = false
  }
}

async function settle(): Promise<void> {
  if (loading.value || training.value.status !== 'running') return
  loading.value = true
  try {
    const result = await settleTraining(training.value.id)
    settledView.value = result
    message.value = `已提前结算：结算日 ${result.training.settleDate}`
    await load()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '结算失败'
  } finally {
    loading.value = false
  }
}

async function abandon(): Promise<void> {
  if (loading.value || training.value.status !== 'running') return
  if (!window.confirm('确认放弃当前训练？放弃成绩不入排行榜。')) return
  loading.value = true
  try {
    await abandonTraining(training.value.id)
    emit('ended')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '操作失败'
  } finally {
    loading.value = false
  }
}

function backToLauncher(): void {
  emit('ended')
}

function onKeydown(event: KeyboardEvent): void {
  if (isTyping(event)) return
  // 画线模式下 Space/B/S 禁用（防误推进/误交易），Esc 退出画线模式；方向键/Home 照常
  if (drawTool.value) {
    if (event.key === 'Escape') { event.preventDefault(); drawTool.value = null; return }
    if (event.code === 'Space' || ['b', 'B', 's', 'S'].includes(event.key)) { event.preventDefault(); return }
  }
  if (event.code === 'Space') { event.preventDefault(); void advance() }
  // Delete 删除选中的用户画线（引擎标记不可选中、不受影响）
  if (event.key === 'Delete') { event.preventDefault(); chartRef.value?.deleteSelected() }
  // 对齐通达信模拟训练习惯：B 买入、S 卖出（与按钮同一撮合路径）
  if (event.key === 'b' || event.key === 'B') { event.preventDefault(); void trade('buy') }
  if (event.key === 's' || event.key === 'S') { event.preventDefault(); void trade('sell') }
  // 对齐直觉方向：↑ 放大（可见 K 线变少变粗），↓ 缩小（可见 K 线变多变细）
  if (event.key === 'ArrowUp') { event.preventDefault(); chartRef.value?.zoomBy(1 / 1.3) }
  if (event.key === 'ArrowDown') { event.preventDefault(); chartRef.value?.zoomBy(1.3) }
  if (event.key === 'ArrowLeft') { event.preventDefault(); chartRef.value?.moveCrosshair(-1) }
  if (event.key === 'ArrowRight') { event.preventDefault(); chartRef.value?.moveCrosshair(1) }
  if (event.key === 'Home') { event.preventDefault(); chartRef.value?.resetView() }
}

window.addEventListener('keydown', onKeydown)
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

watch(tf, () => { void load() })
void load()
</script>

<template>
  <div class="training-shell">
    <header class="training-topbar">
      <div>
        <div class="workspace-title">
          {{ training.blind ? `盲训 · ${tierLabel}` : `${training.name ?? ''} · ${training.code ?? ''}` }}
        </div>
        <div class="training-meta">
          <span>{{ training.adjustMode === 'forward' ? '前复权' : '不复权' }}（已锁定）</span>
          <span>起始 {{ training.startDate }}</span>
          <span>当前 <strong>{{ training.currentDate }}</strong></span>
          <span>计划结束 {{ training.plannedEnd }}</span>
          <span>时长 {{ tierLabel }}</span>
        </div>
      </div>
      <div class="training-actions">
        <button class="ghost-button" @click="settle">提前结算</button>
        <button class="ghost-button danger" @click="abandon">放弃训练</button>
      </div>
    </header>

    <section class="toolbar">
      <div class="timeframe-tabs" role="tablist">
        <button v-for="item in (['1D', '1W', '1M'] as Timeframe[])" :key="item" :class="{ selected: tf === item }" @click="tf = item">{{ item === '1D' ? '日K' : item === '1W' ? '周K' : '月K' }}</button>
      </div>
      <span class="view-count">{{ visibleCount }} / 420 根（缩放 1~420）</span>
      <div class="toolbar-spacer"></div>
      <span v-if="loading" class="loading-dot">处理中</span>
      <button class="advance-button" :disabled="loading || training.status !== 'running'" @click="advance">推进下一日 <span>空格</span></button>
    </section>

    <section class="status-strip">
      <span class="status-label">{{ training.blind ? '盲训' : training.code ?? '' }}</span>
      <span>{{ statusText }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </section>



    <section class="training-grid">
      <div class="chart-panel">
        <KlineChart
          ref="chartRef" :bars="bars" :trades="snapshot.trades"
          :cost-price="account.costPrice" :chart-cost-price="chartCostPrice"
          :timeframe="tf" :has-more-bars="hasMoreBars" :fetch-earlier="fetchEarlier"
          :draw-tool="drawTool"
          @visible-count="visibleCount = $event"
          @tool-change="drawTool = $event"
        />
      </div>

      <aside class="trade-panel">
        <div class="console-scroll">
        <div class="panel-heading"><span>训练账户</span><span class="live-mark">● {{ training.status === 'running' ? '进行中' : '已结束' }}</span></div>
        <div class="equity-block">
          <span>账户权益</span>
          <strong>¥{{ account.equity.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</strong>
          <em :class="returnPct >= 0 ? 'up' : 'down'">{{ returnPct >= 0 ? '+' : '' }}{{ returnPct.toFixed(2) }}%</em>
        </div>
        <div class="account-stats">
          <div><span>可用资金</span><strong>¥{{ account.cash.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</strong></div>
          <div><span>持仓市值</span><strong>¥{{ account.marketValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</strong></div>
          <div><span>持仓（可卖）</span><strong>{{ account.shares }}（{{ account.availableShares }}）</strong></div>
          <div><span>摊薄成本</span><strong>{{ account.costPrice ? account.costPrice.toFixed(2) : '--' }}</strong></div>
        </div>

        <div class="panel-divider"></div>
        <div class="order-heading"><span>下单</span><small>按当日收盘价成交</small></div>
        <div class="weight-grid">
          <button v-for="w in [10, 20, 25, 30, 50, 75, 100]" :key="w" :class="{ selected: weight === w && customWeight === null }" @click="weight = w; customWeight = null">{{ w }}%</button>
          <input v-model.number="customWeight" type="number" min="1" max="100" placeholder="自定义%" />
        </div>
        <div class="shares-row">
          <input v-model.number="sellShares" type="number" min="1" placeholder="按股数卖出（选填）" />
          <small>留空则按左侧比例卖出</small>
        </div>
        <div class="trade-actions">
          <button class="trade-action buy" :disabled="training.status !== 'running'" @click="trade('buy')">买入</button>
          <button class="trade-action sell" :disabled="training.status !== 'running'" @click="trade('sell')">卖出</button>
        </div>

        <div class="panel-divider"></div>
        <div class="order-heading"><span>成交记录</span><small>{{ snapshot.trades.length }} 笔</small></div>
        <div class="trade-log">
          <div v-for="item in [...snapshot.trades].reverse()" :key="item.seq" class="trade-row">
            <span :class="item.side === 'buy' ? 'up' : 'down'">{{ item.side === 'buy' ? 'B' : 'S' }}{{ item.seq }}</span>
            <span>{{ item.date }}</span>
            <span>{{ item.shares }}股 @ {{ item.price.toFixed(2) }}</span>
          </div>
          <div v-if="!snapshot.trades.length" class="trade-empty">暂无成交</div>
        </div>
        </div>
        <!-- 画线工具条：停靠训练控制台底部（用户 D1 验收反馈改定），不遮挡图表；工具随交付单元逐个上线 -->
        <div class="draw-toolbar">
          <button class="tool-collapse" :title="toolbarCollapsed ? '展开画线工具条' : '折叠画线工具条'" @click="toolbarCollapsed = !toolbarCollapsed">{{ toolbarCollapsed ? '»' : '«' }}</button>
          <template v-if="!toolbarCollapsed">
            <button
              v-for="tool in DRAW_TOOLS" :key="tool.name"
              :class="{ active: drawTool === tool.name }" :title="tool.label"
              @mousedown.prevent
              @click="drawTool = drawTool === tool.name ? null : tool.name"
            >{{ tool.label }}</button>
          </template>
        </div>
      </aside>
    </section>

    <div v-if="settledView" class="settle-mask">
      <div class="settle-panel">
        <h2>{{ settledView.training.earlySettle ? '提前结算' : '到期结算' }}</h2>
        <div class="settle-grid">
          <div><span>结算日</span><strong>{{ settledView.training.settleDate }}</strong></div>
          <div><span>初始资金</span><strong>¥{{ settledView.training.initialCash.toLocaleString('zh-CN') }}</strong></div>
          <div><span>最终权益</span><strong>¥{{ settledView.account.equity.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</strong></div>
          <div>
            <span>总收益率</span>
            <strong :class="returnPct >= 0 ? 'up' : 'down'">
              {{ returnPct >= 0 ? '+' : '' }}{{ returnPct.toFixed(2) }}%
            </strong>
          </div>
          <div><span>交易笔数</span><strong>{{ settledView.trades.length }}</strong></div>
          <div><span>训练区间</span><strong>{{ settledView.training.startDate }} ~ {{ settledView.training.settleDate }}</strong></div>
        </div>
        <button class="trade-action buy" @click="backToLauncher">完成，返回首页</button>
      </div>
    </div>
  </div>
</template>
