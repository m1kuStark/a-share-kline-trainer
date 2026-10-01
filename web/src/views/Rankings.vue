<script setup lang="ts">
// M4-01 五档排行：1M/3M/6M/1Y/2Y 独立分组（完整周期/提前结算），放弃与自定义范围不入榜。
// 排序为服务端冻结链（roadmap §2.7）：完整组 收益率↓→最大回撤↑→胜率↓→稳定键；提前组 收益率↓＋实际天数。
// 行级不可认证局不入榜，数量如实展示；运行中训练存在时服务端 409（同历史守卫）。
// 请求版本守卫：切档迟到/失败响应不得覆盖新状态，也不得留下永续 loading（FM-014/FM-015 教训）。
import { onMounted, ref, watch } from 'vue'
import { ApiError, fetchIndustryRankings, fetchRangeRankings, fetchRankings, fetchStockRankings, searchStocks, type RankingGroups, type RankingItem, type Stock } from '../api'
import HistoryReport from '../components/HistoryReport.vue'

const emit = defineEmits<{ create: [] }>()

const TIERS: Array<{ value: string; label: string }> = [
  { value: '1M', label: '1个月' },
  { value: '3M', label: '3个月' },
  { value: '6M', label: '6个月' },
  { value: '1Y', label: '1年' },
  { value: '2Y', label: '2年' },
]

const tier = ref('1M')
const mode = ref<'tier' | 'range' | 'industry' | 'stock'>('tier')
const industrySelection = ref<string | null>(null)
const groups = ref<RankingGroups | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const activeGuard = ref(false)
const loaded = ref(false)
const selectedId = ref<number | null>(null)
const stockQuery = ref('')
const stock = ref<Stock | null>(null)
const stockSuggestions = ref<Stock[]>([])
const stockHint = ref('')
const stockSearching = ref(false)
let stockSearchTimer: ReturnType<typeof setTimeout> | null = null
let stockSearchSeq = 0
let loadVersion = 0

async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  const targetTier = tier.value
  const targetMode = mode.value
  const targetStock = stock.value?.code ?? ''
  const targetIndustry = industrySelection.value ?? ''
  if (targetMode === 'stock' && !targetStock) {
    groups.value = null
    loaded.value = false
    loading.value = false
    errorMessage.value = ''
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = targetMode === 'range' ? await fetchRangeRankings() : targetMode === 'industry' ? await fetchIndustryRankings(targetIndustry || undefined) : targetMode === 'stock' ? await fetchStockRankings(targetStock) : await fetchRankings(targetTier)
    if (requestVersion !== loadVersion || targetTier !== tier.value || targetMode !== mode.value || targetStock !== (stock.value?.code ?? '') || targetIndustry !== (industrySelection.value ?? '')) return
    groups.value = payload
    activeGuard.value = false
    loaded.value = true
  } catch (error) {
    if (requestVersion !== loadVersion || targetTier !== tier.value || targetMode !== mode.value || targetStock !== (stock.value?.code ?? '') || targetIndustry !== (industrySelection.value ?? '')) return
    if (error instanceof ApiError && error.code === 'HISTORY_ACTIVE_TRAINING') {
      activeGuard.value = true
      groups.value = null
      loaded.value = false
    } else {
      errorMessage.value = error instanceof Error ? error.message : '无法读取排行'
    }
  } finally {
    if (requestVersion === loadVersion && targetTier === tier.value && targetMode === mode.value && targetStock === (stock.value?.code ?? '') && targetIndustry === (industrySelection.value ?? '')) loading.value = false
  }
}
onMounted(() => { void load() })
watch(tier, () => {
  selectedId.value = null
  void load()
})
watch(mode, () => { selectedId.value = null; industrySelection.value = null; void load() })

function selectIndustry(id: string): void {
  industrySelection.value = id
  selectedId.value = null
  void load()
}

function clearIndustrySelection(): void {
  industrySelection.value = null
  selectedId.value = null
  void load()
}

