<script setup lang="ts">
import { computed, ref } from 'vue'
import { createTraining, previewTrainingRange, searchStocks, type Stock, type Tier, type TrainingRangePreview, type TrainingRangeRequest } from '../api'
import { dataStatus, dataUpdating, refreshDataNow } from '../dataStatus'

const emit = defineEmits<{ created: [options: { enabled: boolean; params: Record<string, string | number | TrainingRangeRequest> }] }>()
const recordingEnabled = ref(true)

const query = ref('')
const suggestions = ref<Stock[]>([])
const selected = ref<Stock | null>(null)
const tier = ref<Tier | 'RANGE'>('3M')
const startDate = ref(new Date().toISOString().slice(0, 10))

// —— 自定义范围模式（TRAIN-02 第二片）：默认 3M、上海日期回退 3 自然月，预设点击重置默认区间 ——
const rangeMonths = ref(3)
const rangeStart = ref(defaultRangeStart())
const rangeMode = ref<'preset' | 'latest'>('preset')
const rangePreview = ref<TrainingRangePreview | null>(null)
const previewing = ref(false)
let previewSequence = 0

function shanghaiToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultRangeStart(todayIso = shanghaiToday()): string {
  const d = new Date(`${todayIso}T12:00:00`)
  d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
}

function resetRangeDefaults(): void {
  rangeStart.value = defaultRangeStart()
  rangeMonths.value = 3
  rangePreview.value = null
}

function rangeRequest(): TrainingRangeRequest {
  if (rangeMode.value === 'latest') return { mode: 'latest', startDate: rangeStart.value }
  return { mode: 'preset', startDate: rangeStart.value, months: rangeMonths.value }
}

function onRangeInputChanged(): void {
  rangePreview.value = null // 任何范围输入变化使旧预览失效；提交时重新预览
}

async function refreshRangePreview(): Promise<void> {
  if (tier.value !== 'RANGE' || !selected.value) { rangePreview.value = null; return }
  const seq = ++previewSequence
  previewing.value = true
  try {
    const preview = await previewTrainingRange({
      code: selected.value.code,
      market: selected.value.market,
      range: rangeRequest(),
      adjustMode: adjustMode.value,
    })
    if (seq === previewSequence) rangePreview.value = preview
  } catch {
    if (seq === previewSequence) rangePreview.value = null
  } finally {
    if (seq === previewSequence) previewing.value = false
  }
}
const initialCash = ref<number>(1_000_000)
const adjustMode = ref<'forward' | 'raw'>('forward')
const submitting = ref(false)
const errorMessage = ref('')
// 开始训练守卫（DATA-05 收敛）：以 freshness 为准——stale/unknown 先弹"建议先更新"，
// current（官方离线日历判定已最新）零打扰直接创建。needsUpdate 仅为旧服务端兼容回退，
// 不再驱动确认框（否则周末/节假日启发误报会与首页绿色"已最新"自相矛盾）。
const showDataConfirm = ref(false)
const dataCutoff = computed(() => dataStatus.value?.sourceMaxDate ?? '未知')
const shouldSuggestDataUpdate = computed(() => {
  const status = dataStatus.value
  if (!status || dataUpdating.value) return false
  const freshness = status.freshness
  if (freshness) return freshness.state !== 'current'
  return status.needsUpdate
})

const tiers: Array<{ value: Tier | 'RANGE'; label: string }> = [
  { value: '1M', label: '1个月' },
  { value: '3M', label: '3个月' },
  { value: '6M', label: '6个月' },
  { value: '1Y', label: '1年' },
  { value: '2Y', label: '2年' },
  { value: 'RANGE', label: '自定义范围' },
]

async function onQuery(): Promise<void> {
  if (!query.value.trim()) { suggestions.value = []; return }
  try {
    const result = await searchStocks(query.value.trim())
    suggestions.value = result.items.slice(0, 8)
  } catch {
    suggestions.value = []
  }
}

function choose(stock: Stock): void {
  selected.value = stock
  query.value = `${stock.code} ${stock.name}`
  suggestions.value = []
  onRangeInputChanged() // 换股票使旧范围预览失效
}

/** 预设点击：回到旧五档直接生效；点「自定义范围」则重置默认区间（起点回退3自然月、3个月） */
function onTierClick(value: Tier | 'RANGE'): void {
  tier.value = value
  if (value === 'RANGE') resetRangeDefaults()
  onRangeInputChanged()
}

