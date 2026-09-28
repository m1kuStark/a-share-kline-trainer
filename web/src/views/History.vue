<script setup lang="ts">
// M4-HISTORY-01 历史训练列表：只读分页查询 + 稳定排序展示。
// 请求版本守卫：迟到/失败响应不得覆盖新状态，也不得留下永续 loading（FM-014 教训）。
// 运行中训练存在时服务端 409 HISTORY_ACTIVE_TRAINING：展示守卫说明，可经侧栏返回当前训练。
import { computed, onMounted, ref } from 'vue'
import { ApiError, fetchTrainingHistory, type HistoryItem } from '../api'
import HistoryReport from '../components/HistoryReport.vue'

const emit = defineEmits<{ create: [] }>()

const items = ref<HistoryItem[]>([])
const total = ref(0)
const limit = ref(20)
const offset = ref(0)
const loading = ref(false)
const errorMessage = ref('')
const activeGuard = ref(false)
const selectedId = ref<number | null>(null)
// FM-015/F2 三态归属：仅当"当前请求成功返回"后（loaded=true）才允许渲染空态或列表；
// 加载期间只显示加载态，不显示空态/列表/分页；失效响应不得回写任何状态。
const loaded = ref(false)
let loadVersion = 0

async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = await fetchTrainingHistory({ limit: limit.value, offset: offset.value })
    if (requestVersion !== loadVersion) return
    items.value = payload.items
    total.value = payload.total
    limit.value = payload.limit
    offset.value = payload.offset
    activeGuard.value = false
    loaded.value = true
  } catch (error) {
    if (requestVersion !== loadVersion) return
    if (error instanceof ApiError && error.code === 'HISTORY_ACTIVE_TRAINING') {
      activeGuard.value = true
      items.value = []
      total.value = 0
      loaded.value = false
    } else {
      errorMessage.value = error instanceof Error ? error.message : '无法读取历史训练'
    }
  } finally {
    if (requestVersion === loadVersion) loading.value = false
  }
}
onMounted(() => { void load() })

const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + limit.value < total.value)
const rangeText = computed(() => total.value === 0 ? '' : `第 ${offset.value + 1}~${Math.min(offset.value + items.value.length, total.value)} 局 / 共 ${total.value} 局`)
function turnPage(direction: -1 | 1): void {
  const next = offset.value + direction * limit.value
  if (next < 0 || (direction === 1 && next >= total.value)) return
  offset.value = next
  void load()
}

const TIER_LABELS: Record<string, string> = { '1M': '1个月', '3M': '3个月', '6M': '6个月', '1Y': '1年', '2Y': '2年' }
const RANGE_MODE_LABELS: Record<string, string> = { preset: '自定义·预设', latest: '自定义·到最新', bars: '自定义·日K根数' }
function tierText(item: HistoryItem): string {
  return item.tier === 'RANGE' ? (RANGE_MODE_LABELS[item.rangeMode] ?? '自定义范围') : (TIER_LABELS[item.tier] ?? item.tier)
}
function classificationText(item: HistoryItem): string {
  return item.classification === 'early-settled' ? '提前结算' : '到期结算'
}
function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'
}
function percentText(item: HistoryItem): string {
  if (typeof item.returnRate !== 'number' || !Number.isFinite(item.returnRate)) return '--'
  const percent = item.returnRate * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}
</script>

<template>
  <section class="history-page" aria-label="历史训练">
    <header class="history-header">
      <div>
        <h1>历史训练</h1>
        <p>只读事实成绩单：来自已结算训练的持久记录，不含排行与未冻结指标。</p>
      </div>
      <button class="ghost-button" @click="emit('create')">返回创建训练</button>
    </header>

    <div v-if="activeGuard" class="history-guard" role="status">
      <strong>结束当前训练后可查看历史</strong>
      <p>当前有进行中的训练。为避免旧局相同股票的记录泄漏当前局的未来行情，历史查询在训练进行期间关闭；可经左侧「训练」返回当前训练。</p>
    </div>

    <div v-else-if="errorMessage" class="history-error" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="ghost-button" @click="load()">重试</button>
    </div>

    <!-- FM-015/F2：请求未完成时只显示加载态；仅成功响应后按 total 渲染空态或列表 -->
    <p v-else-if="loading" class="history-loading" role="status">加载中…</p>

    <template v-else>
      <p v-if="!total" class="history-empty">暂无已结算训练</p>
      <div v-else class="history-list">
        <button v-for="item in items" :key="item.id" class="history-row" :class="{ unavailable: item.integrity === 'unavailable' }" :data-training-id="item.id" @click="selectedId = item.id">
          <span class="history-row-title"><strong>{{ item.code }}</strong> {{ item.name }}<small>{{ tierText(item) }}</small></span>
          <span class="history-row-dates">{{ item.startDate }} ~ {{ item.settleDate ?? '未知' }}</span>
          <span class="history-row-classification" :class="item.classification">{{ classificationText(item) }}</span>
          <span class="history-row-money">{{ money(item.finalEquity) }}</span>
          <span class="history-row-return" :class="{ up: (item.returnRate ?? 0) > 0, down: (item.returnRate ?? 0) < 0 }">{{ percentText(item) }}</span>
          <span class="history-row-count">{{ item.tradeCount }} 笔</span>
          <span v-if="item.integrity === 'unavailable'" class="history-row-integrity" :title="item.integrityReason">不可认证</span>
        </button>
      </div>

      <div v-if="total" class="history-pagination">
        <button class="ghost-button" :disabled="!hasPrev || loading" @click="turnPage(-1)">上一页</button>
        <span class="history-range">{{ rangeText }}</span>
        <button class="ghost-button" :disabled="!hasNext || loading" @click="turnPage(1)">下一页</button>
      </div>
    </template>

    <!-- 详情与列表共存：可在多局间直接切换（A→B 迟到响应由版本守卫丢弃，不留永续 loading） -->
    <HistoryReport v-if="selectedId !== null" :id="selectedId" @back="selectedId = null" />
  </section>
</template>
