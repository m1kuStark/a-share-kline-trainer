<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ApiError, createRandomTraining, createTraining, fetchTrainingSettings, previewTrainingRange, searchStocks, type RandomDimension, type RandomTrainingRequest, type Stock, type Tier, type TrainingRangePreview, type TrainingRangeRequest, type TrainingSettingsView } from '../api'
import { minusMonthsShanghai, shanghaiToday } from '../rangeDate'
import { dataStatus, dataUpdating, refreshDataNow } from '../dataStatus'
import { lastSavedSettings, settingsSavedVersion } from '../settingsPanel'

const emit = defineEmits<{ created: [options: { enabled: boolean; params: Record<string, string | number | boolean | TrainingRangeRequest> }] }>()
const recordingEnabled = ref(true)
const clockMode = ref<'close_only' | 'open_close'>('close_only')
const ordersEnabled = ref(false)

// ===== M7-02 首页模式标签：经典模式（原表单）｜随机模式（复用同一面板，按维度显隐） =====
const mode = ref<'classic' | 'random'>('classic')
const randomDimension = ref<RandomDimension>('random_stock')
const windowBars = ref(250)
/** RF-04/RF2-01 随机训练周期档：默认 3M（与经典默认档一致）；
 * WINDOW_BARS＝自定义根数（random_time/random_both 旧口径）；RANGE＝自定义范围（random_stock 旧口径） */
const randomTier = ref<Tier | 'WINDOW_BARS' | 'RANGE'>('3M')
const RANDOM_DIMENSIONS: Array<{ value: RandomDimension; label: string; hint: string }> = [
  { value: 'random_stock', label: '随机股票 · 我选时间段', hint: '选定时间段内由服务器随机选股，结算前隐藏股票名称与代码' },
  { value: 'random_time', label: '随机时间段 · 我选股票', hint: '由服务器在该股票历史中随机选一段行情，结算前隐藏真实日期（图表日期为偏移伪日期）' },
  { value: 'random_both', label: '全随机', hint: '股票与时间段都由服务器随机，双重隐藏，结算后揭晓' },
]
const dimensionHint = computed(() => RANDOM_DIMENSIONS.find(item => item.value === randomDimension.value)?.hint ?? '')
/** 股票选择器：经典始终显示；随机模式仅 random_time（用户选股） */
const showStockPicker = computed(() => mode.value === 'classic' || randomDimension.value === 'random_time')
/** 经典 preset 起始日＋行内初始资金（原布局）；随机模式不渲染该行内组合 */
const showPresetStart = computed(() => mode.value === 'classic' && tier.value !== 'RANGE')
/** 起止日输入（复用 rangeStart/rangeEnd）：经典自定义范围｜随机 random_stock 的「自定义范围」档（RF2-01） */
const showRangeDates = computed(() => mode.value === 'classic' ? tier.value === 'RANGE' : randomDimension.value === 'random_stock' && randomTier.value === 'RANGE')
/** RF-04/RF2-01 随机训练周期档位网格：三种随机维度全部复用经典五档（random_stock 另配「自定义范围」档） */
const showRandomPeriod = computed(() => mode.value === 'random')
/** 训练窗口长度（根数输入）：随机模式下仅「自定义根数」档显示 */
const showWindowBars = computed(() => showRandomPeriod.value && randomTier.value === 'WINDOW_BARS')

function setMode(next: 'classic' | 'random'): void {
  if (mode.value === next) return
  mode.value = next
  errorMessage.value = ''
}
function onDimensionClick(dimension: RandomDimension): void {
  randomDimension.value = dimension
  errorMessage.value = ''
  // RF2-01 档位状态跨维度归一：「自定义根数」档仅 random_time/random_both；「自定义范围」档仅 random_stock
  if (dimension === 'random_stock' && randomTier.value === 'WINDOW_BARS') randomTier.value = '3M'
  if (dimension !== 'random_stock' && randomTier.value === 'RANGE') randomTier.value = '3M'
}

