<script setup lang="ts">
// M4-01 五档排行：1M/3M/6M/1Y/2Y 独立分组（完整周期/提前结算），放弃与自定义范围不入榜。
// 排序为服务端冻结链（roadmap §2.7）：完整组 收益率↓→最大回撤↑→胜率↓→稳定键；提前组 收益率↓＋实际天数。
// 行级不可认证局不入榜，数量如实展示；运行中训练存在时服务端 409（同历史守卫）。
// 请求版本守卫：切档迟到/失败响应不得覆盖新状态，也不得留下永续 loading（FM-014/FM-015 教训）。
import { onMounted, ref, watch } from 'vue'
import { ApiError, fetchRankings, type RankingGroups, type RankingItem } from '../api'
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
const groups = ref<RankingGroups | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const activeGuard = ref(false)
const loaded = ref(false)
const selectedId = ref<number | null>(null)
let loadVersion = 0

async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  const targetTier = tier.value
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = await fetchRankings(targetTier)
    if (requestVersion !== loadVersion || targetTier !== tier.value) return
    groups.value = payload
    activeGuard.value = false
    loaded.value = true
  } catch (error) {
    if (requestVersion !== loadVersion || targetTier !== tier.value) return
    if (error instanceof ApiError && error.code === 'HISTORY_ACTIVE_TRAINING') {
      activeGuard.value = true
      groups.value = null
      loaded.value = false
    } else {
      errorMessage.value = error instanceof Error ? error.message : '无法读取排行'
    }
  } finally {
    if (requestVersion === loadVersion && targetTier === tier.value) loading.value = false
  }
}
onMounted(() => { void load() })
watch(tier, () => {
  selectedId.value = null
  void load()
})

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

    <nav class="rankings-tabs" aria-label="训练周期">
      <button
        v-for="entry in TIERS" :key="entry.value"
        class="rankings-tab" :class="{ active: tier === entry.value }"
        @click="tier = entry.value"
      >{{ entry.label }}</button>
    </nav>

    <div v-if="activeGuard" class="history-guard" role="status">
      <strong>结束当前训练后可查看排行</strong>
      <p>当前有进行中的训练。为避免旧局记录泄漏当前局的未来行情，排行在训练进行期间关闭；可经左侧「训练」返回当前训练。</p>
    </div>

    <div v-else-if="errorMessage" class="history-error" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="ghost-button" @click="load()">重试</button>
    </div>

    <p v-else-if="loading" class="history-loading" role="status">加载中…</p>

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

    <HistoryReport v-if="selectedId !== null" :id="selectedId" @back="selectedId = null" />
  </section>
</template>
