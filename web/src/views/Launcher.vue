<script setup lang="ts">
import { computed, ref } from 'vue'
import { createTraining, previewTrainingRange, searchStocks, type Stock, type Tier, type TrainingRangePreview, type TrainingRangeRequest } from '../api'
import { defaultRangeStart, isBarCountValid, rangeRequestOf, shanghaiToday } from '../rangeDate'
import { dataStatus, dataUpdating, refreshDataNow } from '../dataStatus'

const emit = defineEmits<{ created: [options: { enabled: boolean; params: Record<string, string | number | TrainingRangeRequest> }] }>()
const recordingEnabled = ref(true)

const query = ref('')
const suggestions = ref<Stock[]>([])
const selected = ref<Stock | null>(null)
const tier = ref<Tier | 'RANGE'>('3M')
const startDate = ref(new Date().toISOString().slice(0, 10))

// —— 自定义范围模式（TRAIN-02 第二片冻结合同）：三模式；默认 3M 按上海自然月回退并月末裁切；
// 任何范围输入变化都使旧预览/在途预览失效（版本守卫）；预览必须创建前可见供审阅。 ——
const rangeMonths = ref(3)
const RANGE_MONTH_OPTIONS = [1, 3, 6, 12, 24] as const
const rangeStart = ref(defaultRangeStart())
const rangeMode = ref<'preset' | 'latest' | 'bars'>('preset')
const rangeBarCount = ref(1)
const rangePreview = ref<{ request: TrainingRangeRequest; preview: TrainingRangePreview } | null>(null)
const previewing = ref(false)
let inputVersion = 0

function resetRangeDefaults(): void {
  rangeStart.value = defaultRangeStart()
  rangeMonths.value = 3
  rangeBarCount.value = 1
  rangePreview.value = null
}

function currentRangeRequest(): TrainingRangeRequest {
  if (rangeMode.value === 'latest') return { mode: 'latest', startDate: rangeStart.value }
  if (rangeMode.value === 'bars') return { mode: 'bars', startDate: rangeStart.value, count: rangeBarCount.value }
  return { mode: 'preset', startDate: rangeStart.value, months: rangeMonths.value }
}

/** 任何范围输入（起点/月数/N/模式/股票/复权）变化：旧预览与在途预览全部失效，
 * 旧的错误提示（如"非法 N"）也随之作废——输入已改，错误文案不再成立。 */
function onRangeInputChanged(): void {
  inputVersion += 1
  rangePreview.value = null
  errorMessage.value = ''
}

function onAdjustModeChanged(): void {
  if (tier.value === 'RANGE') onRangeInputChanged()
}

/** 生成预览：显式动作，完成后元信息可见供审阅；期间输入变化即丢弃（版本守卫） */
async function generateRangePreview(): Promise<boolean> {
  if (tier.value !== 'RANGE' || !selected.value) return false
  // 预览与提交共用同一校验：非法 N 在此报错保留原输入，绝不静默缩量后发请求
  if (rangeMode.value === 'bars' && !isBarCountValid(rangeBarCount.value)) {
    errorMessage.value = '训练根数 N 必须是正整数（当前输入无效），请修正后重新生成预览'
    return false
  }
  const versionAtRequest = inputVersion
  const requestAtRequest = currentRangeRequest()
  previewing.value = true
  try {
    const preview = await previewTrainingRange({
      code: selected.value.code,
      market: selected.value.market,
      range: requestAtRequest,
      adjustMode: adjustMode.value,
    })
    // await 之后重读输入（版本＋请求内容）：期间任何编辑/模式/股票/复权变化都使结果过期
    if (versionAtRequest !== inputVersion ||
        JSON.stringify(currentRangeRequest()) !== JSON.stringify(requestAtRequest)) {
      return false
    }
    rangePreview.value = { request: requestAtRequest, preview }
    errorMessage.value = '' // 成功生成预览后，此前的非法输入错误不再成立
    return true
  } catch {
    if (versionAtRequest === inputVersion) rangePreview.value = null
    return false
  } finally {
    if (versionAtRequest === inputVersion) previewing.value = false
  }
}