function searchStock(): void {
  const query = stockQuery.value.trim()
  loadVersion += 1
  loading.value = false
  stock.value = null
  stockSuggestions.value = []
  stockHint.value = ''
  stockSearching.value = false
  if (stockSearchTimer) clearTimeout(stockSearchTimer)
  if (!query) { void load(); return }
  const seq = ++stockSearchSeq
  stockSearching.value = true
  stockSearchTimer = setTimeout(() => {
    void searchStocks(query).then(result => {
      if (seq !== stockSearchSeq) return
      stockSuggestions.value = result.items.slice(0, 8)
      stockHint.value = result.items.length ? '' : '未匹配到股票，请输入六位代码或名称'
    }).catch(() => {
      if (seq === stockSearchSeq) stockHint.value = '股票搜索失败，请重试'
    }).finally(() => { if (seq === stockSearchSeq) stockSearching.value = false })
  }, 180)
}

function chooseStock(item: Stock): void {
  stock.value = item
  stockQuery.value = `${item.code} ${item.name}`
  stockSuggestions.value = []
  stockHint.value = ''
  void load()
}

function rank(index: number): string {
  return `${index + 1}`
}
function percent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const percent = value * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}
function ratioPercent(value: number | null | undefined): string {
  // 回撤/胜率等 0..1 比率：恒为正数呈现，不做涨跌配色
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${(value * 100).toFixed(2)}%`
}
function ratioText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '--'
}
function daysText(item: RankingItem): string {
  return `${item.actualDays} 交易日`
}
</script>

<template>
  <section class="rankings-page" aria-label="五档排行">
    <header class="rankings-header">
      <div>
        <h1>五档排行</h1>
        <p>已结算训练按档独立排行；放弃与自定义范围不入榜，行级不可认证局不计名次并如实计数。</p>
      </div>
      <button class="ghost-button" @click="emit('create')">返回创建训练</button>
    </header>

    <nav class="rankings-tabs" aria-label="排行模式">
      <button class="rankings-tab" :class="{ active: mode === 'tier' }" @click="mode = 'tier'">训练周期</button>
      <button class="rankings-tab" :class="{ active: mode === 'range' }" @click="mode = 'range'">自定义区间</button>
      <button class="rankings-tab" :class="{ active: mode === 'industry' }" @click="mode = 'industry'">行业板块</button>
      <button class="rankings-tab" :class="{ active: mode === 'stock' }" @click="mode = 'stock'">单只股票</button>
    </nav>
    <nav v-if="mode === 'tier'" class="rankings-tabs" aria-label="训练周期">
      <button
        v-for="entry in TIERS" :key="entry.value"
        class="rankings-tab" :class="{ active: tier === entry.value }"
        @click="tier = entry.value"
      >{{ entry.label }}</button>
    </nav>

    <section v-if="mode === 'stock'" class="stock-ranking-picker" aria-label="单只股票排行">
      <label for="ranking-stock-search">选择股票</label>
      <input id="ranking-stock-search" v-model="stockQuery" placeholder="输入代码或名称，例如 000602" @input="searchStock" />
      <div v-if="stockSuggestions.length" class="suggestions ranking-stock-suggestions">
        <button v-for="item in stockSuggestions" :key="`${item.market}:${item.code}`" @click="chooseStock(item)">
          <strong>{{ item.code }}</strong><span>{{ item.name }}</span><small>{{ item.market.toUpperCase() }}</small>
        </button>
      </div>
      <small v-if="stockSearching" class="form-hint" role="status">正在检索股票…</small>
      <small v-if="stockHint" class="form-hint">{{ stockHint }}</small>
      <small v-else-if="stockSuggestions.length" class="form-hint">请点击检索结果确认股票</small>
      <small v-if="stock" class="form-hint">已选择：{{ stock.name }}（{{ stock.code }}）</small>
    </section>

    <div v-if="activeGuard" class="history-guard" role="status">
      <strong>结束当前训练后可查看排行</strong>
      <p>当前有进行中的训练。为避免旧局记录泄漏当前局的未来行情，排行在训练进行期间关闭；可经左侧「训练」返回当前训练。</p>
    </div>

    <div v-else-if="errorMessage" class="history-error" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="ghost-button" @click="load()">重试</button>
    </div>

    <p v-else-if="loading" class="history-loading" role="status">加载中…</p>

    <template v-else-if="groups && mode === 'range'">
      <p v-if="!groups.rangeGroups?.length" class="history-empty">暂无自定义区间成绩</p>
      <section v-for="group in groups.rangeGroups" :key="group.key" aria-label="自定义区间排行">
        <h2>{{ group.startDate }} ~ {{ group.endDate }}</h2>
        <table class="rankings-table"><thead><tr><th>名次</th><th>标的</th><th>收益率</th><th>结算日</th></tr></thead>
          <tbody><tr v-for="(item, index) in [...group.complete, ...group.earlySettled]" :key="item.id" class="rankings-row" @click="selectedId = item.id"><td>{{ rank(index) }}</td><td><strong>{{ item.code }}</strong> {{ item.name }}</td><td :class="{ up: item.returnRate > 0, down: item.returnRate < 0 }">{{ percent(item.returnRate) }}</td><td>{{ item.settleDate ?? '--' }}</td></tr></tbody>
        </table>
      </section>
    </template>
    <template v-else-if="groups && mode === 'industry'">
      <p v-if="groups.industry?.status === 'unavailable'" class="history-error" role="alert">行业排行暂不可用：{{ groups.industry.reason }}</p>
      <p v-else-if="!groups.industry?.entries?.length" class="history-empty">暂无行业排行数据</p>
      <template v-else-if="!industrySelection">
        <section class="industry-picker" aria-label="选择行业板块">
          <h2>选择行业板块 <small>共 {{ groups.industry?.entries?.length ?? 0 }} 个</small></h2>
          <div class="industry-picker-grid">
            <button v-for="entry in groups.industry?.entries" :key="entry.id" class="industry-picker-item" type="button" @click="selectIndustry(entry.id)">
              <strong>{{ entry.name }}</strong>
              <small>{{ entry.complete.length + entry.earlySettled.length }} 局</small>
            </button>
          </div>
        </section>
      </template>
      <section v-else v-for="entry in groups.industry?.entries" :key="entry.id" aria-label="行业排行">
        <div class="industry-result-heading"><h2>{{ entry.name }}</h2><button class="ghost-button" type="button" @click="clearIndustrySelection">返回行业列表</button></div>
        <table class="rankings-table"><thead><tr><th>名次</th><th>标的</th><th>收益率</th><th>结算日</th></tr></thead>
          <tbody><tr v-for="(item, index) in [...entry.complete, ...entry.earlySettled]" :key="item.id" class="rankings-row" @click="selectedId = item.id"><td>{{ rank(index) }}</td><td><strong>{{ item.code }}</strong> {{ item.name }}</td><td :class="{ up: item.returnRate > 0, down: item.returnRate < 0 }">{{ percent(item.returnRate) }}</td><td>{{ item.settleDate ?? '--' }}</td></tr></tbody>
        </table>
        <p v-if="!entry.complete.length && !entry.earlySettled.length" class="history-empty">该行业暂无已结算训练成绩</p>
      </section>
    </template>
    <template v-else-if="groups && mode === 'stock'">
      <p v-if="groups.stock?.status === 'empty'" class="history-empty">{{ groups.stock.code }} 暂无已结算训练成绩</p>
      <template v-else>
        <h2>{{ groups.stock?.name || groups.stock?.code }} <small>同一股票的已结算训练</small></h2>
        <table v-if="groups.stock?.complete.length || groups.stock?.earlySettled.length" class="rankings-table">
          <thead><tr><th>名次</th><th>周期</th><th>区间</th><th>收益率</th><th>最大回撤</th><th>交易笔数</th><th>结算日</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in [...(groups.stock?.complete || []), ...(groups.stock?.earlySettled || [])]" :key="item.id" class="rankings-row" :data-training-id="item.id" @click="selectedId = item.id">
              <td>{{ rank(index) }}</td><td>{{ item.tier }}</td><td>{{ item.startDate }} ~ {{ item.settleDate ?? '--' }}</td>
              <td :class="{ up: item.returnRate > 0, down: item.returnRate < 0 }">{{ percent(item.returnRate) }}</td><td>{{ ratioPercent(item.maxDrawdown) }}</td><td>{{ item.tradeCount }}</td><td>{{ item.settleDate ?? '--' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="history-empty">暂无可认证成绩</p>
      </template>
    </template>
    <template v-else-if="groups">
      <p v-if="!groups.complete.length && !groups.earlySettled.length" class="history-empty">该周期暂无入榜成绩</p>
      <template v-else>
        <section aria-label="完整周期排行">
          <h2>完整周期 <small>收益率 ↓ → 最大回撤 ↑ → 胜率 ↓</small></h2>
          <table v-if="groups.complete.length" class="rankings-table">
            <thead>
              <tr>
                <th>名次</th><th>标的</th><th>区间</th><th>收益率</th><th>最大回撤</th>
                <th>胜率</th><th>盈亏比</th><th>交易笔数</th><th>沪深300超额</th><th>结算日</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in groups.complete" :key="item.id" class="rankings-row" :data-training-id="item.id" @click="selectedId = item.id">
                <td>{{ rank(index) }}</td>
                <td><strong>{{ item.code }}</strong> {{ item.name }}</td>
                <td>{{ item.startDate }} ~ {{ item.settleDate ?? '--' }}</td>
                <td :class="{ up: item.returnRate > 0, down: item.returnRate < 0 }">{{ percent(item.returnRate) }}</td>
                <td>{{ ratioPercent(item.maxDrawdown) }}</td>
                <td>{{ ratioPercent(item.winRate) }}</td>
                <td>{{ ratioText(item.profitLossRatio) }}</td>
                <td>{{ item.tradeCount }}</td>
                <td
                  :class="{ up: (item.benchmarkExcess ?? 0) > 0, down: (item.benchmarkExcess ?? 0) < 0 }"
                  :title="item.benchmarkExcess === null ? item.benchmarkExcessReason : undefined"
                >{{ percent(item.benchmarkExcess) }}</td>
                <td>{{ item.settleDate ?? '--' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="report-empty">暂无完整周期成绩</p>
        </section>

        <section aria-label="提前结算排行">
          <h2>提前结算 <small>收益率 ↓（展示实际天数）</small></h2>
          <table v-if="groups.earlySettled.length" class="rankings-table">
            <thead>
              <tr>
                <th>名次</th><th>标的</th><th>区间</th><th>收益率</th><th>最大回撤</th>
                <th>胜率</th><th>盈亏比</th><th>交易笔数</th><th>沪深300超额</th><th>实际天数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in groups.earlySettled" :key="item.id" class="rankings-row" :data-training-id="item.id" @click="selectedId = item.id">
                <td>{{ rank(index) }}</td>
                <td><strong>{{ item.code }}</strong> {{ item.name }}</td>
                <td>{{ item.startDate }} ~ {{ item.settleDate ?? '--' }}</td>
                <td :class="{ up: item.returnRate > 0, down: item.returnRate < 0 }">{{ percent(item.returnRate) }}</td>
                <td>{{ ratioPercent(item.maxDrawdown) }}</td>
                <td>{{ ratioPercent(item.winRate) }}</td>
                <td>{{ ratioText(item.profitLossRatio) }}</td>
                <td>{{ item.tradeCount }}</td>
                <td
                  :class="{ up: (item.benchmarkExcess ?? 0) > 0, down: (item.benchmarkExcess ?? 0) < 0 }"
                  :title="item.benchmarkExcess === null ? item.benchmarkExcessReason : undefined"
                >{{ percent(item.benchmarkExcess) }}</td>
                <td>{{ daysText(item) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="report-empty">暂无提前结算成绩</p>
        </section>

        <p v-if="groups.excludedUnavailable" class="rankings-excluded" role="note">
          另有 {{ groups.excludedUnavailable }} 局因历史数据不可认证（坏规则/旧版不复权/结算权益缺失）未计入排行；明细见历史列表。
        </p>
        <p v-if="groups.benchmark.status === 'unavailable'" class="rankings-excluded" role="note">
          沪深300超额暂不可用：{{ groups.benchmark.reason }}；其余指标不受影响。
        </p>
      </template>
    </template>

    <div v-if="selectedId !== null" class="report-modal-mask" role="presentation" @click.self="selectedId = null">
      <HistoryReport :id="selectedId" @close="selectedId = null" @back="selectedId = null" />
    </div>
  </section>
</template>

<style scoped>
.industry-picker { margin-top: 18px; }
.industry-picker h2 { display: flex; align-items: baseline; gap: 10px; }
.industry-picker h2 small, .industry-result-heading h2 small { color: var(--text-secondary); font-size: 12px; font-weight: 500; }
.industry-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.industry-picker-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; padding: 10px 12px; border: 1px solid var(--surface-border); border-radius: 8px; background: var(--surface-background); color: var(--text-primary); text-align: left; cursor: pointer; }
.industry-picker-item:hover, .industry-picker-item:focus-visible { border-color: #2b8b99; background: var(--surface-hover); }
.industry-picker-item small { color: var(--text-secondary); white-space: nowrap; }
.industry-result-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 18px; }
</style>