// ===== 股票选择（UI-03 用户反馈）：代码/名称双框联动 =====
// 任一框输入即清空另一框与已选股票（重新选择从两框空白开始）；所有匹配结果
// 都必须由用户点击确认，前缀与拼音首字母检索统一走下拉；匹配不到给行内提示。
const codeText = ref('')
const nameText = ref('')
const selected = ref<Stock | null>(null)
const suggestions = ref<Stock[]>([])
const matchHint = ref('')
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

function clearOtherAndSelection(edited: 'code' | 'name'): void {
  if (edited === 'code') nameText.value = ''
  else codeText.value = ''
  selected.value = null
  matchHint.value = ''
}

function onCodeInput(): void {
  if (selected.value || nameText.value) clearOtherAndSelection('code')
  scheduleSearch('code')
}

function onNameInput(): void {
  if (selected.value || codeText.value) clearOtherAndSelection('name')
  scheduleSearch('name')
}

function scheduleSearch(field: 'code' | 'name'): void {
  const seq = ++searchSeq
  const text = (field === 'code' ? codeText.value : nameText.value).trim()
  if (searchTimer) clearTimeout(searchTimer)
  if (!text) {
    suggestions.value = []
    matchHint.value = ''
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = setTimeout(() => { void runSearch(text, seq) }, 250)
}

async function runSearch(text: string, seq: number): Promise<void> {
  try {
    const result = await searchStocks(text)
    if (seq !== searchSeq) return // 期间又有输入：过期响应丢弃
    // 精确命中也必须由用户点击确认，避免输入过程意外切换标的。
    suggestions.value = result.items.slice(0, 8)
    matchHint.value = result.items.length
      ? ''
      : '未匹配到股票：请检查代码/名称是否正确，或试试名称拼音首字母（如 GZMT）'
  } catch {
    if (seq !== searchSeq) return
    suggestions.value = []
    matchHint.value = '股票搜索失败，请重试'
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

function choose(stock: Stock): void {
  selected.value = stock
  codeText.value = stock.code
  nameText.value = stock.name
  suggestions.value = []
  matchHint.value = ''
  onRangeInputChanged() // 换股票使旧范围校验失效
}

// ===== 周期与起始日（UI-03 用户反馈）：选择周期＝从最新数据日回退对应长度 =====
const TIER_MONTHS: Record<Exclude<Tier, 'RANGE'>, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 }
const tier = ref<Tier | 'RANGE'>('3M')
// 起始日锚点＝行情最新日（数据状态 sourceMaxDate）；未扫描时回退上海今天
const anchorDate = computed(() => dataStatus.value?.sourceMaxDate || shanghaiToday())
const startDate = ref(minusMonthsShanghai(anchorDate.value, TIER_MONTHS['3M']))
const startDateTouched = ref(false)
const initialCash = ref<number>(1_000_000)
const adjustMode = ref<'forward' | 'raw'>('forward')
const submitting = ref(false)
const errorMessage = ref('')

// 数据状态到达/变化后，手填过的起始日不覆盖；未动过则随最新锚点重算（选股、刷新不打扰）
watch(dataStatus, () => {
  if (mode.value === 'classic' && tier.value !== 'RANGE' && !startDateTouched.value) {
    startDate.value = minusMonthsShanghai(anchorDate.value, TIER_MONTHS[tier.value])
  }
})

// ===== 自定义范围：用户明确选择起止日期 =====
// 预设周期仍按自然月回退；自定义范围直接发送起止日期，服务端负责交易日对齐、
// 尾段覆盖和未来日期校验。任何范围输入变化使旧校验/在途校验失效（版本守卫）。
const rangeStart = ref(minusMonthsShanghai(anchorDate.value, 3))
const rangeEnd = ref(anchorDate.value)

// —— M5-DEFAULTS：默认资金/复权装配 ——
// 挂载读取最新设置作为表单初值；读取完成前不允许按旧默认偷偷创建（开始训练禁用）。
// 读取失败提供重试；迟到/重复响应不覆盖用户已编辑字段（按字段 dirty + 请求版本守卫）。
// 设置保存成功只更新未编辑字段；实际复权变化使范围预览与在途预览失效。
const defaultsState = ref<'loading' | 'ready' | 'error'>('loading')
const defaultsError = ref('')
const initialCashDirty = ref(false)
const adjustModeDirty = ref(false)
const customNotice = ref('')
let defaultsRequestVersion = 0

async function loadDefaults(): Promise<void> {
  const version = ++defaultsRequestVersion
  defaultsState.value = 'loading'
  defaultsError.value = ''
  try {
    const view = await fetchTrainingSettings()
    if (version !== defaultsRequestVersion) return
    applyDefaults(view)
    defaultsState.value = 'ready'
  } catch (error) {
    if (version !== defaultsRequestVersion) return
    defaultsError.value = error instanceof Error ? error.message : '无法读取训练默认设置'
    defaultsState.value = 'error'
  }
}

function applyDefaults(view: TrainingSettingsView): void {
  if (!initialCashDirty.value) initialCash.value = view.initialCash
  if (!adjustModeDirty.value) adjustMode.value = view.adjustMode
}

function retryDefaults(): void {
  void loadDefaults()
}

// 设置保存成功广播（F4 返修续）：递增读取版本使在途/迟到的 GET 全部作废（过期响应不得
// 覆盖保存后的新默认或表单），再应用保存结果到未手改字段；实际复权变化使预览失效；
// 已编辑字段保留并提示“本次使用自定义值”。
// F4-final（loading 收敛）：保存结果来自服务器成功往返，等价于拿到了最新默认——
// 作废在途初读后必须把完成所有权移交给保存结果：loading/error 一律收敛为 ready，
// 否则“初读在途→保存成功→旧 GET 被丢弃”会让开始训练永久禁用。
watch(settingsSavedVersion, () => {
  const saved = lastSavedSettings.value
  if (!saved) return
  defaultsRequestVersion += 1
  defaultsError.value = ''
  if (defaultsState.value !== 'ready') defaultsState.value = 'ready'
  let usedCustom = false
  if (!initialCashDirty.value) initialCash.value = saved.initialCash
  else usedCustom = true
  const adjustChanged = adjustMode.value !== saved.adjustMode
  if (!adjustModeDirty.value) {
    adjustMode.value = saved.adjustMode
    if (adjustChanged && tier.value === 'RANGE') onRangeInputChanged()
  } else {
    usedCustom = true
    if (adjustChanged && tier.value === 'RANGE') onRangeInputChanged()
  }
  customNotice.value = usedCustom ? '本次使用自定义值：已编辑字段保留你的输入' : ''
})

onMounted(() => {
  void loadDefaults()
})
const rangePreview = ref<{ request: TrainingRangeRequest; preview: TrainingRangePreview } | null>(null)
const previewing = ref(false)
const clampNotice = ref('')
let inputVersion = 0

function resetRangeDefaults(): void {
  rangeStart.value = minusMonthsShanghai(anchorDate.value, 3)
  rangeEnd.value = anchorDate.value
  rangePreview.value = null
  clampNotice.value = ''
}

function currentRangeRequest(): TrainingRangeRequest {
  // 服务端 preset 请求已支持显式 endDate；months=1 保持旧 range schema 兼容，
  // 实际窗口完全由用户给出的起止日期决定。
  return { mode: 'preset', startDate: rangeStart.value, months: 1, endDate: rangeEnd.value }
}

/** 任何范围输入（起点/终点/股票/复权）变化：旧校验与在途校验全部失效，旧的错误提示随之作废 */
function onRangeInputChanged(): void {
  inputVersion += 1
  rangePreview.value = null
  clampNotice.value = ''
  errorMessage.value = ''
  // 返修 F5：失效在途预览时立即释放加载所有权——旧响应迟到被版本守卫丢弃，
  // 不得出现按钮永久“生成预览中/disabled”；新请求的加载态由新请求自己持有。
  previewing.value = false
}

function markAdjustMode(mode: 'forward' | 'raw'): void {
  adjustMode.value = mode
  adjustModeDirty.value = true
  onAdjustModeChanged()
}
function onAdjustModeChanged(): void {
  if (tier.value === 'RANGE') onRangeInputChanged()
}

async function generateRangePreview(): Promise<boolean> {
  if (mode.value !== 'classic' || tier.value !== 'RANGE' || !selected.value || previewing.value) return false
  if (!rangeStart.value || !rangeEnd.value || rangeEnd.value < rangeStart.value) return false
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
    if (versionAtRequest !== inputVersion ||
        JSON.stringify(currentRangeRequest()) !== JSON.stringify(requestAtRequest)) {
      return false
    }
    rangePreview.value = { request: requestAtRequest, preview }
    errorMessage.value = ''
    return true
  } catch (error) {
    if (versionAtRequest !== inputVersion) return false
    rangePreview.value = null
    const message = error instanceof Error ? error.message : ''
    if (versionAtRequest === inputVersion) errorMessage.value = message || '范围校验失败，请重试'
    return false
  } finally {
    if (versionAtRequest === inputVersion) previewing.value = false
  }
}

/** 当前输入是否有匹配的有效校验（请求内容逐字段一致） */
function hasMatchingPreview(request: TrainingRangeRequest): boolean {
  const held = rangePreview.value
  if (!held) return false
  return JSON.stringify(held.request) === JSON.stringify(request)
}

let previewTimer: ReturnType<typeof setTimeout> | null = null
/** 自动校验：经典自定义范围下选中股票且输入合法时防抖触发（UI-03：去掉意义不明的手动按钮）；
 *  随机模式不生成范围校验（窗口合法性由服务端随机池保证） */
function schedulePreviewGeneration(): void {
  if (mode.value !== 'classic' || tier.value !== 'RANGE' || !selected.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (hasMatchingPreview(currentRangeRequest())) return
    void generateRangePreview()
  }, 400)
}

