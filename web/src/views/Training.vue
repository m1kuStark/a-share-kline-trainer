<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import { theme } from '../theme'
import { useRecording } from '../recording/useRecording'
import type { ChartCapture } from '../recording/types'
import KlineChart from '../components/KlineChart.vue'
import {
  abandonTraining, advanceTraining, cancelTrainingOrder, fetchTrainingBars, orderTriggerDirection, placeTrainingOrder, retrainTraining, settleTraining, tradeTraining, fetchDrawings, saveDrawings,
  type Bar, type OrderView, type Tier, type Timeframe, type TrainingSnapshot,
} from '../api'
import { DRAW_TOOLS } from '../drawTools'
import { SerialDrawingSaver, type Drawing } from '../drawingState'
import { DrawingOutbox } from '../drawingOutbox'
import type { DrawingPriceBasis } from '../drawingPriceBasis'
import { nextTimeframe, MAX_VISIBLE_BARS } from '../chartNavigation'
import { appMaSettings, maWarmup } from '../maSettings'
import { DEFAULT_FAVORITE_TOOLS, loadFavoriteTools, moveFavoriteTool, saveFavoriteTools } from '../toolFavorites'
import {
  KEYBOARD_SHORTCUTS_CHANGED_EVENT, loadKeyboardShortcuts, matchesActionShortcut,
  saveKeyboardShortcuts, shortcutId, type KeyboardShortcutPreferences, type ShortcutAction,
} from '../keyboardShortcuts'
import { fetchKeyboardShortcuts, appKdjSubchart, appVolSubchart, appMacdSubchart, setKdjSubchart, setVolSubchart, setMacdSubchart, appOdoMotion } from '../appSettings'
import { trainingSettingsOpen } from '../settingsPanel'
import { previousDailyClose } from '../phasePrice'
import { createRollCounter, formatEquity, formatReturnPct, rollDisplayEquity } from '../odometer'
import { dataOutcomeSeq, dataRefreshError, dataRefreshMessage, dataRefreshOutcome, dataStatus, dataUpdating, refreshDataNow } from '../dataStatus'
import { Undo2, Redo2, Trash2, ChevronDown, ChevronUp, Settings2, Check, RotateCcw, GripVertical, Plus, Minus, ArrowLeft, ArrowRight, Info, StepForward, RefreshCw, SkipForward } from 'lucide-vue-next'

const props = defineProps<{ snapshot: TrainingSnapshot; recordingOptions?: { enabled: boolean; params?: Record<string, unknown> } }>()
const emit = defineEmits<{ ended: []; 'open-history': []; retrained: [TrainingSnapshot] }>()