/** 当前输入是否有匹配的有效预览（请求内容逐字段一致） */
function hasMatchingPreview(request: TrainingRangeRequest): boolean {
  const held = rangePreview.value
  if (!held) return false
  const a = JSON.stringify(held.request)
  const b = JSON.stringify(request)
  return a === b
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
    if (rangeMode.value === 'bars' && !isBarCountValid(rangeBarCount.value)) {
      errorMessage.value = '训练根数 N 必须是正整数（当前输入无效），请修正后再开始训练'
      return
    }
    const request = currentRangeRequest()
    // 预览必须创建前可见供审阅：无匹配当前输入的预览时先生成并停下让用户确认，不直接创建
    if (!hasMatchingPreview(request)) {
      const ok = await generateRangePreview()
      if (!ok) {
        errorMessage.value = '生成范围预览失败，请重试'
        return
      }
      errorMessage.value = '已生成范围预览，请核对下方预览信息后再次点击「开始训练」'
      return
    }
    submitting.value = true
    try {
      const preview = rangePreview.value!.preview
      const params = {
        code: selected.value.code,
        initial_cash: cash,
        adjust_mode: adjustMode.value,
        range: request,
        previewId: preview.previewId,
      }
      await createTraining(params)
      emit('created', { enabled: recordingEnabled.value, params: { ...params, start_date: preview.startDate } })
    } catch (error) {
      if (error instanceof Error && /409|RANGE_PREVIEW_STALE|过期|预览/.test(error.message)) {
        onRangeInputChanged() // TTL/409：旧预览失效，需要重新生成审阅
        errorMessage.value = '范围预览已失效，请重新生成预览并确认'
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
          <button :class="{ selected: rangeMode === 'latest' }" @click="rangeMode = 'latest'; onRangeInputChanged()">起始日到最新日线</button>
          <button :class="{ selected: rangeMode === 'bars' }" @click="rangeMode = 'bars'; onRangeInputChanged()">起始日＋根数</button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label>{{ tier === 'RANGE' ? '范围起始日' : '起始日' }}</label>
          <input v-if="tier !== 'RANGE'" v-model="startDate" type="date" />
          <input v-else v-model="rangeStart" type="date" @input="onRangeInputChanged" />
          <small v-if="tier !== 'RANGE'" class="form-hint">起始日之前最多 840 根 K 线同屏显示</small>
          <small v-else class="form-hint">默认按上海日历回退 3 个自然月（月末自动对齐）</small>
        </div>
        <div v-if="tier === 'RANGE' && rangeMode === 'preset'" class="form-field">
          <label>训练月数</label>
          <div class="tier-grid">
            <button v-for="m in RANGE_MONTH_OPTIONS" :key="m" :class="{ selected: rangeMonths === m }" @click="rangeMonths = m; onRangeInputChanged()">{{ m }}个月</button>
          </div>
        </div>
        <div v-else-if="tier === 'RANGE' && rangeMode === 'bars'" class="form-field">
          <label>训练根数 N</label>
          <input v-model.number="rangeBarCount" type="number" min="1" step="1" @input="onRangeInputChanged" />
          <small class="form-hint">从起始日（含）向后的日线根数，至少 1</small>
        </div>
        <div v-else class="form-field">
          <label>初始资金</label>
          <input v-model.number="initialCash" type="number" min="10000" step="10000" />
        </div>
      </div>

      <div v-if="tier === 'RANGE' && (rangeMode === 'latest' || rangeMode === 'bars')" class="form-field">
        <label>初始资金</label>
        <input v-model.number="initialCash" type="number" min="10000" step="10000" />
      </div>

      <div v-if="tier === 'RANGE'" class="form-field wide">
        <div class="form-row" style="align-items:center">
          <button class="ghost-button" :disabled="previewing || !selected" @click="generateRangePreview">{{ previewing ? '生成预览中…' : '生成范围预览' }}</button>
          <small class="form-hint">创建前请先核对预览；任何输入改动都会使预览失效</small>
        </div>
        <div v-if="rangePreview" class="form-hint">
          <strong>范围预览</strong>：<template v-if="rangePreview.request.mode === 'bars'">从 {{ rangePreview.request.startDate }}（含）共 {{ rangePreview.request.count }} 根</template><template v-else-if="rangePreview.request.mode === 'latest'">从 {{ rangePreview.request.startDate }} 到最新日线</template><template v-else>从 {{ rangePreview.request.startDate }} 共 {{ rangePreview.request.months }} 个月</template>；
          实际 {{ rangePreview.preview.startDate }} ~ {{ rangePreview.preview.endDate }}，共 {{ rangePreview.preview.barCount }} 根日线
          <span v-if="rangePreview.preview.notes.length">；{{ rangePreview.preview.notes.join('；') }}</span>
        </div>
      </div>

      <!-- 双盲遮蔽已从 V1 移除（股票由用户手动选定，隐藏名称无意义）；
           随机股票＋随机时间的真盲测模式为 V2 候选，届时复用服务端休眠的 blind 遮蔽基建 -->
      <div class="form-field">
        <label>复权方式（创建后锁定）</label>
        <div class="tier-grid">
          <button :class="{ selected: adjustMode === 'forward' }" @click="adjustMode = 'forward'; onAdjustModeChanged()">前复权</button>
          <button :class="{ selected: adjustMode === 'raw' }" @click="adjustMode = 'raw'; onAdjustModeChanged()">不复权</button>
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