watch([tier, rangeStart, rangeEnd, adjustMode, selected], () => {
  if (mode.value !== 'classic' || tier.value !== 'RANGE' || !selected.value) return
  if (hasMatchingPreview(currentRangeRequest())) return
  schedulePreviewGeneration()
})

// 开始训练守卫（DATA-05 收敛）：以 freshness 为准——stale/unknown 先弹"建议先更新"，
// current（官方离线日历判定已最新）零打扰直接创建。needsUpdate 仅为旧服务端兼容回退。
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

/** RF-04 随机训练周期档位：完全复用经典五档（同 TIER_MONTHS 月数与同文案）＋「自定义根数」
 *  （window_bars 旧口径，兼容既有习惯与旧 API 载荷）。 */
const randomPeriodOptions: Array<{ value: Tier | 'WINDOW_BARS'; label: string }> = [
  ...tiers.filter((item): item is { value: Tier; label: string } => item.value !== 'RANGE'),
  { value: 'WINDOW_BARS', label: '自定义根数' },
]

/** RF2-01 random_stock 档位：同款经典五档＋「自定义范围」档（start_date/end_date 旧口径保留） */
const randomStockPeriodOptions: Array<{ value: Tier | 'RANGE'; label: string }> = [
  ...tiers.filter((item): item is { value: Tier; label: string } => item.value !== 'RANGE'),
  { value: 'RANGE', label: '自定义范围' },
]