async function submit(): Promise<void> {
  if (submitting.value) return
  // 守卫加在提交路径最前端：数据待更新/待确认时先弹"建议先更新日线数据"确认框，不直接创建
  if (shouldSuggestDataUpdate.value) {
    showDataConfirm.value = true
    return
  }
  await performCreate()
}

async function performCreate(): Promise<void> {
  if (submitting.value) return
  errorMessage.value = ''
  if (!selected.value) {
    errorMessage.value = '请先搜索并选择一只股票'
    return
  }
  const cash = Number(initialCash.value)
  if (!Number.isFinite(cash) || cash <= 0) {
    errorMessage.value = '初始资金必须是正数（默认 1,000,000）'
    return
  }
  if (tier.value === 'RANGE') {
    if (!rangeStart.value) {
      errorMessage.value = '请选择范围起始日'
      return
    }
    submitting.value = true
    try {
      // 提交必须匹配当前输入的成功预览且未过期：先预览再立即创建（双击被 submitting 挡住）
      const preview = await previewTrainingRange({
        code: selected.value.code,
        market: selected.value.market,
        range: rangeRequest(),
        adjustMode: adjustMode.value,
      })
      const params = {
        code: selected.value.code,
        initial_cash: cash,
        adjust_mode: adjustMode.value,
        range: rangeRequest(),
        previewId: preview.previewId,
      }
      await createTraining(params)
      rangePreview.value = preview
      emit('created', { enabled: recordingEnabled.value, params: { ...params, start_date: preview.startDate } })
    } catch (error) {
      if (error instanceof Error && /409|RANGE_PREVIEW_STALE|预览/.test(error.message)) {
        rangePreview.value = null
        errorMessage.value = '范围预览已失效，请重新提交以生成新预览'
      } else {
        errorMessage.value = error instanceof Error ? error.message : '创建失败'
      }
    } finally {
      submitting.value = false
    }
    return
  }
  if (!startDate.value) {
    errorMessage.value = '请选择起始日'
    return
  }
  submitting.value = true
  try {
    const params = {
      tier: tier.value,
      code: selected.value.code,
      start_date: startDate.value,
      initial_cash: cash,
      adjust_mode: adjustMode.value,
    }
    await createTraining(params)
    emit('created', { enabled: recordingEnabled.value, params })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建失败'
  } finally {
    submitting.value = false
  }
}

/** 弹窗主按钮【先更新数据】：触发 refresh、关弹窗、不开始训练 */
function confirmUpdateFirst(): void {
  showDataConfirm.value = false
  void refreshDataNow()
}

/** 弹窗次按钮【仍要开始训练】：关弹窗，照常提交创建训练 */
function confirmStartAnyway(): void {
  showDataConfirm.value = false
  void performCreate()
}
</script>