const snapshot = ref<TrainingSnapshot>(props.snapshot)
const bars = ref<Bar[]>([])
// Recording always uses daily bars observed at this exact advance date. A weekly
// or monthly viewing choice must not make the shared recording lose daily detail.
const dailyForRecording = shallowRef<{ date: string | null; bars: Bar[] } | null>(null)
const hasMoreBars = ref(true)
const tf = ref<Timeframe>('1D')
const chartCostPrice = ref<number | null>(null)
const drawingPriceBasis = ref<DrawingPriceBasis | null>(null)
const loading = ref(false)
const message = ref(props.snapshot.training.status === 'running' ? '训练就绪' : '已结束')
const errorMessage = ref('')
const visibleCount = ref(150)
const chartViewport = ref<{ visibleDate: string | null; latestDate: string | null; atLatest: boolean }>({ visibleDate: null, latestDate: null, atLatest: true })
const weight = ref(50)
const customWeight = ref<number | null>(null)
const customShares = ref<number | null>(null)
const orderTab = ref<'normal' | 'conditional'>('normal')
const orderSide = ref<'buy' | 'sell'>('buy')
const orderType = ref<'limit' | 'stop'>('limit')
const orderTrigger = ref<number | null>(null)
const orderReason = ref('')
const orderError = ref('')
const chartRef = ref<InstanceType<typeof KlineChart> | null>(null)
const settledView = ref<TrainingSnapshot | null>(null)
const endAction = ref<'settle' | 'abandon' | null>(null)
const keepRecording = ref(true)
const finishingSession = ref(false)
const endError = ref('')
// 画线模式状态：null＝默认模式；非 null＝画线模式（控制台工具条点击切换，Esc 退出）
const drawTool = ref<string | null>(null)
const toolbarCollapsed = ref(false)
const customizingTools = ref(false)
const otherToolsExpanded = ref(false)
const favoriteToolNames = ref(loadFavoriteTools(localStorage))
const favoriteTools = computed(() => favoriteToolNames.value.flatMap(name => DRAW_TOOLS.find(tool => tool.name === name) ?? []))
const otherTools = computed(() => DRAW_TOOLS.filter(tool => !favoriteToolNames.value.includes(tool.name)))
const favoriteStorageError = ref(false)
const draggedTool = ref<string | null>(null)
const toolDropTarget = ref<{ list: 'favorites' | 'other'; index: number } | null>(null)
const keyboardShortcuts = ref<KeyboardShortcutPreferences>(loadKeyboardShortcuts(localStorage))
const pressedShortcutKeys = new Set<string>()
void fetchKeyboardShortcuts().then(view => {
  keyboardShortcuts.value = view.shortcuts
  saveKeyboardShortcuts(localStorage, view.shortcuts)
}).catch(() => { /* 首屏服务端不可用时继续使用本机缓存 */ })
// 多选模式：框选拖拽变为划线批量选中（与画线取点模式互斥）
const multiSelectMode = ref(false)
const magnet = ref<'normal' | 'weak_magnet' | 'strong_magnet'>('weak_magnet')
const allDrawings = ref<Drawing[] | null>(null)
const initialDrawings = ref<Drawing[] | null>(null)
const historyState = ref({ undo: false, redo: false })
const textPanelOpen = ref(false)
const drawingSaveStatus = ref('载入画线')
const drawingLoadError = ref(false)
const drawingSaveError = ref('')
const legacyDrawingNotice = ref('')
let pendingDrawings: Drawing[] | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let drawingRevision = 0
let closing = false
const drawingTrainingId = props.snapshot.training.id
const recording = useRecording({
  snapshot: () => snapshot.value,
  ui: () => ({ theme: theme.value, tool: drawTool.value, magnet: magnet.value, multiSelect: multiSelectMode.value }),
  enabled: props.recordingOptions?.enabled ?? true,
  createdParams: props.recordingOptions?.params,
  ready: () => !loading.value && initialDrawings.value !== null,
  readChart: () => chartRef.value?.captureState() ?? null,
  canonicalChart: canonicalRecordingChart,
})
function canonicalRecordingChart(): ChartCapture | null {
  if (loading.value || initialDrawings.value === null) return null
  const capture = chartRef.value?.captureState()
  const daily = dailyForRecording.value
  if (!capture || !daily || daily.date !== snapshot.value.training.currentDate) return null
  const source = tf.value === '1D' ? capture.bars : daily.bars
  if (!source.length) return null
  const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`)
  return { ...capture, timeframe: '1D', bars: source,
    // Replay owns its viewport, so viewing gestures do not become timeline noise.
    view: { fromTimestamp: timestamp(source[Math.max(0, source.length - 150)].date), toTimestamp: timestamp(source[source.length - 1].date), barSpace: 6, paneHeights: {} } }
}
const preparingRecording = computed(() => !recording.ready.value && !recording.error.value)
async function captureRecording(): Promise<void> {
  await nextTick()
  try {
    const capture = chartRef.value?.captureState()
    if (capture) recording.capture(capture)
  } catch (error) { recording.fail(error) }
}
watch(theme, value => { const op = recording.begin('ui.theme', { theme: value }); recording.finish(op, 'accepted') })
const outbox = new DrawingOutbox(localStorage, `trainer.drawings.${drawingTrainingId}.${props.snapshot.training.createdAt}`)
const saver = new SerialDrawingSaver(items => saveDrawings(drawingTrainingId, items, closing && new TextEncoder().encode(JSON.stringify(items)).length < 60_000))
async function loadDrawings(): Promise<void> {
  drawingLoadError.value = false
  drawingSaveError.value = ''
  try {
    const remote = (await fetchDrawings(drawingTrainingId)).drawings
    const recovered = outbox.read()
    const normalized = (recovered ?? remote).map(item => ({ ...item, timeframe: item.timeframe ?? '1D' as const }))
    allDrawings.value = normalized
    initialDrawings.value = normalized.filter(item => item.timeframe === tf.value)
    legacyDrawingNotice.value = initialDrawings.value.some(item => item.paneId === 'candle_pane' && !item.priceBasis)
      ? '旧画线缺少创建时的复权基准，已保留原价；历史偏移未自动修正。' : ''
    drawingSaveStatus.value = '已保存'
    if (recovered) onDrawingsChange(recovered)
    await captureRecording()
  } catch (error) {
    drawingLoadError.value = true
    drawingSaveStatus.value = '画线加载失败'
    drawingSaveError.value = error instanceof Error ? error.message : '无法读取画线'
  }
}
function onDrawingsChange(items: Drawing[]): void {
  const next = items.map(item => ({ ...item, timeframe: item.timeframe ?? tf.value }))
  const existing = allDrawings.value ?? []
  const otherPeriods = existing.filter(item => (item.timeframe ?? '1D') !== tf.value)
  allDrawings.value = [...otherPeriods, ...next]
  initialDrawings.value = next
  pendingDrawings = allDrawings.value
  drawingRevision++
  drawingSaveStatus.value = '待保存'
  try { outbox.write(allDrawings.value) } catch { drawingSaveStatus.value = '本地备份失败' }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void flushDrawings() }, 1200)
}
async function flushDrawings(): Promise<boolean> {
  clearTimeout(saveTimer)
  if (!pendingDrawings || initialDrawings.value === null) return true
  const items = pendingDrawings
  const revision = drawingRevision
  drawingSaveStatus.value = '保存中'
  drawingSaveError.value = ''
  const recordingOp = recording.begin('drawings.save', { revision, count: items.length })
  try {
    await saver.save(items)
    outbox.acknowledge(items)
    if (revision === drawingRevision) { pendingDrawings = null; drawingSaveStatus.value = '已保存' }
    recording.finish(recordingOp, 'accepted')
    return true
  } catch (error) {
    recording.rejected(recordingOp, error)
    drawingSaveStatus.value = '保存失败'
    drawingSaveError.value = error instanceof Error ? error.message : '无法连接本地服务'
    return false
  }
}
function flushOnPageHide(): void { closing = true; void flushDrawings() }
function flushOnHidden(): void { if (document.visibilityState === 'hidden') void flushDrawings() }
window.addEventListener('pagehide', flushOnPageHide)
document.addEventListener('visibilitychange', flushOnHidden)
onUnmounted(() => {
  clearTimeout(saveTimer)
  void flushDrawings()
  window.removeEventListener('pagehide', flushOnPageHide)
  document.removeEventListener('visibilitychange', flushOnHidden)
})
void loadDrawings()
function toggleMultiSelectMode(): void {
  multiSelectMode.value = !multiSelectMode.value
  if (multiSelectMode.value) drawTool.value = null
}
watch(drawTool, tool => { if (tool) multiSelectMode.value = false })

function updateFavoriteTools(names: string[]): void {
  favoriteToolNames.value = names
  favoriteStorageError.value = !saveFavoriteTools(localStorage, names)
}
function toggleToolCustomization(): void {
  customizingTools.value = !customizingTools.value
  draggedTool.value = null
  toolDropTarget.value = null
  if (customizingTools.value) {
    toolbarCollapsed.value = false
    drawTool.value = null
    multiSelectMode.value = false
    chartRef.value?.clearMultiSelection()
  }
}
function shiftFavoriteTool(name: string, offset: number): void {
  updateFavoriteTools(moveFavoriteTool(favoriteToolNames.value, name, favoriteToolNames.value.indexOf(name) + offset))
}
function startToolDrag(event: DragEvent, name: string): void {
  if (!customizingTools.value || !event.dataTransfer) { event.preventDefault(); return }
  draggedTool.value = name
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', name)
}
function endToolDrag(): void {
  draggedTool.value = null
  toolDropTarget.value = null
}
function dragOverTools(event: DragEvent, list: 'favorites' | 'other', index?: number): void {
  if (!customizingTools.value || !draggedTool.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  let position = index ?? favoriteToolNames.value.length
  if (index !== undefined) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    if (event.clientX > rect.left + rect.width / 2) position++
  }
  toolDropTarget.value = { list, index: position }
}
function dropTool(event: DragEvent): void {
  event.preventDefault()
  const name = draggedTool.value
  const target = toolDropTarget.value
  if (customizingTools.value && name && target) {
    const oldIndex = favoriteToolNames.value.indexOf(name)
    const insertionIndex = target.index - (oldIndex >= 0 && oldIndex < target.index ? 1 : 0)
    updateFavoriteTools(moveFavoriteTool(favoriteToolNames.value, name, target.list === 'other' ? null : insertionIndex))
  }
  endToolDrag()
}
function onToolbarKeydown(event: KeyboardEvent): void {
  if (customizingTools.value) {
    if (event.key === 'Escape') { event.preventDefault(); toggleToolCustomization() }
    event.stopPropagation()
  }
}

const training = computed(() => snapshot.value.training)
// 周/月观察也使用本轮已截断的日线前收，避免聚合周期改变阶段线涨跌颜色。
const previousClose = computed(() => previousDailyClose(dailyForRecording.value?.bars ?? [], training.value.currentPhase ?? 'close'))
const account = computed(() => snapshot.value.account)
const returnPct = computed(() => ((account.value.equity - training.value.initialCash) / training.value.initialCash) * 100)

// ===== M6-05 账户权益/收益率 Odometer 数字滚动 =====
// 架构：真实文本节点（.odo-text）始终写终值——任何时刻读取＝精确账面值，既有/未来文本断言
// 不被动画破坏；动画是纯视觉层（.odo-roll，aria-hidden）：rAF 采样纯模块 odometer.ts 的缓动值
// 逐帧渲染，每位数字是 0-9 竖排条带的 translateY（CSS 过渡衔接帧间步进＝竖直滚动观感）。
// 连续快速推进＝中断重定向（counter 只持一条计划，从当前显示值续滚最新目标，不排队不重放）；
// 终帧后延迟 ODO_SETTLE_MS（> 条带过渡 80ms）再卸视觉层，条带滚到位才切回真实文本，无错位闪烁。
// 应用动效偏好关闭（trainer_odo_motion='0'）＝不播动画直显终值。M6-05R：OS prefers-reduced-motion
// 不再一票否决——用户唯一真实环境该信号恒为 true，一票否决＝用户明确要求的核心反馈全程不可见
// （2026-10-05 验收反馈"完整训练从未见过数字滚动"）；a11y 逃生阀改为应用开关（默认开，幅度 ≤600ms）。
interface OdoColumn { char: string; digit: number | null }
const equityRoll = ref<Array<OdoColumn> | null>(null)
const returnRoll = ref<Array<OdoColumn> | null>(null)
const equityCounter = createRollCounter(account.value.equity)
const returnCounter = createRollCounter(returnPct.value)
// 滚动量纲（时长与幅度成比例且封顶）：权益按 1% 相对幅度到封顶；收益率按 5 个百分点到封顶
const EQUITY_ROLL_REFERENCE_RATIO = 0.01
const RETURN_ROLL_REFERENCE_PP = 5
const ODO_SETTLE_MS = 120
function odoColumns(text: string): Array<OdoColumn> {
  return [...text].map(char => ({ char, digit: char >= '0' && char <= '9' ? Number(char) : null }))
}
let rollFrame = 0
let equitySettleTimer = 0
let returnSettleTimer = 0
function settleEquityRoll(now: number): void {
  equityRoll.value = odoColumns(formatEquity(equityCounter.displayed(now)))
  equitySettleTimer = window.setTimeout(() => { equitySettleTimer = 0; equityRoll.value = null }, ODO_SETTLE_MS)
}
function settleReturnRoll(now: number): void {
  returnRoll.value = odoColumns(formatReturnPct(returnCounter.displayed(now)))
  returnSettleTimer = window.setTimeout(() => { returnSettleTimer = 0; returnRoll.value = null }, ODO_SETTLE_MS)
}
function pumpRoll(): void {
  if (rollFrame) return
  const step = (): void => {
    rollFrame = 0
    const now = performance.now()
    let active = false
    // M6-06 权益滚动帧先取整（rollDisplayEquity）：中间浮点直接走终值格式会带幻影小数；
    // 收益率帧保持 formatReturnPct（两位小数，与终值一致）
    if (equityCounter.rolling(now)) { equityRoll.value = odoColumns(rollDisplayEquity(equityCounter.displayed(now))); active = true }
    else if (equityRoll.value && !equitySettleTimer) settleEquityRoll(now)
    if (returnCounter.rolling(now)) { returnRoll.value = odoColumns(formatReturnPct(returnCounter.displayed(now))); active = true }
    else if (returnRoll.value && !returnSettleTimer) settleReturnRoll(now)
    if (active) rollFrame = requestAnimationFrame(step)
  }
  rollFrame = requestAnimationFrame(step)
}
interface RollBinding {
  counter: ReturnType<typeof createRollCounter>
  roll: Ref<Array<OdoColumn> | null>
  format(value: number): string
  reference(value: number, previous: number): number
  cancelSettle(): void
}
const equityBinding: RollBinding = {
  // M6-06：初帧（打断时刻显示值＝中间值）同走取整口径，与逐帧滚动层一致（无幻影小数）
  counter: equityCounter, roll: equityRoll, format: rollDisplayEquity,
  reference: (value, previous) => Math.max(Math.abs(previous), Math.abs(value), 1) * EQUITY_ROLL_REFERENCE_RATIO,
  cancelSettle: () => { clearTimeout(equitySettleTimer); equitySettleTimer = 0 },
}
const returnBinding: RollBinding = {
  counter: returnCounter, roll: returnRoll, format: formatReturnPct,
  reference: () => RETURN_ROLL_REFERENCE_PP,
  cancelSettle: () => { clearTimeout(returnSettleTimer); returnSettleTimer = 0 },
}
function beginRoll(binding: RollBinding, value: number, previous: number): void {
  if (!appOdoMotion.value) { binding.roll.value = null; return }
  binding.cancelSettle()
  binding.counter.setTarget(value, performance.now(), binding.reference(value, previous))
  // 初始视觉层＝打断时刻的显示值（与真实文本同帧切换，不闪终值）
  binding.roll.value = odoColumns(binding.format(binding.counter.displayed(performance.now())))
  pumpRoll()
}
watch(() => account.value.equity, (value, previous) => {
  if (value === previous) return
  beginRoll(equityBinding, value, previous)
})
watch(returnPct, (value, previous) => {
  if (value === previous) return
  beginRoll(returnBinding, value, previous)
})
onUnmounted(() => { cancelAnimationFrame(rollFrame); rollFrame = 0; clearTimeout(equitySettleTimer); clearTimeout(returnSettleTimer) })
// TRAIN-01：legacy raw 训练成绩未经验证，运行中禁止交易/推进/结算（服务端同样 409 兜底）
const legacyRawLocked = computed(() =>
  training.value.rules?.corporateActionPolicy === 'legacy-raw-unverified' && training.value.status === 'running')
const rulesSummary = computed(() => {
  const rules = training.value.rules
  if (!rules) return ''
  return `费用 ${rules.feesEnabled ? '开' : '关'} · T+1 ${rules.tPlusOne ? '开' : '关'}（本局冻结）`
})
const isTyping = (event: KeyboardEvent) => event.isComposing || !!(event.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]')
const tierLabel = computed(() => {
  if (training.value.tier === 'RANGE') {
    const range = training.value.range
    if (range?.mode === 'random') return `随机窗口 ${range.barCount} 根`
    return range ? `自定义范围 ${range.startDate} ~ ${range.endDate}` : '自定义范围'
  }
  return ({ '1M': '1个月', '3M': '3个月', '6M': '6个月', '1Y': '1年', '2Y': '2年' }[training.value.tier as Tier] ?? training.value.tier)
})
// ===== M7-02 随机模式遮蔽呈现：hideStock 会话标题显示占位（文案 proposed_default）＋随机模式徽标；
// 日期字段按服务端偏移后数据原样呈现（前端不做二次变换）；结束态服务端不再下发 random 字段，
// 徽标自然退场、真实名称顶上（揭晓）。经典标题组合式保持在模板内联（frontend-contract 源码契约）。 =====
const maskedStock = computed(() => training.value.random?.hideStock === true)
const randomDimensionLabel = computed(() => {
  const dimension = training.value.random?.dimension
  return dimension === 'random_stock' ? '随机股票' : dimension === 'random_time' ? '随机时段' : dimension === 'random_both' ? '全随机' : ''
})
const statusText = computed(() => {
  if (multiSelectMode.value) return '多选模式'
  if (!drawTool.value) return message.value
  const label = DRAW_TOOLS.find(tool => tool.name === drawTool.value)?.label ?? drawTool.value
  return `画线模式：${label}`
})

let loadVersion = 0
async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  const timeframe = tf.value
  loading.value = true
  errorMessage.value = ''
  const recordingOp = recording.begin('chart.load', { timeframe })
  try {
    const [payload, daily] = await Promise.all([
      fetchTrainingBars(training.value.id, timeframe, { warmup: maWarmup(appMaSettings.value) }),
      timeframe === '1D' ? Promise.resolve(null) : fetchTrainingBars(training.value.id, '1D'),
    ])
    if (requestVersion !== loadVersion) { recording.finish(recordingOp, 'cancelled', { reason: '已被新请求替代' }); return }
    const canonical = daily ?? payload
    if (canonical.training.currentDate !== payload.training.currentDate) throw new Error('训练日期已改变，请刷新图表后继续录制')
    dailyForRecording.value = { date: canonical.training.currentDate, bars: canonical.bars }
    snapshot.value = { training: payload.training, account: payload.account, trades: payload.trades, orders: payload.orders ?? [] }
    drawingPriceBasis.value = payload.drawingPriceBasis ?? null
    bars.value = payload.bars
    chartCostPrice.value = payload.chartCostPrice ?? null
    hasMoreBars.value = payload.hasMore
    await nextTick()
    if (requestVersion !== loadVersion) { recording.finish(recordingOp, 'cancelled'); return }
    loading.value = false
    recording.finish(recordingOp, 'accepted', { timeframe, bars: payload.bars.length })
    await captureRecording()
  } catch (error) {
    recording.rejected(recordingOp, error)
    if (requestVersion !== loadVersion) return
    errorMessage.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    if (requestVersion === loadVersion) loading.value = false
  }
}

// 动态历史加载：视窗移动到已加载窗口之前时，向服务端分批取更早的 K 线（每批 300 根）
async function fetchEarlier(before: string, count: number): Promise<{ bars: Bar[]; hasMore: boolean }> {
  const payload = await fetchTrainingBars(training.value.id, tf.value, { before, count })
  return { bars: payload.bars, hasMore: payload.hasMore }
}

async function advance(): Promise<void> {
  if (loading.value || preparingRecording.value || training.value.status !== 'running') return
  loading.value = true
  errorMessage.value = ''
  const recordingOp = recording.begin('training.advance')
  try {
    const result = await advanceTraining(training.value.id)
    snapshot.value = result.snapshot
    chartCostPrice.value = result.snapshot.account.costPrice
    recording.finish(recordingOp, 'accepted', { settled: result.settled })
    await recording.refreshContext()
    if (result.settled) {
      settledView.value = result.snapshot
      setTrainingUrl()
      message.value = `已到期结算：结算日 ${snapshot.value.training.settleDate}`
    } else {
      // 消息只报当前阶段的成交价：开盘阶段报开盘价——当日收盘价尚未发生，报出来是未来数据泄露
      const openPhase = snapshot.value.training.clockMode === 'open_close' && snapshot.value.training.currentPhase === 'open'
      const priceText = result.bar ? (openPhase ? `开盘 ${result.bar.open.toFixed(2)}` : `收盘 ${result.bar.close.toFixed(2)}`) : '--'
      message.value = `推进至 ${snapshot.value.training.currentDate ?? '今日'}，${priceText}`
    }
    await load()
  } catch (error) {
    recording.rejected(recordingOp, error)
    errorMessage.value = error instanceof Error ? error.message : '推进失败'
  } finally {
    loading.value = false
  }
}

async function trade(side: 'buy' | 'sell'): Promise<void> {
  if (loading.value || preparingRecording.value || training.value.status !== 'running') return
  loading.value = true
  errorMessage.value = ''
  // 按股数买卖为买卖共用：显式股数优先，留空按比例（买入比例按总权益、卖出按可卖持仓）
  const payload = customShares.value
    ? { side, shares: customShares.value }
    : { side, weightPct: customWeight.value ?? weight.value }
  const recordingOp = recording.begin('training.trade', payload)
  try {
    const result = await tradeTraining(training.value.id, payload)
    snapshot.value = result.snapshot
    chartCostPrice.value = result.snapshot.account.costPrice
    recording.finish(recordingOp, 'accepted', { plan: result.plan })
    message.value = `${side === 'buy' ? '买入' : '卖出'}成交：${result.plan.shares} 股 @ ${result.plan.price.toFixed(2)}`
    customShares.value = null
    customWeight.value = null
    await load()
  } catch (error) {
    recording.rejected(recordingOp, error)
    errorMessage.value = error instanceof Error ? error.message : '交易失败'
  } finally {
    loading.value = false
  }
}

async function settle(): Promise<void> {
  if (loading.value || preparingRecording.value || training.value.status !== 'running') return
  loading.value = true
  const recordingOp = recording.begin('training.settle')
  try {
    const result = await settleTraining(training.value.id)
    snapshot.value = result
    recording.finish(recordingOp, 'accepted')
    settledView.value = result
    setTrainingUrl()
    message.value = `已提前结算：结算日 ${result.training.settleDate}`
    await load()
  } catch (error) {
    recording.rejected(recordingOp, error)
    errorMessage.value = error instanceof Error ? error.message : '结算失败'
  } finally {
    loading.value = false
  }
}

async function abandon(): Promise<void> {
  if (loading.value || preparingRecording.value || training.value.status !== 'running') return
  loading.value = true
  const recordingOp = recording.begin('training.abandon')
  try {
    await abandonTraining(training.value.id)
    snapshot.value = { ...snapshot.value, training: { ...snapshot.value.training, status: 'abandoned' } }
    recording.finish(recordingOp, 'accepted')
    await recording.flush()
  } catch (error) {
    recording.rejected(recordingOp, error)
    errorMessage.value = error instanceof Error ? error.message : '操作失败'
  } finally {
    loading.value = false
  }
}

function requestEnd(action: 'settle' | 'abandon'): void {
  if (loading.value || preparingRecording.value || training.value.status !== 'running') return
  keepRecording.value = true
  endError.value = ''
  endAction.value = action
}
async function confirmEnd(): Promise<void> {
  if (!endAction.value || finishingSession.value) return
  finishingSession.value = true
  endError.value = ''
  try {
    if (!await flushDrawings()) throw new Error(drawingSaveError.value || '请先重试保存画线')
    const action = endAction.value
    if (training.value.status === 'running') {
      if (action === 'settle') await settle()
      else await abandon()
    }
    if (training.value.status === 'running') throw new Error(errorMessage.value || '训练尚未结束，请重试')
    await recording.finishSession(keepRecording.value)
    endAction.value = null
    if (action === 'abandon') emit('ended')
  } catch (error) { endError.value = error instanceof Error ? error.message : String(error) }
  finally { finishingSession.value = false }
}
async function backToLauncher(): Promise<void> {
  if (finishingSession.value) return
  finishingSession.value = true
  endError.value = ''
  try {
    if (!await flushDrawings()) throw new Error(drawingSaveError.value || '请先重试保存画线')
    await recording.finishSession(keepRecording.value)
    emit('ended')
  } catch (error) { endError.value = error instanceof Error ? error.message : String(error) }
  finally { finishingSession.value = false }
}

async function placeOrder(): Promise<void> {
  if (!training.value.ordersEnabled || loading.value || orderTrigger.value === null) return
  loading.value = true; orderError.value = ''
  try {
    // 仓位控件与普通下单共享：显式股数优先；否则按比例折算——买入按触发价折算总权益，
    // 卖出按可卖持仓折算（折算不足一手时按一手下限提交，由服务端校验兜底拒绝）
    const weightPct = Math.min(100, Math.max(1, customWeight.value ?? weight.value))
    const shares = customShares.value ?? (orderSide.value === 'buy'
      ? Math.max(100, Math.floor((account.value.equity * weightPct / 100) / orderTrigger.value / 100) * 100)
      : Math.max(100, Math.floor((account.value.availableShares * weightPct / 100) / 100) * 100))
    const result = await placeTrainingOrder(training.value.id, { side: orderSide.value, order_type: orderType.value, trigger_price: orderTrigger.value, shares, reason: orderReason.value || undefined })
    snapshot.value = result.snapshot
    orderTrigger.value = null
    orderReason.value = ''
    customShares.value = null
    customWeight.value = null
  } catch (error) { orderError.value = error instanceof Error ? error.message : '挂单失败' }
  finally { loading.value = false }
}

async function cancelOrder(orderId: number): Promise<void> {
  if (loading.value) return
  loading.value = true; orderError.value = ''
  try { snapshot.value = (await cancelTrainingOrder(training.value.id, orderId)).snapshot }
  catch (error) { orderError.value = error instanceof Error ? error.message : '撤单失败' }
  finally { loading.value = false }
}
async function retrain(): Promise<void> {
  if (finishingSession.value || !settledView.value) return
  if (!window.confirm('重新训练将删除本轮成绩、交易和画线记录，是否继续？')) return
  finishingSession.value = true
  endError.value = ''
  try {
    if (!await flushDrawings()) throw new Error(drawingSaveError.value || '请先重试保存画线')
    await recording.finishSession(false)
    const result = await retrainTraining(settledView.value.training.id)
    const url = new URL(location.href)
    url.searchParams.set('training', String(result.training.id))
    history.replaceState(null, '', url)
    emit('retrained', result)
  } catch (error) { endError.value = error instanceof Error ? error.message : '重新训练失败，原记录仍保留' }
  finally { finishingSession.value = false }
}
async function prepareForLibrary(): Promise<boolean> {
  if (loading.value || preparingRecording.value || drawTool.value || textPanelOpen.value) return false
  if (!await flushDrawings()) return false
  await recording.flush()
  return !recording.error.value && !recording.status.value.error
}
defineExpose({ prepareForLibrary })
function setTrainingUrl(): void {
  const url = new URL(location.href)
  url.searchParams.set('training', String(drawingTrainingId))
  history.replaceState(null, '', url)
}

function isShortcut(action: ShortcutAction, event: KeyboardEvent, allowRepeat = false): boolean {
  const repeatable = allowRepeat || action === 'advance' || action === 'zoomIn' || action === 'zoomOut' || action === 'crosshairLeft' || action === 'crosshairRight'
  if (matchesActionShortcut(action, event, keyboardShortcuts.value, pressedShortcutKeys, repeatable)) return true
  // 保留旧版本的 Ctrl+Shift+Z 重做入口；用户替换默认 Ctrl+Y 后即由自定义映射完全接管。
  return action === 'redo' && keyboardShortcuts.value.redo.some(binding => shortcutId(binding) === 'Control+KeyY') &&
    event.code === 'KeyZ' && event.ctrlKey && event.shiftKey && !event.isComposing
}

function onKeydown(event: KeyboardEvent): void {
  if (event.code) pressedShortcutKeys.add(event.code)
  // 设置弹层打开期间完全隔离训练热键：不能从设置触发买卖/推进/画线
  if (trainingSettingsOpen.value) return
  if (preparingRecording.value || endAction.value || settledView.value || finishingSession.value) return
  if (customizingTools.value) {
    if (event.key === 'Escape') { event.preventDefault(); toggleToolCustomization() }
    if (['advance', 'buy', 'sell', 'zoomIn', 'zoomOut', 'crosshairLeft', 'crosshairRight', 'deleteDrawing', 'resetView'].some(action => isShortcut(action as ShortcutAction, event))) event.preventDefault()
    return
  }
  if (isTyping(event) || textPanelOpen.value) return
  const direction = isShortcut('timeframeNext', event) ? 1 : isShortcut('timeframePrev', event) ? -1 : 0
  if (direction && !drawTool.value) { event.preventDefault(); tf.value = nextTimeframe(tf.value, direction); return }
  if (isShortcut('undo', event) || isShortcut('redo', event)) {
    if (drawTool.value) { event.preventDefault(); return }
    event.preventDefault(); if (isShortcut('redo', event)) chartRef.value?.redoDrawing(); else chartRef.value?.undoDrawing(); return
  }
  if (multiSelectMode.value && event.key === 'Escape') { event.preventDefault(); multiSelectMode.value = false; chartRef.value?.clearMultiSelection(); return }
  if (drawTool.value) {
    if (event.key === 'Escape') { event.preventDefault(); drawTool.value = null; return }
    if (isShortcut('advance', event) || isShortcut('buy', event) || isShortcut('sell', event)) { event.preventDefault(); return }
  }
  if (isShortcut('advance', event)) { event.preventDefault(); void advance(); return }
  if (isShortcut('deleteDrawing', event)) { event.preventDefault(); chartRef.value?.deleteSelected(); return }
  if (isShortcut('buy', event)) { event.preventDefault(); void trade('buy'); return }
  if (isShortcut('sell', event)) { event.preventDefault(); void trade('sell'); return }
  if (isShortcut('zoomIn', event)) { event.preventDefault(); chartRef.value?.zoomBy(1 / 1.3); return }
  if (isShortcut('zoomOut', event)) { event.preventDefault(); chartRef.value?.zoomBy(1.3); return }
  if (isShortcut('crosshairLeft', event)) { event.preventDefault(); chartRef.value?.moveCrosshair(-1); return }
  if (isShortcut('crosshairRight', event)) { event.preventDefault(); chartRef.value?.moveCrosshair(1); return }
  if (isShortcut('resetView', event)) { event.preventDefault(); chartRef.value?.resetView() }
}

window.addEventListener('keydown', onKeydown)
function onKeyup(event: KeyboardEvent): void { if (event.code) pressedShortcutKeys.delete(event.code) }
function onWindowBlur(): void { pressedShortcutKeys.clear() }
function onShortcutPreferencesChanged(): void { keyboardShortcuts.value = loadKeyboardShortcuts(localStorage) }
window.addEventListener('keyup', onKeyup)
window.addEventListener('blur', onWindowBlur)
window.addEventListener(KEYBOARD_SHORTCUTS_CHANGED_EVENT, onShortcutPreferencesChanged)
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener(KEYBOARD_SHORTCUTS_CHANGED_EVENT, onShortcutPreferencesChanged)
})
const executionPriceLabel = computed(() => training.value.clockMode === 'open_close' && training.value.currentPhase === 'open' ? '按当日开盘价成交' : '按当日收盘价成交')
// 统一下单面板的条件单列表：挂单全部列出（多挂单支持），已终结单只保留最近 6 条供回看
const pendingOrders = computed(() => snapshot.value.orders.filter(order => order.status === 'pending'))
const recentFinishedOrders = computed(() => snapshot.value.orders.filter(order => order.status !== 'pending').slice(-6).reverse())
const orderStatusLabel: Record<OrderView['status'], string> = { pending: '待触发', filled: '已成交', cancelled: '已撤单', expired: '已过期', rejected: '已拒绝' }
function orderTitle(order: OrderView): string {
  return `${order.side === 'buy' ? '买入' : '卖出'} ${order.orderType === 'limit' ? '限价' : '止损'}`
}
function orderDirectionLabel(order: OrderView): string {
  return orderTriggerDirection(order) === 'up' ? '上触' : '下触'
}
// 触发方向实时提示（V1.2.5 语义：到价才触发，方向按触发价与当前阶段价的相对位置推断）——
// 挂单前就告诉用户这笔单在等哪个方向，避免"还没到价就成交"的意外
const phasePriceNow = computed<number | null>(() => training.value.currentPhase === 'open' ? training.value.currentOpen : training.value.currentClose)
const orderTriggerHint = computed(() => {
  if (orderTrigger.value === null || !Number.isFinite(orderTrigger.value) || phasePriceNow.value === null || phasePriceNow.value === undefined) return ''
  const up = orderTrigger.value > phasePriceNow.value
  const fillStyle = orderType.value === 'limit' ? '限价按触发价成交' : '止损按当日收盘价成交'
  return `到价触发：等待价格${up ? '上触' : '下触'} ${orderTrigger.value.toFixed(2)}（当前 ${phasePriceNow.value.toFixed(2)}），${fillStyle}`
})

// ===== 日线数据小更新按钮（紧凑操作栏，固定尺寸不挤图表） =====
// 更新结果通过全局状态轻提示：终态到达后按钮短暂变绿"✓"（或红"!"），不弹模态
const miniFlash = ref<'ok' | 'fail' | null>(null)
const miniFeedbackVisible = ref(true)
let miniFlashTimer: ReturnType<typeof setTimeout> | undefined
watch(dataOutcomeSeq, () => {
  const outcome = dataRefreshOutcome.value
  miniFlash.value = outcome === 'updated' || outcome === 'unchanged' ? 'ok' : outcome === 'failed' ? 'fail' : null
  clearTimeout(miniFlashTimer)
  if (miniFlash.value) miniFlashTimer = setTimeout(() => { miniFlash.value = null }, 2600)
})
onUnmounted(() => clearTimeout(miniFlashTimer))
const miniLabel = computed(() => {
  if (dataUpdating.value) return '更新中'
  if (dataRefreshError.value) return '!'
  if (miniFlash.value === 'ok') return '✓'
  if (miniFlash.value === 'fail') return '!'
  return '更新'
})
const miniTitle = computed(() => {
  if (dataUpdating.value) return '日线数据更新中'
  if (dataRefreshError.value) return `${dataRefreshError.value}，点击重试`
  if (dataRefreshMessage.value) return dataRefreshMessage.value
  if (dataStatus.value?.freshness?.state === 'stale') return `日线数据待更新（截止 ${dataStatus.value.sourceMaxDate ?? '未知'}），请先在通达信完成盘后数据下载，再重新读取`
  if (dataStatus.value?.freshness?.state === 'unknown') return '最新交易日待确认，点击重新读取本地日线'
  return '重新读取本地日线（不联网）'
})
const miniFeedback = computed(() => !miniFeedbackVisible.value ? '' : dataUpdating.value ? '正在重新读取本地日线…' : dataRefreshError.value || dataRefreshMessage.value)
// 扫描结果保留在按钮提示里；推进、成交或工具动作产生新状态时，状态栏归还给训练。
watch(statusText, () => { miniFeedbackVisible.value = false })
watch([dataUpdating, dataOutcomeSeq, dataRefreshError], () => { miniFeedbackVisible.value = true })
function onMiniRefresh(): void {
  miniFeedbackVisible.value = true
  void refreshDataNow()
}

watch(tf, (value, previous) => {
  const op = recording.begin('chart.timeframe', { from: previous, to: value })
  // Chart data will be captured only after the matching load finishes.
  loading.value = true
  if (allDrawings.value) initialDrawings.value = allDrawings.value.filter(item => (item.timeframe ?? '1D') === value)
  recording.finish(op, 'accepted')
  void load()
})

// M6-04 副图指标开关（VOL/MACD/KDJ）：与周期按钮同行同区的应用偏好（localStorage 独立键，
// 默认全开）；切换立即增删对应副图窗格并跨重启保持；不属于录像布局，回放按当前开关渲染。
const indicatorToggles = [
  { name: 'VOL', label: '成交量', enabled: appVolSubchart, toggle: setVolSubchart },
  { name: 'MACD', label: 'MACD', enabled: appMacdSubchart, toggle: setMacdSubchart },
  { name: 'KDJ', label: 'KDJ', enabled: appKdjSubchart, toggle: setKdjSubchart },
] as const
void load()
</script>

<template>
  <div class="training-shell">
    <header class="training-topbar" :inert="preparingRecording" @keydown.space.stop>
      <div class="training-context">
        <div class="title-row">
          <div class="workspace-title" :title="training.blind ? `盲训 · ${tierLabel}` : maskedStock ? '随机标的 · 已隐藏' : `${training.name ?? ''} · ${training.code ?? ''}`">
            {{ training.blind ? `盲训 · ${tierLabel}` : maskedStock ? '随机标的 · 已隐藏' : `${training.name ?? ''} · ${training.code ?? ''}` }}
          </div>
          <span v-if="training.random" class="random-mode-badge" :title="`随机模式 · ${randomDimensionLabel}`">随机模式</span>
        </div>
        <div class="training-current-date">当前 <strong>{{ training.currentDate }}</strong><span v-if="training.clockMode === 'open_close'" class="phase-tag">{{ training.currentPhase === 'open' ? '开盘阶段' : '收盘阶段' }}</span></div>
        <div class="timeframe-tabs" role="tablist" aria-label="K线周期">
          <button v-for="item in (['1D', '1W', '1M'] as Timeframe[])" :key="item" role="tab" :aria-selected="tf === item" :class="{ selected: tf === item }" @click="tf = item">{{ item === '1D' ? '日K' : item === '1W' ? '周K' : '月K' }}</button>
        </div>
        <!-- M6-04 副图指标开关：与周期按钮同区（股票信息行），aria-pressed 语义保留；off＝虚线灰 -->
        <div class="indicator-toggles" role="group" aria-label="副图指标开关">
          <button v-for="item in indicatorToggles" :key="item.name" class="indicator-toggle" :class="{ off: !item.enabled.value }" :aria-pressed="item.enabled.value ? 'true' : 'false'" :title="item.enabled.value ? `${item.label}副图：显示中（点击隐藏）` : `${item.label}副图：已隐藏（点击显示）`" @click="item.toggle(!item.enabled.value)">{{ item.name }}</button>
        </div>
        <!-- M6-07：数字滚动动效入口已移入设置面板「动画效果」分栏（顶栏胶囊按钮移除，用户 2026-10-05 拍板） -->
        <details class="training-details" @keydown.esc.prevent.stop="($event.currentTarget as HTMLDetailsElement).open = false">
          <summary title="训练详情" aria-label="训练详情"><Info :size="15" /></summary>
          <div class="training-meta">
            <span>{{ training.adjustMode === 'forward' ? '前复权' : '不复权' }}（已锁定）</span>
            <span v-if="rulesSummary">{{ rulesSummary }}</span>
            <span v-if="training.rules?.origin === 'legacy-migration'">旧训练按升级时设置继续，历史设置未记录</span>
            <span>起始 {{ training.startDate }}</span>
            <span>当前 <strong>{{ training.currentDate }}</strong></span>
            <span>计划结束 {{ training.plannedEnd }}</span>
            <span>时长 {{ tierLabel }}</span>
            <span v-if="legacyDrawingNotice" class="legacy-drawing-notice">{{ legacyDrawingNotice }}</span>
          </div>
        </details>
      </div>
      <div class="training-actions">
        <button class="ghost-button data-refresh-btn" :class="{ 'is-updating': dataUpdating, attention: dataStatus?.freshness?.state === 'stale' && !dataUpdating, 'flash-ok': miniFlash === 'ok', 'flash-fail': miniFlash === 'fail' || !!dataRefreshError }" :disabled="dataUpdating" :title="miniTitle" :aria-label="`日线数据更新：${miniTitle}`" @click="onMiniRefresh">{{ miniLabel }}</button>
        <button class="ghost-button compact-icon-button" title="刷新图表" aria-label="刷新图表" :disabled="loading" @click="load"><RefreshCw :size="14" /></button>
        <button class="ghost-button compact-icon-button" title="回到最新K线" aria-label="回到最新K线" :disabled="loading" @click="chartRef?.resetView()"><SkipForward :size="14" /></button>
        <button class="advance-button" :disabled="loading || legacyRawLocked || training.status !== 'running'" title="推进下一日（空格）" @click="advance"><StepForward :size="14" />推进下一日</button>
        <template v-if="training.status === 'running'"><button class="ghost-button" :disabled="legacyRawLocked" @click="requestEnd('settle')">提前结算</button><button class="ghost-button danger" @click="requestEnd('abandon')">放弃训练</button></template>
        <button v-else class="ghost-button" @click="backToLauncher">返回首页</button>
      </div>
    </header>


    <div v-if="legacyRawLocked" class="legacy-raw-banner" role="alert">
      旧版不复权训练缺少完整权息记录，请保留记录后新建训练。本训练已只读：不能交易、推进或结算，可查看、导出录像或放弃。
    </div>

    <section class="status-strip" aria-live="polite">
      <span v-if="miniFeedback && !errorMessage" class="status-message mini-update-feedback" :class="{ 'error-text': !!dataRefreshError }" :title="miniFeedback" :role="dataRefreshError ? 'alert' : 'status'">{{ miniFeedback }}</span>
      <span v-else class="status-message" :title="errorMessage || statusText" :class="{ 'error-text': errorMessage }">{{ errorMessage || statusText }}</span>
      <span v-if="!miniFeedback" class="shortcut-hint" title="空格：推进下一日；[ / ]：日周月周期；Home：回到最新；↑ / ↓：缩放；Del：删除选中画线；B / S：买入卖出；Ctrl+Z / Ctrl+Y：撤销重做。输入、弹窗和画线取点期间部分快捷键暂停。">空格 下一日 · [ ] 周期 · Home 最新 · ↑↓ 缩放 · Del 删线</span>
      <span v-if="loading" class="loading-dot">处理中</span>
      <span v-if="chartViewport.visibleDate" class="viewport-date chart-date-status">{{ tf === '1D' ? '可见至' : tf === '1W' ? '右端周K' : '右端月K' }} {{ chartViewport.visibleDate }}</span>
      <span v-if="chartViewport.latestDate && chartViewport.latestDate !== chartViewport.visibleDate" class="viewport-date latest-date">{{ tf === '1D' ? '末根' : tf === '1W' ? '最新周K' : '最新月K' }} {{ chartViewport.latestDate }}</span>
      <span class="view-count" title="当前同屏K线根数 / 同屏上限">{{ visibleCount }} / {{ MAX_VISIBLE_BARS }} 根</span>
    </section>



    <section class="training-grid" :inert="preparingRecording">
      <div class="chart-panel">
        <KlineChart
          ref="chartRef" :bars="bars" :trades="snapshot.trades" :orders="snapshot.orders"
          :cost-price="account.costPrice" :chart-cost-price="chartCostPrice"
          :current-price="training.currentPhase === 'open' ? training.currentOpen : training.currentClose"
          :previous-close="previousClose"
          :drawing-price-basis="drawingPriceBasis"
          :timeframe="tf" :has-more-bars="hasMoreBars" :fetch-earlier="fetchEarlier"
          :draw-tool="drawTool" :multi-select="multiSelectMode"
          :magnet="magnet" :saved-drawings="initialDrawings" :training-id="training.id"
          @chart-capture="recording.capture" @operation="recording.operation" @capture-error="recording.fail"
          @visible-count="visibleCount = $event"
          @viewport-dates="chartViewport = $event"
          @tool-change="drawTool = $event"
          @drawings-change="onDrawingsChange" @history-change="historyState = $event" @panel-change="textPanelOpen = $event"
        />
      </div>

      <aside class="trade-panel">
        <Teleport to="#training-recording-controls">
        <div class="recording-strip" @keydown.space.stop>
          <label><input type="checkbox" aria-label="记录操作" :checked="recording.enabled.value" :disabled="loading || !recording.ready.value || recording.finalized.value" @change="recording.toggle" />记录操作</label>
          <span role="status" :class="{ 'error-text': recording.label.value === '记录失败' }">{{ recording.label.value }} · {{ recording.businessEventCount.value }} 次操作</span>
          <button class="ghost-button" :disabled="loading || !recording.ready.value || (recording.finalized.value && !recording.hasRetainedFile.value)" @click="recording.exportFile">导出录制</button>
          <span v-if="recording.notice.value || recording.error.value || recording.status.value.error" class="recording-feedback" :class="{ 'error-text': recording.error.value || recording.status.value.error }" role="alert">{{ recording.error.value || recording.status.value.error || recording.notice.value }}</span>
          <button v-if="recording.label.value === '记录失败'" class="ghost-button" @click="recording.retry">重试录制保存</button>
        </div>
        </Teleport>
        <div class="console-scroll">
        <div class="panel-heading"><span>训练账户</span><span class="live-mark">● {{ training.status === 'running' ? '进行中' : '已结束' }}</span></div>
        <div class="equity-block">
          <span>账户权益</span>
          <!-- M6-05 Odometer：.odo-text 恒为账面终值（断言读取口径）；.odo-roll 是动画视觉层 -->
          <strong class="odo-host" :class="{ rolling: equityRoll !== null }"><span class="odo-wrap"><span class="odo-text">{{ formatEquity(account.equity) }}</span><span v-if="equityRoll" class="odo-roll" aria-hidden="true"><template v-for="(col, i) in equityRoll" :key="i"><span v-if="col.digit === null" class="odo-char">{{ col.char }}</span><span v-else class="odo-digit"><span class="odo-strip" :style="{ transform: `translateY(${-col.digit}lh)` }"><i>0</i><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i></span></span></template></span></span></strong>
          <em class="odo-host" :class="[returnPct >= 0 ? 'up' : 'down', { rolling: returnRoll !== null }]"><span class="odo-wrap"><span class="odo-text">{{ formatReturnPct(returnPct) }}</span><span v-if="returnRoll" class="odo-roll" aria-hidden="true"><template v-for="(col, i) in returnRoll" :key="i"><span v-if="col.digit === null" class="odo-char">{{ col.char }}</span><span v-else class="odo-digit"><span class="odo-strip" :style="{ transform: `translateY(${-col.digit}lh)` }"><i>0</i><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i></span></span></template></span></span></em>
        </div>
        <div class="account-stats">
          <div><span>可用资金</span><strong>¥{{ account.cash.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</strong></div>
          <div><span>持仓市值</span><strong>¥{{ account.marketValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</strong></div>
          <div><span>持仓（可卖）</span><strong>{{ account.shares }}（{{ account.availableShares }}）</strong></div>
          <div><span>摊薄成本</span><strong>{{ account.costPrice ? account.costPrice.toFixed(2) : '--' }}</strong></div>
        </div>

        <div class="panel-divider"></div>
        <!-- 统一下单面板：普通下单/条件单标签页共享仓位控件（百分比＋按股数买卖） -->
        <div class="order-heading">
          <div class="order-tabs" role="tablist" aria-label="下单方式">
            <button role="tab" :aria-selected="orderTab === 'normal'" :class="{ selected: orderTab === 'normal' }" @click="orderTab = 'normal'">普通下单</button>
            <button v-if="training.ordersEnabled" role="tab" :aria-selected="orderTab === 'conditional'" :class="{ selected: orderTab === 'conditional' }" @click="orderTab = 'conditional'">条件单</button>
          </div>
          <small>{{ executionPriceLabel }}</small>
        </div>
        <div class="weight-grid">
          <button v-for="w in [10, 20, 25, 30, 50, 75, 100]" :key="w" :class="{ selected: weight === w && customWeight === null }" @click="weight = w; customWeight = null">{{ w }}%</button>
          <input v-model.number="customWeight" type="number" min="1" max="100" placeholder="自定义%" />
        </div>
        <div class="shares-row">
          <input v-model.number="customShares" type="number" min="1" step="100" placeholder="按股数买卖（选填）" aria-label="按股数买卖" />
          <small>留空则按左侧比例</small>
        </div>
        <template v-if="orderTab !== 'conditional' || !training.ordersEnabled">
          <div class="trade-actions">
            <button class="trade-action buy" :disabled="legacyRawLocked || training.status !== 'running'" @click="trade('buy')">买入</button>
            <button class="trade-action sell" :disabled="legacyRawLocked || training.status !== 'running'" @click="trade('sell')">卖出</button>
          </div>
        </template>
        <div v-else class="order-form">
          <div class="order-form-row">
            <select v-model="orderSide" aria-label="条件单方向"><option value="buy">买入</option><option value="sell">卖出</option></select>
            <select v-model="orderType" aria-label="条件单类型"><option value="limit">限价</option><option value="stop">止损</option></select>
          </div>
          <div class="order-form-row">
            <input v-model.number="orderTrigger" type="number" min="0.01" step="0.01" placeholder="触发价" aria-label="条件单触发价" />
          </div>
          <p v-if="orderTriggerHint" class="order-hint" role="status">{{ orderTriggerHint }}</p>
          <input v-model="orderReason" maxlength="500" placeholder="挂单理由（可选）" aria-label="挂单理由" />
          <button class="ghost-button order-submit" :disabled="loading || orderTrigger === null || legacyRawLocked || training.status !== 'running'" @click="placeOrder">提交条件单</button>
        </div>

        <div v-if="training.ordersEnabled" class="order-list">
          <div v-for="order in pendingOrders" :key="order.id" class="order-item">
            <span class="order-item-side" :class="order.side">{{ orderTitle(order) }}</span>
            <span class="order-item-detail">{{ orderDirectionLabel(order) }}触发 {{ order.triggerPrice.toFixed(2) }} · {{ order.shares }} 股</span>
            <button class="ghost-button order-cancel" :disabled="loading" @click="cancelOrder(order.id)">撤单</button>
            <span v-if="order.reason" class="order-item-note" :title="order.reason">理由：{{ order.reason }}</span>
          </div>
          <p v-if="!pendingOrders.length && orderTab === 'conditional'" class="order-list-empty">暂无待触发条件单</p>
          <details v-if="recentFinishedOrders.length" class="order-history">
            <summary>最近条件单记录（{{ recentFinishedOrders.length }}）</summary>
            <div v-for="order in recentFinishedOrders" :key="order.id" class="order-item finished">
              <span class="order-item-status" :class="order.status">{{ orderStatusLabel[order.status] }}</span>
              <span class="order-item-detail">{{ orderTitle(order) }} · {{ orderDirectionLabel(order) }}触发 {{ order.triggerPrice.toFixed(2) }} · {{ order.shares }} 股</span>
              <span v-if="order.statusReason" class="order-item-note" :title="order.statusReason">{{ order.statusReason }}</span>
            </div>
          </details>
        </div>
        <p v-if="orderError" class="error-text" role="alert">{{ orderError }}</p>

        </div>
        <div class="draw-toolbar" :class="{ 'is-collapsed': toolbarCollapsed, 'has-other-tools': otherToolsExpanded || customizingTools, 'is-customizing': customizingTools }" @keydown="onToolbarKeydown">
          <div class="drawing-toolbar-heading">
            <button class="tool-collapse" :disabled="customizingTools" :title="toolbarCollapsed ? '展开画线工具条' : '折叠画线工具条'" :aria-label="toolbarCollapsed ? '展开画线工具条' : '折叠画线工具条'" :aria-expanded="!toolbarCollapsed" @click="toolbarCollapsed = !toolbarCollapsed"><ChevronDown v-if="toolbarCollapsed" :size="14"/><ChevronUp v-else :size="14"/></button>
            <span>常用工具</span>
            <button v-if="customizingTools" class="tool-reset" title="恢复默认常用工具" aria-label="恢复默认常用工具" @click="updateFavoriteTools([...DEFAULT_FAVORITE_TOOLS])"><RotateCcw :size="13"/></button>
            <button class="tool-customize-toggle" :class="{ active: customizingTools }" :aria-pressed="customizingTools" :disabled="textPanelOpen" @click="toggleToolCustomization"><Check v-if="customizingTools" :size="13"/><Settings2 v-else :size="13"/>{{ customizingTools ? '完成自定义' : '自定义常用' }}</button>
          </div>
          <template v-if="!toolbarCollapsed">
            <div class="toolbar-tool-lists">
              <div class="favorite-tools tool-list" :class="{ 'accepting-drop': customizingTools && draggedTool }" @dragover="dragOverTools($event, 'favorites')" @drop.stop="dropTool">
                <template v-for="(tool, index) in favoriteTools" :key="tool.name">
                  <div class="tool-item" :class="{ 'is-dragged': draggedTool === tool.name }" @dragover.stop="dragOverTools($event, 'favorites', index)">
                    <span v-if="toolDropTarget?.list === 'favorites' && toolDropTarget.index === index" class="toolbar-drop-indicator" aria-hidden="true"></span>
                    <span v-if="toolDropTarget?.list === 'favorites' && toolDropTarget.index === favoriteTools.length && index === favoriteTools.length - 1" class="toolbar-drop-indicator at-end" aria-hidden="true"></span>
                    <button
                      :data-tool-name="tool.name" :draggable="customizingTools"
                      :disabled="!customizingTools && (initialDrawings === null || textPanelOpen)"
                      :class="{ active: drawTool === tool.name }" :title="customizingTools ? `拖动排序：${tool.label}` : tool.label"
                      @dragstart="startToolDrag($event, tool.name)" @dragend="endToolDrag"
                      @mousedown="!customizingTools && $event.preventDefault()"
                      @click="!customizingTools && (drawTool = drawTool === tool.name ? null : tool.name)"
                    ><GripVertical v-if="customizingTools" :size="12"/>{{ tool.label }}</button>
                    <div v-if="customizingTools" class="tool-item-actions">
                      <button :disabled="index === 0" :title="`${tool.label}前移`" :aria-label="`${tool.label}前移`" @click="shiftFavoriteTool(tool.name, -1)"><ArrowLeft :size="12"/></button>
                      <button :disabled="index === favoriteTools.length - 1" :title="`${tool.label}后移`" :aria-label="`${tool.label}后移`" @click="shiftFavoriteTool(tool.name, 1)"><ArrowRight :size="12"/></button>
                      <button :title="`移出常用：${tool.label}`" :aria-label="`移出常用：${tool.label}`" @click="updateFavoriteTools(moveFavoriteTool(favoriteToolNames, tool.name, null))"><Minus :size="12"/></button>
                    </div>
                  </div>
                </template>
                <span v-if="toolDropTarget?.list === 'favorites' && !favoriteTools.length" class="toolbar-drop-indicator" aria-hidden="true"></span>
                <span v-if="!favoriteTools.length" class="tool-list-empty">暂无常用工具</span>
              </div>
              <button class="other-tools-toggle" :aria-expanded="otherToolsExpanded || customizingTools" :disabled="customizingTools" @click="otherToolsExpanded = !otherToolsExpanded"><ChevronUp v-if="otherToolsExpanded || customizingTools" :size="13"/><ChevronDown v-else :size="13"/>其他工具 <span>{{ otherTools.length }}</span></button>
              <div v-if="otherToolsExpanded || customizingTools" class="other-tools tool-list" :class="{ 'accepting-drop': customizingTools && draggedTool }" @dragover="dragOverTools($event, 'other')" @drop.stop="dropTool">
                <span v-if="toolDropTarget?.list === 'other'" class="toolbar-drop-indicator" aria-hidden="true"></span>
                <div v-for="tool in otherTools" :key="tool.name" class="tool-item" :class="{ 'is-dragged': draggedTool === tool.name }">
                  <button
                    :data-tool-name="tool.name" :draggable="customizingTools"
                    :disabled="!customizingTools && (initialDrawings === null || textPanelOpen)"
                    :class="{ active: drawTool === tool.name }" :title="customizingTools ? `拖入常用：${tool.label}` : tool.label"
                    @dragstart="startToolDrag($event, tool.name)" @dragend="endToolDrag"
                    @mousedown="!customizingTools && $event.preventDefault()"
                    @click="!customizingTools && (drawTool = drawTool === tool.name ? null : tool.name)"
                  ><GripVertical v-if="customizingTools" :size="12"/>{{ tool.label }}</button>
                  <div v-if="customizingTools" class="tool-item-actions"><button :title="`加入常用：${tool.label}`" :aria-label="`加入常用：${tool.label}`" @click="updateFavoriteTools(moveFavoriteTool(favoriteToolNames, tool.name, favoriteToolNames.length))"><Plus :size="12"/></button></div>
                </div>
                <span v-if="!otherTools.length" class="tool-list-empty">全部工具已加入常用</span>
              </div>
            </div>
            <div class="drawing-toolbar-actions">
              <button :class="{ active: multiSelectMode }" :disabled="customizingTools" title="多选模式：框选批量选中划线后批量编辑/删除" @mousedown.prevent @click="toggleMultiSelectMode">多选</button>
              <button title="撤销" aria-label="撤销" :disabled="customizingTools || !historyState.undo || !!drawTool || textPanelOpen" @click="chartRef?.undoDrawing()"><Undo2 :size="14"/></button>
              <button title="重做" aria-label="重做" :disabled="customizingTools || !historyState.redo || !!drawTool || textPanelOpen" @click="chartRef?.redoDrawing()"><Redo2 :size="14"/></button>
              <button title="清空" aria-label="清空" :disabled="customizingTools || initialDrawings === null || !!drawTool || textPanelOpen" @click="chartRef?.clearDrawings()"><Trash2 :size="14"/></button>
              <select v-model="magnet" :disabled="customizingTools" aria-label="吸附"><option value="normal">关闭</option><option value="weak_magnet">弱吸附</option><option value="strong_magnet">强吸附</option></select>
            </div>
          </template>
          <div class="drawing-save-footer">
            <span class="drawing-save-status" :class="{ 'save-error': drawingSaveError }" :title="drawingSaveError || drawingSaveStatus" role="status">{{ drawingSaveStatus }}</span>
            <button v-if="drawingLoadError" @click="loadDrawings">重新加载</button>
            <button v-if="drawingSaveStatus === '保存失败'" @click="flushDrawings">重试保存</button>
            <span v-if="favoriteStorageError" class="favorite-storage-error" title="常用工具未能写入浏览器存储，刷新后会恢复之前的设置">常用未保存</span>
          </div>
        </div>
      </aside>
    </section>

    <div v-if="endAction" class="settle-mask" role="dialog" aria-modal="true" aria-label="结束训练" @keydown.stop>
      <div class="settle-panel">
        <h2>{{ endAction === 'abandon' ? '放弃本轮训练' : '提前结算本轮训练' }}</h2>
        <p>{{ endAction === 'abandon' ? '放弃后成绩不进入排行榜，已有交易和画线仍保留。' : '结算后结束本轮交易，仍可查看图表和回放。' }}</p>
        <label class="keep-recording"><input v-model="keepRecording" type="checkbox" :disabled="finishingSession || recording.finalized.value" />保留到本机训练历史</label>
        <p class="form-hint">不勾选仅丢弃本轮录像，不删除交易成绩和画线。</p>
        <p v-if="endError" class="error-text" role="alert">{{ endError }}</p>
        <button class="trade-action buy" :disabled="finishingSession" @click="confirmEnd">{{ endAction === 'abandon' ? '确认放弃' : '确认结算' }}</button>
        <button class="ghost-button" :disabled="finishingSession" @click="recording.exportFile">导出录像</button>
        <button class="ghost-button" :disabled="finishingSession" @click="endAction = null">继续训练</button>
      </div>
    </div>
    <div v-else-if="settledView" class="settle-mask" role="dialog" aria-modal="true" aria-label="训练结算" @keydown.stop>
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
        <label class="keep-recording"><input v-model="keepRecording" type="checkbox" :disabled="finishingSession || recording.finalized.value" />保留到本机训练历史</label>
        <p v-if="endError" class="error-text" role="alert">{{ endError }}</p>
        <div class="settle-actions">
          <button class="trade-action buy" :disabled="finishingSession" @click="backToLauncher">完成，返回首页</button>
          <button class="ghost-button" :disabled="finishingSession" @click="emit('open-history')">查看历史成绩单</button>
          <button class="ghost-button" :disabled="finishingSession" @click="retrain">重新训练</button>
          <button class="ghost-button" :disabled="loading || !recording.ready.value || (recording.finalized.value && !recording.hasRetainedFile.value)" @click="recording.exportFile">导出本场录制</button>
          <button class="ghost-button" @click="settledView = null">留在当前界面</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* M7-02 随机模式：标题行（标题＋徽标）与徽标样式（双主题，沿 phase-tag 胶囊风格） */
.title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.random-mode-badge { flex: none; display: inline-flex; padding: 2px 7px; border-radius: 999px; border: 1px solid #b7d9d0; background: #eef8f4; color: #1f7a5c; font-size: 10px; font-weight: 600; }
:global(body.dark) .random-mode-badge { border-color: #2b5c49; background: #14271f; color: #7ec8a8; }
.recording-strip { position: relative; display: flex; align-items: center; gap: 8px; font-size: 11px; white-space: nowrap; }
.recording-strip label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.recording-strip .ghost-button { padding: 2px 7px; font-size: 11px; }
.recording-feedback { position: absolute; right: 0; top: 28px; z-index: 30; max-width: min(360px, 70vw); padding: 8px; white-space: normal; overflow-wrap: anywhere; background: var(--surface-background, #fff); border: 1px solid var(--surface-border, #dfe5eb); border-radius: 4px; }
.shortcut-hint { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 10px; }
.keep-recording { display: flex; align-items: center; gap: 8px; margin: 12px 0; font-size: 14px; }
.legacy-raw-banner { margin: 8px 16px 0; padding: 8px 12px; border: 1px solid #e0b44c; border-radius: 6px; background: #fdf6e3; color: #7a5b12; font-size: 12px; line-height: 1.5; }
:global(body.dark) .legacy-raw-banner { border-color: #8a6d1d; background: #2e2612; color: #d9b45c; }
.legacy-drawing-notice { white-space: normal; line-height: 1.5; }
.phase-tag { display: inline-flex; margin-left: 8px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--surface-border, #dfe5eb); color: var(--text-secondary, #51637a); font-size: 10px; }
/* 统一下单面板：普通下单/条件单标签页（样式对齐 time-frame 标签），仓位控件两页共享 */
.order-tabs { display: flex; gap: 2px; }
.order-tabs button { border: 0; background: transparent; padding: 3px 9px; font-size: 13px; color: var(--text-secondary, #77869a); border-bottom: 2px solid transparent; }
.order-tabs button.selected { color: #245a72; border-bottom-color: #2e8191; font-weight: 600; }
:global(body.dark) .order-tabs button.selected { color: #ffffff; border-bottom-color: #c4c4c4; }
.order-form { display: grid; gap: 7px; margin-top: 2px; }
.order-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.order-form input, .order-form select { min-width: 0; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 4px; padding: 6px; background: var(--control-background, #fff); color: var(--text-primary, #25364b); font-size: 11px; }
.order-hint { margin: 0; font-size: 10px; line-height: 1.5; color: var(--text-secondary, #51637a); }
.order-submit { justify-content: center; }
/* 条件单列表：挂单全部列出，已终结单折叠在"最近记录"里；颜色沿用红买绿卖口径 */
.order-list { display: grid; gap: 6px; margin-top: 12px; }
.order-item { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 2px 8px; font-size: 11px; color: var(--text-secondary, #51637a); }
.order-item-side { font-weight: 650; }
.order-item-side.buy { color: #c95752; }
.order-item-side.sell { color: #31937b; }
:global(body.dark) .order-item-side.buy { color: #e08a80; }
:global(body.dark) .order-item-side.sell { color: #52b394; }
.order-item-detail { font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.order-item-note { grid-column: 1 / -1; color: var(--text-muted, #a1adba); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.order-item .order-cancel { padding: 2px 8px; font-size: 11px; }
.order-list-empty { margin: 0; font-size: 11px; color: var(--text-muted, #a1adba); }
.order-history summary { cursor: pointer; font-size: 11px; color: var(--text-muted, #a1adba); user-select: none; }
.order-history .order-item { padding: 3px 0; }
.order-item-status { font-weight: 600; }
.order-item-status.filled { color: #2e9e78; }
.order-item-status.rejected { color: #b3413a; }
:global(body.dark) .order-item-status.filled { color: #52b394; }
:global(body.dark) .order-item-status.rejected { color: #e08a80; }
</style>