/** 当前维度的档位选项与网格提示（档位文案与经典完全一致） */
const activeRandomPeriodOptions = computed(() =>
  randomDimension.value === 'random_stock' ? randomStockPeriodOptions : randomPeriodOptions)
const randomPeriodHint = computed(() => randomDimension.value === 'random_stock'
  ? '与经典模式同一时间长度口径：窗口为最近所选档位的自然月数（以本地最新数据日为末锚），股票由服务器随机；「自定义范围」＝起止日期（旧口径）'
  : '与经典模式同一时间长度口径：起点随机，窗口为所选档位的自然月跨度；「自定义根数」＝按 K 线根数随机（旧口径）')

function onRandomTierClick(value: Tier | 'WINDOW_BARS' | 'RANGE'): void {
  randomTier.value = value
  errorMessage.value = ''
  // random_stock「自定义范围」档进场时重置默认区间（锚点回退 3 自然月，同经典 RANGE 习惯）
  if (mode.value === 'random' && randomDimension.value === 'random_stock' && value === 'RANGE') resetRangeDefaults()
}

/** 预设点击＝从锚点（最新数据日）回退对应周期重新生成起始日；自定义则重置默认区间 */
function onTierClick(value: Tier | 'RANGE'): void {
  tier.value = value
  if (value === 'RANGE') {
    resetRangeDefaults()
  } else {
    startDate.value = minusMonthsShanghai(anchorDate.value, TIER_MONTHS[value])
    startDateTouched.value = false
  }
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
  if (mode.value === 'random') {
    await performRandomCreate()
    return
  }
  if (!selected.value) {
    errorMessage.value = '请先在搜索结果中点击选择一只股票'
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
    if (!rangeEnd.value) {
      errorMessage.value = '请选择范围结束日'
      return
    }
    if (rangeEnd.value < rangeStart.value) {
      errorMessage.value = '结束日不能早于起始日，请调整日期范围'
      return
    }
    if (previewing.value) {
      errorMessage.value = '范围校验生成中，请稍候再点击「开始训练」'
      return
    }
    const request = currentRangeRequest()
    // 校验必须创建前可见供审阅：无匹配当前输入的校验时先生成并停下让用户确认
    if (!hasMatchingPreview(request)) {
      const ok = await generateRangePreview()
      if (!ok) {
        errorMessage.value = errorMessage.value || '范围校验失败，请重试'
        return
      }
      errorMessage.value = '已生成范围校验，请核对下方信息后再次点击「开始训练」'
      return
    }
    submitting.value = true
    try {
      const preview = rangePreview.value!.preview
      const params = {
        code: selected.value.code,
        initial_cash: cash,
        adjust_mode: adjustMode.value,
        clock_mode: clockMode.value,
        orders_enabled: ordersEnabled.value,
        range: request,
        previewId: preview.previewId,
      }
      await createTraining(params)
      emit('created', { enabled: recordingEnabled.value, params: { ...params, start_date: preview.startDate } })
    } catch (error) {
      if (error instanceof Error && /409|RANGE_PREVIEW_STALE|过期|预览/.test(error.message)) {
        onRangeInputChanged() // TTL/409：旧校验失效，自动重新生成
        schedulePreviewGeneration()
        errorMessage.value = '范围校验已失效，请核对下方最新校验信息后再次点击「开始训练」'
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
      clock_mode: clockMode.value,
      orders_enabled: ordersEnabled.value,
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

// ===== M7-02 随机模式创建：POST /api/trainings/random（契约=M7-01 design.md §2.1；RF-04/RF2-01 增档位） =====
// 载荷按维度组装：random_stock=window_months（档位：窗口＝最近 N 个自然月）或 start_date+end_date
// （自定义范围档，旧口径）；random_time=code+window_months（档位）或 window_bars（自定义根数）；
// random_both=window_months/window_bars（不带 code/起止日）；其余字段与经典同语义。
async function performRandomCreate(): Promise<void> {
  const cash = Number(initialCash.value)
  if (!Number.isFinite(cash) || cash <= 0) {
    errorMessage.value = '初始资金必须是正数（默认 1,000,000）'
    return
  }
  const params: RandomTrainingRequest = {
    dimension: randomDimension.value,
    initial_cash: cash,
    adjust_mode: adjustMode.value,
    clock_mode: clockMode.value,
    orders_enabled: ordersEnabled.value,
  }
  if (randomDimension.value === 'random_stock') {
    // RF2-01：档位网格默认路径发 window_months（窗口＝最近 N 个自然月，服务端以数据末日为锚）；
    // 「自定义范围」档发旧 start_date/end_date（起止日期口径保留）
    if (randomTier.value === 'RANGE') {
      if (!rangeStart.value) {
        errorMessage.value = '请选择范围起始日'
        return
      }
      if (!rangeEnd.value) {
        errorMessage.value = '请选择范围结束日'
        return
      }
      if (rangeEnd.value < rangeStart.value) {
        errorMessage.value = '结束日不能早于起始日，请调整日期范围'
        return
      }
      params.start_date = rangeStart.value
      params.end_date = rangeEnd.value
    } else if (randomTier.value !== 'WINDOW_BARS') {
      params.window_months = TIER_MONTHS[randomTier.value]
    }
  }
  if (randomDimension.value === 'random_time') {
    if (!selected.value) {
      errorMessage.value = '请先在搜索结果中点击选择一只股票'
      return
    }
    params.code = selected.value.code
  }
  if (randomDimension.value !== 'random_stock') {
    // RF-04：档位网格默认路径发 window_months（经典同口径月跨度）；「自定义根数」档发旧 window_bars
    if (randomTier.value === 'WINDOW_BARS') {
      const window = Math.floor(Number(windowBars.value))
      if (!Number.isSafeInteger(window) || window < 20 || window > 2000) {
        errorMessage.value = '训练窗口长度需为 20–2000 的整数（默认 250）'
        return
      }
      params.window_bars = window
    } else if (randomTier.value !== 'RANGE') {
      // 类型收窄防御：RANGE 档经 onDimensionClick 归一不会出现在 time/both 维度
      params.window_months = TIER_MONTHS[randomTier.value]
    }
  }
  submitting.value = true
  try {
    await createRandomTraining(params)
    // 录像 createdParams 是不透明 JSON 袋（经典分支同样以字面量整包透传），此处显式 widening
    emit('created', { enabled: recordingEnabled.value, params: params as unknown as Record<string, string | number | boolean | TrainingRangeRequest> })
  } catch (error) {
    errorMessage.value = randomCreateErrorMessage(error)
  } finally {
    submitting.value = false
  }
}

/** 两类 422 映射为人话提示（M7-02 简报决策 3，文案 proposed_default）；其余错误原样呈现服务端 message */
function randomCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RANDOM_WINDOW_NOT_FIT') return '该股票数据不足以容纳所选窗口，请缩短窗口或换股票'
    if (error.code === 'RANDOM_STOCK_UNIVERSE_EMPTY') return '本地数据中没有满足窗口的股票，请缩短窗口或更新数据'
  }
  return error instanceof Error ? error.message : '创建失败'
}
</script>

<template>
  <div class="launcher">
    <header class="launcher-head">
      <h1>创建训练</h1>
      <p>{{ mode === 'random'
        ? '服务器随机选股或随机选时段，训练中隐藏对应信息，结算后揭晓。创建后复权方式锁定，训练中不可切换。'
        : '选一只股票、一个周期档和一个起始日，从起始日向前盲走训练。创建后复权方式锁定，训练中不可切换。' }}</p>
    </header>

    <!-- M7-02 模式标签：经典模式（原表单）｜随机模式（复用同一面板，按维度显隐） -->
    <div class="mode-tabs" role="tablist" aria-label="训练模式">
      <button role="tab" :aria-selected="mode === 'classic'" :class="{ selected: mode === 'classic' }" @click="setMode('classic')">经典模式</button>
      <button role="tab" :aria-selected="mode === 'random'" :class="{ selected: mode === 'random' }" @click="setMode('random')">随机模式</button>
    </div>

    <section class="launcher-form">
      <div v-if="showStockPicker" class="form-field wide stock-field">
        <label>股票</label>
        <div class="stock-input-row">
          <input v-model="codeText" placeholder="股票代码，如 600519" aria-label="股票代码" @input="onCodeInput" />
          <input v-model="nameText" placeholder="股票名称，如 贵州茅台（可用拼音首字母 GZMT）" aria-label="股票名称" @input="onNameInput" />
          <div v-if="suggestions.length" class="suggestions">
            <button v-for="stock in suggestions" :key="stock.code" @click="choose(stock)">
              <strong>{{ stock.code }}</strong><span>{{ stock.name }}</span><small>{{ stock.market.toUpperCase() }}</small>
            </button>
          </div>
        </div>
        <small v-if="searching" class="form-hint" role="status">正在检索股票…</small>
        <small v-if="matchHint" class="form-hint">{{ matchHint }}</small>
        <small v-if="selected" class="form-hint">已选：{{ selected.name }}（{{ selected.code }}，数据截至 {{ selected.lastDate ?? 'N/A' }}）；重新选择请清空任一框</small>
        <small v-else-if="suggestions.length" class="form-hint">请点击下方检索结果确认股票</small>
      </div>

      <!-- 随机维度三选一（仅随机模式；选项文案 proposed_default，见 M7-02 design.md §三） -->
      <div v-if="mode === 'random'" class="form-field wide">
        <label>随机维度</label>
        <div class="tier-grid" role="group" aria-label="随机维度">
          <button v-for="item in RANDOM_DIMENSIONS" :key="item.value" :class="{ selected: randomDimension === item.value }" @click="onDimensionClick(item.value)">{{ item.label }}</button>
        </div>
        <small class="form-hint">{{ dimensionHint }}</small>
      </div>

      <div v-if="mode === 'classic'" class="form-field">
        <label>训练周期</label>
        <div class="tier-grid">
          <button v-for="item in tiers" :key="item.value" :class="{ selected: tier === item.value }" @click="onTierClick(item.value)">{{ item.label }}</button>
        </div>
      </div>

      <div v-if="showPresetStart || showRangeDates" class="form-row">
        <div class="form-field">
          <label>起始日</label>
          <input v-if="showPresetStart" v-model="startDate" type="date" @input="startDateTouched = true" />
          <input v-else v-model="rangeStart" type="date" @input="mode === 'classic' ? onRangeInputChanged() : (errorMessage = '')" />
          <small v-if="showPresetStart" class="form-hint">选择周期后自动从最新数据日回退对应时长；手动修改保留到下次切换周期。起始日之前最多 840 根 K 线同屏显示</small>
          <small v-else class="form-hint">{{ mode === 'classic' ? '自定义起始日；默认从最新数据日回退 3 个自然月（月末自动对齐）' : '随机股票在此时间段内由服务器选取；起始日自动对齐到前方最近的交易日' }}</small>
        </div>
        <div v-if="showPresetStart" class="form-field">
          <label>初始资金</label>
          <input v-model.number="initialCash" type="number" min="10000" step="10000" @input="initialCashDirty = true" />
        </div>
        <div v-else class="form-field">
          <label>结束日</label>
          <input v-model="rangeEnd" type="date" @input="mode === 'classic' ? onRangeInputChanged() : (errorMessage = '')" />
          <small class="form-hint">{{ mode === 'classic' ? '包含起止日期之间可用的交易日；不能选择未来日期' : '数据需覆盖到结束日；窗口内至少包含 2 个交易日' }}</small>
        </div>
      </div>

      <!-- RF-04/RF2-01 随机训练周期（三种随机维度）：复用经典五档网格（同文案同月数口径）；
           random_time/random_both 加自定义根数档，random_stock 加自定义范围档（起止日期旧口径） -->
      <div v-if="showRandomPeriod" class="form-field">
        <label>训练周期</label>
        <div class="tier-grid">
          <button v-for="item in activeRandomPeriodOptions" :key="item.value" :class="{ selected: randomTier === item.value }" @click="onRandomTierClick(item.value)">{{ item.label }}</button>
        </div>
        <small class="form-hint">{{ randomPeriodHint }}</small>
      </div>

      <!-- 训练窗口长度（仅随机「自定义根数」档；默认 250，范围 20–2000） -->
      <div v-if="showWindowBars" class="form-field">
        <label>训练窗口长度（交易日）</label>
        <input v-model.number="windowBars" type="number" min="20" max="2000" step="10" aria-label="训练窗口长度（交易日）" />
        <small class="form-hint">默认 250，范围 20–2000；需保证所选股票（或本地数据）历史足够长</small>
      </div>

      <div v-if="!showPresetStart" class="form-field">
        <label>初始资金</label>
        <input v-model.number="initialCash" type="number" min="10000" step="10000" @input="initialCashDirty = true" />
      </div>

      <div v-if="mode === 'classic' && tier === 'RANGE'" class="form-field wide">
        <div v-if="clampNotice" class="form-hint clamp-notice">{{ clampNotice }}</div>
        <div v-if="rangePreview" class="form-hint">
          <strong>范围校验</strong>：请求 {{ rangePreview.request.startDate }} ~ {{ rangePreview.request.endDate }}；
          实际 {{ rangePreview.preview.startDate }} ~ {{ rangePreview.preview.endDate }}，共 {{ rangePreview.preview.barCount }} 根日线
          <span v-if="rangePreview.preview.notes.length">；{{ rangePreview.preview.notes.join('；') }}</span>
        </div>
        <div v-else-if="previewing" class="form-hint">范围校验生成中…</div>
      </div>

      <!-- 经典双盲遮蔽已从 V1 移除（股票由用户手动选定，隐藏名称无意义）；
           随机隐藏已由 M7 随机模式承接（服务端 API 级隐藏，见 POST /api/trainings/random） -->
      <div class="form-field">
        <label>复权方式（创建后锁定）</label>
        <div class="tier-grid">
          <button :class="{ selected: adjustMode === 'forward' }" @click="markAdjustMode('forward')">前复权</button>
          <button :class="{ selected: adjustMode === 'raw' }" @click="markAdjustMode('raw')">不复权</button>
        </div>
      </div>

      <div class="form-field">
        <label>训练时钟</label>
        <div class="tier-grid">
          <button :class="{ selected: clockMode === 'close_only' }" @click="clockMode = 'close_only'">仅收盘</button>
          <button :class="{ selected: clockMode === 'open_close' }" @click="clockMode = 'open_close'">开盘 + 收盘</button>
        </div>
        <small class="form-hint">开盘 + 收盘会把每个交易日拆成两个阶段；阶段和成交价在创建后锁定。</small>
      </div>
      <label class="recording-choice"><input v-model="ordersEnabled" type="checkbox" />启用条件单</label>
      <small v-if="ordersEnabled" class="form-hint">本局最多一个待触发条件单，支持限价/止损，按日线 OHLC 近似撮合。</small>

      <label class="recording-choice"><input v-model="recordingEnabled" type="checkbox" aria-label="记录操作" />记录操作</label>
      <small class="form-hint">建议保持开启，方便复盘、分享操作和排查问题。记录保存在本机浏览器，可随时暂停。</small>
      <p v-if="customNotice" class="form-hint" role="status">{{ customNotice }}</p>
      <p v-if="defaultsState === 'error'" class="error-text" role="alert">
        {{ defaultsError || '无法读取训练默认设置' }}
        <button class="ghost-button" @click="retryDefaults">重试读取</button>
      </p>
      <p v-if="defaultsState === 'loading'" class="form-hint">正在读取训练默认设置…</p>
      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      <button class="submit-button" :disabled="submitting || defaultsState !== 'ready'" :title="defaultsState !== 'ready' ? '训练默认设置读取完成后可开始训练' : ''" @click="submit">{{ submitting ? '创建中…' : '开始训练' }}</button>
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

<style scoped>
/* M7-02 模式标签：沿用训练页 timeframe-tabs 的下划线风格（双主题） */
.mode-tabs { display: flex; gap: 4px; margin-bottom: 10px; border-bottom: 1px solid var(--surface-border, #dfe5eb); }
.mode-tabs button { border: 0; background: transparent; padding: 7px 16px; font-size: 14px; color: var(--text-secondary, #77869a); border-bottom: 2px solid transparent; cursor: pointer; }
.mode-tabs button.selected { color: #245a72; border-bottom-color: #2e8191; font-weight: 600; }
.mode-tabs button:focus-visible { outline: 2px solid #2e8191; outline-offset: -2px; }
:global(body.dark) .mode-tabs button.selected { color: #ffffff; border-bottom-color: #c4c4c4; }
</style>