<template>
  <div class="launcher">
    <header class="launcher-head">
      <h1>创建训练</h1>
      <p>选一只股票、一个周期档和一个起始日，从起始日向前盲走训练。创建后复权方式锁定，训练中不可切换。</p>
    </header>

    <section class="launcher-form">
      <div class="form-field wide">
        <label>股票</label>
        <input v-model="query" placeholder="搜索代码或名称，如 600519 或 贵州茅台" @input="onQuery" />
        <div v-if="suggestions.length" class="suggestions">
          <button v-for="stock in suggestions" :key="stock.code" @click="choose(stock)">
            <strong>{{ stock.code }}</strong><span>{{ stock.name }}</span><small>{{ stock.market.toUpperCase() }}</small>
          </button>
        </div>
        <small v-if="selected" class="form-hint">已选：{{ selected.name }}（{{ selected.code }}，数据截至 {{ selected.lastDate ?? 'N/A' }}）</small>
      </div>

      <div class="form-field">
        <label>训练周期</label>
        <div class="tier-grid">
          <button v-for="item in tiers" :key="item.value" :class="{ selected: tier === item.value }" @click="onTierClick(item.value)">{{ item.label }}</button>
        </div>
      </div>

      <div v-if="tier === 'RANGE'" class="form-field">
        <label>范围模式</label>
        <div class="tier-grid">
          <button :class="{ selected: rangeMode === 'preset' }" @click="rangeMode = 'preset'; onRangeInputChanged()">起始日＋月数</button>
          <button :class="{ selected: rangeMode === 'latest' }" @click="rangeMode = 'latest'; onRangeInputChanged()">起始日至今</button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label>{{ tier === 'RANGE' ? '范围起始日' : '起始日' }}</label>
          <input v-if="tier !== 'RANGE'" v-model="startDate" type="date" />
          <input v-else v-model="rangeStart" type="date" @change="onRangeInputChanged" />
          <small v-if="tier !== 'RANGE'" class="form-hint">起始日之前最多 840 根 K 线同屏显示</small>
          <small v-else class="form-hint">默认为您回退 3 个自然月；改动后提交时将重新预览</small>
        </div>
        <div v-if="tier === 'RANGE' && rangeMode === 'preset'" class="form-field">
          <label>训练月数</label>
          <div class="tier-grid">
            <button v-for="m in [1, 2, 3, 6, 12]" :key="m" :class="{ selected: rangeMonths === m }" @click="rangeMonths = m; onRangeInputChanged()">{{ m }}个月</button>
          </div>
        </div>
        <div v-else class="form-field">
          <label>初始资金</label>
          <input v-model.number="initialCash" type="number" min="10000" step="10000" />
        </div>
      </div>

      <div v-if="tier === 'RANGE' && rangeMode === 'preset'" class="form-field">
        <label>初始资金</label>
        <input v-model.number="initialCash" type="number" min="10000" step="10000" />
      </div>

      <div v-if="tier === 'RANGE' && rangePreview" class="form-field wide">
        <label>范围预览</label>
        <small class="form-hint">
          请求 {{ rangePreview.requestedStart }}{{ rangePreview.requestedEnd ? ` ~ ${rangePreview.requestedEnd}` : ' ~ 至今' }}；
          实际 {{ rangePreview.startDate }} ~ {{ rangePreview.endDate }}，共 {{ rangePreview.barCount }} 根日线
          <span v-if="rangePreview.notes.length">；{{ rangePreview.notes.join('；') }}</span>
        </small>
      </div>

      <!-- 双盲遮蔽已从 V1 移除（股票由用户手动选定，隐藏名称无意义）；
           随机股票＋随机时间的真盲测模式为 V2 候选，届时复用服务端休眠的 blind 遮蔽基建 -->
      <div class="form-field">
        <label>复权方式（创建后锁定）</label>
        <div class="tier-grid">
          <button :class="{ selected: adjustMode === 'forward' }" @click="adjustMode = 'forward'">前复权</button>
          <button :class="{ selected: adjustMode === 'raw' }" @click="adjustMode = 'raw'">不复权</button>
        </div>
      </div>

      <label class="recording-choice"><input v-model="recordingEnabled" type="checkbox" aria-label="记录操作" />记录操作</label>
      <small class="form-hint">建议保持开启，方便复盘、分享操作和排查问题。记录保存在本机浏览器，可随时暂停。</small>
      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      <button class="submit-button" :disabled="submitting" @click="submit">{{ submitting ? '创建中…' : '开始训练' }}</button>
    </section>

    <!-- 建议先更新日线数据：复用结算面板的模态风格（settle-mask/settle-panel） -->
    <div v-if="showDataConfirm" class="settle-mask" role="dialog" aria-modal="true" aria-label="建议先更新日线数据" @click.self="showDataConfirm = false">
      <div class="settle-panel data-confirm-panel">
        <h2>建议先更新日线数据</h2>
        <p class="data-confirm-text">
          <template v-if="!dataStatus?.sourceMaxDate">尚未完成首次数据扫描，暂无法确认本地日线是否最新。建议先执行一次“更新日线”再开始训练，避免用缺失的最近行情练习。</template>
          <template v-else-if="dataStatus.freshness?.state === 'unknown'">本地日线数据截止 <strong>{{ dataCutoff }}</strong>，最新交易日待确认。建议先重新读取本地日线再开始训练，避免用缺失的最近行情练习。</template>
          <template v-else>本地日线数据截止 <strong>{{ dataCutoff }}</strong>，可能落后于最新交易日。建议先更新数据再开始训练，避免用缺失的最近行情练习。</template>
        </p>
        <div class="data-confirm-actions">
          <button class="trade-action buy" @click="confirmUpdateFirst">先更新数据</button>
          <button class="ghost-button" @click="confirmStartAnyway">仍要开始训练</button>
        </div>
      </div>
    </div>
  </div>
</template>
