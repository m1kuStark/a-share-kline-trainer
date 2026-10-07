<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, dispose, type Chart, type DataLoadMore, type KLineData, type OverlayCreate, type OverlayCreateFiguresCallbackParams, type OverlayEvent, type Overlay, type Coordinate, type Point } from 'klinecharts'
import '../overlays'
import '../indicators'
import { chartStyles, theme, DRAW_DEFAULT_COLOR } from '../theme'
import { appKdjSubchart, appVolSubchart, appMacdSubchart } from '../appSettings'
import type { Bar, OrderView, Timeframe, TradeView } from '../api'
import { orderTriggerDirection } from '../api'
import { DrawingHistory, serializeDrawings, applyDrawingPrices, type Drawing } from '../drawingState'
import { adoptDrawings, advanceRenderedBasis, isDrawingPriceBasis, projectDrawings, sameDrawingPriceBasis, type DrawingPriceBasis } from '../drawingPriceBasis'
import { VIEWPORT_CAPTURE_THROTTLE_MS, buildChartCapture, captureView, toCaptureBars, type CaptureSourceBar } from '../recording/chartCapture'
import type { ChartCapture, ChartCaptureView } from '../recording/types'
import type { Action, JsonValue } from '../recording/types'
import { drawingOperationParams, hasUnreportedMove, markDrawingReported, syncReportedDrawings, type ReportedDrawings } from '../recording/drawingOperations'
import { DRAW_TOOLS } from '../drawTools'
import { loadToolStylePreferences } from '../toolFavorites'
import { MAX_VISIBLE_BARS } from '../chartNavigation'
import TradeMarkerRail from '../TradeMarkerRail.vue'
import MaSettingsDialog from './MaSettingsDialog.vue'
import { appMaSettings, maWarmup } from '../maSettings'
import { registerDrawingOverlays } from '../drawingOverlays'
import { drawingFigureGeometry } from '../drawingGeometry'
import { builtInGeometry, pointInPolygon, segmentInRect } from '../builtInGeometry'
import { formatHoverCard, hasPhasePrice, includePhasePriceRange, phasePriceColor, HOVER_CARD_DWELL_MS, type HoverCardModel } from '../phasePrice'

registerDrawingOverlays()

const props = withDefaults(defineProps<{
  bars: Bar[]
  trades: TradeView[]
  costPrice: number | null
  chartCostPrice?: number | null
  /** 当前训练阶段的成交价。开盘阶段只显示价位线，不把当日完整 OHLC 注入图表。 */
  currentPrice?: number | null
  /** 阶段成交价相对的实际前收；由训练页使用独立日线序列计算。 */
  previousClose?: number | null
  /** 当前训练中的条件单，仅在价格轴绘制触发点。 */
  orders?: OrderView[]
  timeframe?: Timeframe
  defaultCount?: number
  /** 是否还有更早历史可动态加载（初始窗口） */
  hasMoreBars?: boolean
  /** 视窗移到已加载窗口之前时取更早历史（每批独立请求） */
  fetchEarlier?: (before: string, count: number) => Promise<{ bars: Bar[]; hasMore: boolean }>
  /** 当前画线工具（null＝默认模式）：画线模式下框选手势与 Space/B/S 热键被隔离 */
  drawTool?: string | null
  /** 多选模式：主图空白处框选拖拽变为划线批量选中（不缩放 K 线），平移与键盘缩放不受影响 */
  multiSelect?: boolean
  savedDrawings?: Drawing[] | null
  magnet?: 'normal' | 'weak_magnet' | 'strong_magnet'
  /** 只读展示（录制回放）：保存画线照常显示，但禁全部编辑写入口、右键菜单与图形拖动；平移/缩放/十字线不受影响 */
  readOnly?: boolean
  /** 回放视窗（录制检查点）：feed 完成布局后按时间戳恢复右侧锚点、barSpace 与语义窗格高度 */
  replayView?: ChartCaptureView
  /** 画线前复权基准（已发生权息累计仿射变换，随 bars 同源到达）：缺省＝不启用基准投影（旧行为） */
  drawingPriceBasis?: DrawingPriceBasis | null
  /** 交易标记笔记的本轮训练隔离键 */
  trainingId?: number
}>(), { chartCostPrice: null, currentPrice: null, orders: () => [], timeframe: '1D' as Timeframe, defaultCount: 150, hasMoreBars: false, drawTool: null, multiSelect: false, readOnly: false })

const emit = defineEmits<{ visibleCount: [number]; toolChange: [string | null]; drawingsChange: [Drawing[]]; historyChange: [{ undo: boolean; redo: boolean }]; panelChange: [boolean]; viewportDates: [{ visibleDate: string | null; latestDate: string | null; atLatest: boolean }]; chartCapture: [ChartCapture]; captureError: [string]; operation: [{ action: Action; params?: JsonValue }] }>()
const host = ref<HTMLElement | null>(null)
type RuntimeOverlay = Overlay & { isDrawing(): boolean; forceComplete(): void }
type ConvertFilter = Parameters<Chart['convertToPixel']>[1]
type RuntimeChart = Omit<Chart, 'getOverlays' | 'convertToPixel' | 'convertFromPixel'> & {
  getOverlays(filter?: Parameters<Chart['getOverlays']>[0]): RuntimeOverlay[]
  convertToPixel(point: Partial<Point>, filter?: ConvertFilter): Partial<Coordinate>
  convertToPixel(points: Partial<Point>[], filter?: ConvertFilter): Partial<Coordinate>[]
  convertFromPixel(point: Partial<Coordinate>, filter?: ConvertFilter): Partial<Point>
  convertFromPixel(points: Partial<Coordinate>[], filter?: ConvertFilter): Partial<Point>[]
}
let chart: RuntimeChart | null = null
const maSettingsOpen = ref(false)
const maHistoryError = ref('')
function openMaSettings(): void {
  closePanels()
  maSettingsOpen.value = true
  emit('panelChange', true)
}
function closeMaSettings(): void { maSettingsOpen.value = false; emit('panelChange', false) }
function applyMaSettings(): void {
  const active = appMaSettings.value.lines.filter(line => line.period > 0)
  chart?.overrideIndicator({ name: 'MA', paneId: 'candle_pane', visible: active.length > 0,
    calcParams: active.map(line => line.period), styles: { lines: active.map(line => ({ color: line.color })) } })
  maHistoryError.value = ''
  queueMicrotask(ensureMaHistory)
}
// 同屏最多840根，更早历史按需加载；窄窗口允许亚像素柱宽。
const MIN_COUNT = 1
const MAX_COUNT = MAX_VISIBLE_BARS
const RIGHT_MARGIN = 80
// klinecharts 默认单根柱宽上限 50px（barSpaceLimit.max），框选少于约 18 根时请求的柱宽超限被静默忽略成平移；
// 提高到 300 以支持"选中几根就放大到铺满"（依赖钉定的 klinecharts 10.0.3 内部结构，升级需复查）
const BAR_SPACE_MAX = 300
const LOAD_CHUNK_BARS = 300
let crossIndex = -1
let selecting = false
let paneResizePointerId: number | null = null
let selectStartX = 0
let hostRect: DOMRect | null = null
// 框选绘图区边界（每次框选启动时计算）：水平止于价格轴左缘、垂直止于时间轴上缘——
// 价格轴/时间轴是 K 线图外部的坐标轴，选中框与选点坐标不得侵入（用户 D1 验收反馈）
let plotBounds: { right: number; top: number; bottom: number } | null = null
// 组件内持有累进后的全量数据（初始窗口 + 动态加载的更早历史）
let loadedData: KLineData[] = []
let hasMoreForward = false
let loadingForward = false
let dataVersion = 0
const drawingHistory = new DrawingHistory()
// 画线数值所属的前复权基准（DRAW-02）：恢复时按各画线存储基准投影/采用当前基准；
// 喂新K线基准变化时，先按旧基准捕获画线，喂完统一投影到新基准。null＝基准未知（prop 未
// 接线或只读回放），一切保持旧行为，绝不二次复权。
let renderedBasis: DrawingPriceBasis | null = null
function currentDrawingPriceBasis(): DrawingPriceBasis | null {
  return props.readOnly || !isDrawingPriceBasis(props.drawingPriceBasis) ? null : { ...props.drawingPriceBasis }
}
function configuredOverlayStyle(name: string): OverlayCreate['styles'] | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const preference = loadToolStylePreferences(localStorage)[name]
  if (!preference) return undefined
  return { line: { color: preference.color, size: preference.size, style: preference.style === 'solid' ? 'solid' : 'dashed', dashedValue: preference.style === 'dotted' ? [2, 4] : [4, 4] } }
}
function configuredOverlayText(name: string): Record<string, unknown> | undefined {
  if (typeof localStorage === 'undefined' || name !== 'textAnnotation') return undefined
  const preference = loadToolStylePreferences(localStorage)[name]
  return preference ? { color: preference.textColor, size: preference.textSize } : undefined
}
let restoringDrawings = false
let restoredDrawings = false
let disposed = false
const markerRevision = ref(0)
const markerWidth = ref(0)
const orderTooltip = ref<{ x: number; y: number; text: string } | null>(null)
// M6-03 悬浮信息卡（candle-percent-hover 矩阵 v2，用户 2026-10-05 验收拍板）：
// 指针停留同一根 K 线 ≥1000ms 显示（通达信参照）；移到另一根＝隐藏并重计时；离开图表
// 立即隐藏；键盘十字线＝明确意图，立即显示无延时。纯展示层：hoverCard 只进 DOM，
// 不 emit、不写 localStorage/录像/布局/画线等任何持久层；pointer-events:none
// 不拦截框选/拖拽/画线/键盘十字线。内容与涨幅口径＝phasePrice.formatHoverCard（冻结 oracle）。
interface HoverCardState { x: number; y: number; model: HoverCardModel }
const hoverCard = ref<HoverCardState | null>(null)
// 位置钳制用的保守尺寸（≥实际 DOM 尺寸；只影响翻侧/钳制的提前量，不影响正确性）
const HOVER_CARD_W = 150
const HOVER_CARD_H = 132
// 十字线交点右下方偏移：紧贴吸附竖线右侧/指针横线下方，且保证与指针热点区（±12px）垂直分离
const HOVER_CARD_OFFSET = 14
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let hoverPendingIndex: number | null = null
let hoverPendingAnchor: { x: number; y: number } | null = null
function cancelHoverTimer(): void {
  if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null }
  hoverPendingIndex = null
  hoverPendingAnchor = null
}
function hideHoverCard(): void { cancelHoverTimer(); hoverCard.value = null }
// 卡数据源＝chart.getDataList()（训练与只读回放同一路径：回放按回放数据序列计算），
// 计算不受只读门控（只读回放十字线照常可用，卡与十字线同一可用性）。
function buildHoverModel(dataIndex: number): HoverCardModel | null {
  if (!chart) return null
  const list = chart.getDataList() as Array<KLineData & { date?: string }>
  const bar = list[dataIndex]
  if (!bar) return null
  return formatHoverCard(bar, dataIndex > 0 ? list[dataIndex - 1]?.close ?? null : null)
}
// 位置＝十字线交点（吸附 K 线中心的竖线 × 指针横线）右下方（TDX 参照）；右侧空间不足
// 翻左侧；整体钳制在主图绘图区内（不遮价格轴/时间轴），并与指针热点区垂直分离。
function placeHoverCard(anchorX: number, anchorY: number, model: HoverCardModel): HoverCardState {
  const fallback: HoverCardState = { x: anchorX + HOVER_CARD_OFFSET, y: anchorY + HOVER_CARD_OFFSET, model }
  if (!chart) return fallback
  const pane = chart.getSize('candle_pane')
  const xAxis = chart.getSize('x_axis_pane')
  if (!pane || !xAxis) return fallback
  const plotRight = chart.getSize('candle_pane', 'yAxis')?.left ?? pane.width
  const plotTop = pane.top
  const plotBottom = xAxis.top
  let x = anchorX + HOVER_CARD_OFFSET
  if (x + HOVER_CARD_W > plotRight - 4) x = anchorX - HOVER_CARD_OFFSET - HOVER_CARD_W
  x = Math.max(4, Math.min(x, Math.max(4, plotRight - HOVER_CARD_W - 4)))
  let y = anchorY + HOVER_CARD_OFFSET
  y = Math.max(plotTop + 2, Math.min(y, Math.max(plotTop + 2, plotBottom - HOVER_CARD_H - 4)))
  return { x, y, model }
}
// 停留计时以 dataIndex 为键：同一根 K 线内的指针微动只更新锚点（不重置计时），
// 已可见时随十字线实时重摆；移到另一根＝取消计时＋隐藏＋重新计时。
function scheduleHoverCard(dataIndex: number, anchorX: number, anchorY: number): void {
  if (hoverPendingIndex === dataIndex) {
    hoverPendingAnchor = { x: anchorX, y: anchorY }
    if (hoverCard.value) hoverCard.value = placeHoverCard(anchorX, anchorY, hoverCard.value.model)
    return
  }
  cancelHoverTimer()
  if (hoverCard.value !== null) hoverCard.value = null
  hoverPendingIndex = dataIndex
  hoverPendingAnchor = { x: anchorX, y: anchorY }
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    const anchor = hoverPendingAnchor
    if (hoverPendingIndex === null || !anchor) return
    const model = buildHoverModel(hoverPendingIndex)
    if (!model) { hoverPendingIndex = null; hoverPendingAnchor = null; return }
    hoverCard.value = placeHoverCard(anchor.x, anchor.y, model)
  }, HOVER_CARD_DWELL_MS)
}
// 键盘十字线＝明确意图：立即显示（无延时），并取消任何挂起的停留计时
function showHoverCardNow(dataIndex: number, anchorX: number, anchorY: number): void {
  cancelHoverTimer()
  const model = buildHoverModel(dataIndex)
  hoverCard.value = model ? placeHoverCard(anchorX, anchorY, model) : null
}
// klinecharts v10 onCrosshairChange 订阅：payload＝{ x, y, paneId }（宿主坐标系，仅真实
// 指针十字线更新时派发；键盘路径 executeAction notExecuteAction 不回派，由 moveCrosshair
// 显式调用 showHoverCardNow）。库在指针离开图表/移到坐标轴与分隔条时清除十字线但不派发
// 本事件，隐藏由 mouseleave＋onPointerMove 兜底（不变式：卡可见 ⇔ 十字线存在于同一根）。
function onCrosshairAction(data: unknown): void {
  const crosshair = data as { x?: unknown; y?: unknown } | null | undefined
  if (!crosshair || typeof crosshair.x !== 'number' || typeof crosshair.y !== 'number') { hideHoverCard(); return }
  if (!chart) { hideHoverCard(); return }
  const pane = chart.getSize('candle_pane')
  const xAxis = chart.getSize('x_axis_pane')
  if (!pane || !xAxis) { hideHoverCard(); return }
  const rawIndex = chart.convertFromPixel([{ x: crosshair.x }], { paneId: 'candle_pane' })[0]?.dataIndex
  const list = chart.getDataList()
  if (rawIndex === undefined || !Number.isFinite(rawIndex)) { hideHoverCard(); return }
  // 与库内十字线同口径钳制（setCrosshair 对越界锚点取首/末根）：卡与十字线永不指向不同的 K 线
  const dataIndex = Math.max(0, Math.min(Math.floor(rawIndex), list.length - 1))
  if (dataIndex >= list.length) { hideHoverCard(); return }
  // 锚点 x＝吸附后的 K 线中心（十字线竖线位置），y＝指针横线位置
  const snapped = chart.convertToPixel({ dataIndex }, { paneId: 'candle_pane' })
  const anchorX = Number.isFinite(snapped?.x) ? snapped.x! : crosshair.x
  scheduleHoverCard(dataIndex, anchorX, crosshair.y)
}
let markerResizeObserver: ResizeObserver | null = null
function updateMarkerRail(): void {
  queueMicrotask(() => {
    if (!chart || disposed) return
    enforceVisibleLimit()
    markerWidth.value = chart.getSize('candle_pane', 'yAxis')?.left ?? host.value?.clientWidth ?? 0
    markerRevision.value++
    emit('visibleCount', visibleCount())
    const all = chart.getDataList() as Array<KLineData & { date?: string }>
    const range = chart.getVisibleRange()
    const lastIndex = Math.min(all.length - 1, range.to - 1)
    const latestDate = all.at(-1)?.date ?? null
    const visibleDate = all[lastIndex]?.date ?? null
    emit('viewportDates', { visibleDate, latestDate, atLatest: lastIndex === all.length - 1 })
  })
}
function projectTradeTime(timestamp: number): number | null {
  if (!chart) return null
  const point = chart.convertToPixel({ timestamp }, { paneId: 'candle_pane' })
  return Number.isFinite(point.x) ? point.x! : null
}

// 副图语义名映射（M6-01 起含 KDJ）：画线持久化/录像 paneHeights 用语义名（'VOL'/'MACD'/'KDJ'），
// 其余 pane 一律归入 'candle_pane'；KDJ 属应用偏好可关，关时其窗格不存在，映射自然回落主图。
function paneName(id: string): string {
  return chart?.getIndicators({ paneId: id }).find(indicator => ['VOL', 'MACD', 'KDJ'].includes(indicator.name))?.name ?? 'candle_pane'
}
function actualPaneId(name: string): string {
  return ['VOL', 'MACD', 'KDJ'].includes(name) ? chart?.getIndicators({ name })[0]?.paneId ?? 'candle_pane' : 'candle_pane'
}
// M6-01/M6-04 副图开关（VOL/MACD/KDJ）：应用偏好（appSettings 层 localStorage 持久化，
// 默认全开＝M6-04 前现状；不属于录像布局，旧录像回放按当前开关渲染）。开＝创建副图窗格
// （与主图同等的绘图 pane），关＝移除窗格；三个偏好独立；框选/右键/锚点/yRange/
// 回放 paneHeights 守卫按 pane 存在与否自动适用（目标窗格不存在即跳过，不写回主图）。
type ToggleableIndicator = 'VOL' | 'MACD' | 'KDJ'
const SUBCHART_PREFS: Record<ToggleableIndicator, { enabled: () => boolean; mount: () => void }> = {
  VOL: { enabled: () => appVolSubchart.value, mount: () => { chart!.createIndicator({ name: 'VOL', styles: { bars: [{ upColor: '#ef4444', downColor: '#16a34a', noChangeColor: '#94a3b8' }] } }, false) } },
  MACD: { enabled: () => appMacdSubchart.value, mount: () => { chart!.createIndicator({ name: 'MACD', styles: { lines: [{ color: '#f2f2f2' }, { color: '#f5c343' }] } }, false) } },
  // KDJ 配色 proposed_default（K 白/D 黄/J 紫洋红，通达信习惯；M6-01 待用户验收确认），经 styles.lines 传入
  KDJ: { enabled: () => appKdjSubchart.value, mount: () => { chart!.createIndicator({ name: 'KDJ', styles: { lines: [{ color: '#f2f2f2' }, { color: '#f5c343' }, { color: '#d446d6' }] } }, false) } },
}
function applySubchartPanes(): void {
  if (!chart) return
  for (const name of ['VOL', 'MACD', 'KDJ'] as ToggleableIndicator[]) {
    const existing = chart.getIndicators({ name })
    if (SUBCHART_PREFS[name].enabled() && !existing.length) SUBCHART_PREFS[name].mount()
    else if (!SUBCHART_PREFS[name].enabled() && existing.length) chart.removeIndicator({ name })
  }
}
function drawings(): Drawing[] {
  return chart ? serializeDrawings(chart.getOverlays().filter(overlay => !(textPanel.value?.isNew && textPanel.value.id === overlay.id)), paneName, renderedBasis ?? undefined, props.timeframe) : []
}
function notifyHistory(): void { emit('historyChange', { undo: drawingHistory.canUndo, redo: drawingHistory.canRedo }) }
function recordDrawings(): void {
  if (props.readOnly || restoringDrawings || disposed || !restoredDrawings) return
  const snapshot = drawings()
  if (drawingHistory.record(snapshot)) { notifyHistory(); emit('drawingsChange', snapshot) }
}
// REC-CHART-C 语义操作上报（docs/engineering/recording-contract.md）：每次真实且成功的用户操作恰好
// 一条 operation；只读、恢复图形（restoringDrawings）与卸载后绝不外发。params 只带有限 JSON 的
// 语义图形（id/name/paneId/points），不透出库实例。
function emitOperation(action: Action, params?: JsonValue): void {
  if (props.readOnly || restoringDrawings || disposed) return
  emit('operation', params === undefined ? { action } : { action, params })
}
function findDrawing(id: string): Drawing | null { return drawings().find(drawing => drawing.id === id) ?? null }
// move 去重：window pointerup 兜底（completePointerAction）会抢在 onPressedMoveEnd 之前把同一快照
// 写进历史，history.record 的布尔已被竞争消费，不能作为动作依据；改为按"overlayID＋最近一次已上报
// 快照"比较（纯助手见 recording/drawingOperations.ts），只有终态快照真的变化才发 move。
// 基线表由 restoreDrawings 整体重播种、删除路径逐 id 清除，保证与当前图形集合精确同步。
const lastReportedDrawing: ReportedDrawings = new Map()
function emitMoveIfChanged(id: string): void {
  const drawing = findDrawing(id)
  if (!drawing) return
  if (!hasUnreportedMove(lastReportedDrawing, drawing)) return
  markDrawingReported(lastReportedDrawing, drawing)
  emitOperation('chart.drawing.move', drawingOperationParams(drawing))
}
function emitDrawingAction(action: Action, id: string): void {
  const drawing = findDrawing(id)
  if (!drawing) return
  markDrawingReported(lastReportedDrawing, drawing)
  emitOperation(action, drawingOperationParams(drawing))
}
function restoreDrawings(items: Drawing[], resetHistory = false): void {
  if (!chart) return
  restoringDrawings = true
  // 首个可靠载入基准：旧无基准画线保留原值并采用之，带基准画线投影到当前基准（不猜创建日期）；
  // 撤销/重做恢复的历史快照各带自身基准，同路径投影回当前基准。
  if (!renderedBasis) renderedBasis = currentDrawingPriceBasis()
  if (renderedBasis) items = adoptDrawings(items, renderedBasis)
  deselectLibrarySelected()
  closePanels()
  cancelDrawing()
  for (const overlay of chart.getOverlays()) if (!engineMarkNames.has(overlay.name)) chart.removeOverlay({ id: overlay.id })
  for (const item of items) {
    // 只读＝纯展示：lock+ignoreEvent 让保存画线只渲染，不进库的选中/拖动/右键交互链
    const fixedArrowStyle = item.name === 'bullArrow' || item.name === 'bearArrow'
      ? { line: { color: item.name === 'bullArrow' ? '#ef4444' : '#16a34a' } }
      : configuredOverlayStyle(item.name)
    const id = chart.createOverlay({ ...item, styles: fixedArrowStyle, paneId: actualPaneId(item.paneId), ...drawingEvents(), mode: props.magnet ?? 'weak_magnet', lock: props.readOnly, ignoreEvent: props.readOnly } as OverlayCreate)
    if (item.name === 'polyline' && id) {
      const overlay = chart.getOverlays({ id: id as string })[0] as unknown as { forceComplete: () => void }
      overlay?.forceComplete()
      ;(chart as any).getChartStore().progressOverlayComplete()
    }
  }
  clearMultiSelection()
  selectedOverlayId.value = null
  restoringDrawings = false
  if (resetHistory) { restoredDrawings = true; drawingHistory.reset(items); notifyHistory() }
  // 基线表精确同步到当前序列化图形：加载/撤销/重做/清空后旧快照与陈旧 id 一律作废——
  // 否则已加载/已撤销图形的首次按压被误报 move，移回旧端点的真实 move 被旧指纹吞掉
  syncReportedDrawings(lastReportedDrawing, drawings())
  updateAnchorDots()
}
function undoDrawing(): void { if (props.readOnly) return; const state = drawingHistory.undo(); if (state) { restoreDrawings(state); notifyHistory(); emit('drawingsChange', state); emitOperation('chart.drawing.undo') } }
function redoDrawing(): void { if (props.readOnly) return; const state = drawingHistory.redo(); if (state) { restoreDrawings(state); notifyHistory(); emit('drawingsChange', state); emitOperation('chart.drawing.redo') } }
function clearDrawings(): void {
  if (props.readOnly || !chart || !drawings().length || !window.confirm('清空当前训练的全部画线？')) return
  const cleared = drawings().length
  restoreDrawings([])
  recordDrawings()
  emitOperation('chart.drawing.clear', { count: cleared })
}

function clampCount(value: number): number { return Math.min(MAX_COUNT, Math.max(MIN_COUNT, value)) }
function minimumBarSpace(): number { return Math.max(0.1, (chart?.getSize('candle_pane', 'main')?.width ?? 0) / (MAX_COUNT - 1)) }
function clampBarSpace(space: number): number { return Math.min(BAR_SPACE_MAX, Math.max(minimumBarSpace(), space)) }
function enforceVisibleLimit(): void {
  if (!chart) return
  const min = minimumBarSpace()
  if (chart.getBarSpace().bar < min) chart.setBarSpace(min)
}
function dateTimestamp(date: string): number { return Date.parse(`${date.length === 7 ? `${date}-01` : date}T00:00:00Z`) }
// date 必须随对象保留：动态加载的 before 参数取自 loadedData[0].date（KLineData 本身只有 timestamp）；
// amount 同理：捕获还原 Bar 需要原始成交额，toK 丢弃会让捕获假造/缺额。
// 字段顺序保持 volume→date 收尾（M2 frontend-contract 断言依赖该字面量结尾）
function toK(bar: Bar): KLineData & { date: string; amount: number } { return { timestamp: dateTimestamp(bar.date), open: bar.open, high: bar.high, low: bar.low, close: bar.close, amount: bar.amount, volume: bar.volume, date: bar.date } }

function maHistoryMissing(): number {
  const warmup = maWarmup(appMaSettings.value)
  return warmup > 200 ? Math.max(0, MAX_VISIBLE_BARS + warmup - loadedData.length) : 0
}
function ensureMaHistory(): void {
  if (disposed || props.readOnly || !chart || !props.fetchEarlier || !hasMoreForward || loadingForward || !maHistoryMissing()) return
  // 10.0.3 has no public prepend method. Use its existing loader so the forward
  // callback preserves timestamps, viewport offset, overlays and indicator calculation.
  ;(chart as unknown as { getChartStore(): { _processDataLoad(type: 'forward'): void } }).getChartStore()._processDataLoad('forward')
}
async function loadEarlierBars(callback: (data: KLineData[], more?: DataLoadMore) => void): Promise<void> {
  const first = loadedData[0] as (KLineData & { date?: string }) | undefined
  if (!first?.date || loadingForward || !props.fetchEarlier) { callback([], { forward: hasMoreForward }); return }
  loadingForward = true
  const version = dataVersion
  const forMa = maHistoryMissing() > 0
  let succeeded = false
  try {
    // 库的 forward 前插是自锚定的（可见范围按 diff+total 推算，diff 不变 → 同名日期不动），
    // 不要再做任何锚定/补偿滚动——额外滚动会把滚动差值打到负极限，引发视图塌缩与加载风暴
    const result = await props.fetchEarlier(first.date, forMa ? Math.min(1000, maHistoryMissing()) : LOAD_CHUNK_BARS)
    if (disposed || version !== dataVersion) return
    const older = result.bars.map(toK)
    if (older.length) loadedData = [...older, ...loadedData]
    result.hasMore = result.hasMore && older.length > 0
    hasMoreForward = result.hasMore
    callback(older, { forward: result.hasMore })
    scheduleChartCapture()
    succeeded = true
    maHistoryError.value = ''
  } catch {
    if (!disposed && version === dataVersion) callback([], { forward: hasMoreForward })
    if (!disposed && version === dataVersion && forMa) maHistoryError.value = '均线历史加载失败'
  } finally {
    if (version === dataVersion) {
      loadingForward = false
      if (succeeded) queueMicrotask(ensureMaHistory)
    }
  }
}

function feedData(): void {
  if (!chart) return
  // 数据替换即作废信息卡锚点（旧内容对应旧序列，等待下一次十字线更新重建）
  hideHoverCard()
  // A timeframe change rebuilds the chart surface. Restore only drawings that
  // belong to the new period; the parent supplies the filtered snapshot.
  restoredDrawings = false
  drawingHistory.reset([])
  clearMultiSelection()
  closePanels()
  maHistoryError.value = ''
  dataVersion++
  // 新数据版本＝视窗布局重建：同 view 也必须重放（appliedReplayView 去重只作用于同一数据版本内）
  appliedReplayView = null
  // 数据替换即作废挂起的视窗上报：旧数据上的用户手势不得在新 timeframe 数据上落账
  cancelViewportOperation()
  loadingForward = false
  chart.setPeriod({ type: props.timeframe === '1W' ? 'week' : props.timeframe === '1M' ? 'month' : 'day', span: 1 })
  loadedData = props.bars.map(toK)
  hasMoreForward = props.hasMoreBars
  chart.setDataLoader({
    getBars: ({ type, callback }) => {
      if (type === 'forward') { void loadEarlierBars(callback); return }
      if (type === 'update') return
      // 10.0.3 在 callback 内同步应用初始数据：回放恢复排到一帧之后（等本次 feed 的默认视窗与
      // 布局落定，挂载时不被 resetView 覆盖），恢复完成后再调度首次捕获
      callback(loadedData, { forward: hasMoreForward, backward: false })
      scheduleReplayRestore()
      scheduleChartCapture()
      queueMicrotask(ensureMaHistory)
    },
  })
  applyLastPriceStyle()
  refreshMarks()
}

// REC-CHART 图表捕获（docs/engineering/recording-contract.md）：captureState 只读库内已加载数据
// （含补载历史，绝不限 props.bars）；feed 完成/补历史/视窗变化后 150ms 尾沿外发不可变 chartCapture；
// 只读回放与 replayView 程序恢复期间静默，避免捕获-恢复反馈循环。
function semanticPaneHeights(): Record<string, number> {
  const heights: Record<string, number> = {}
  if (!chart) return heights
  const panes = chart.getPaneOptions()
  const list = (Array.isArray(panes) ? panes : [panes]) as Array<{ id: string }>
  for (const pane of list) {
    if (pane.id === 'x_axis_pane') continue
    const height = chart.getSize(pane.id)?.height ?? 0
    if (Number.isFinite(height) && height > 0) heights[paneName(pane.id)] = height
  }
  return heights
}
function captureState(): ChartCapture {
  if (!chart) throw new Error('K线图未初始化，无法生成图表捕获')
  const data = chart.getDataList() as Array<CaptureSourceBar>
  const range = chart.getVisibleRange()
  const view = captureView({ fromIndex: range.from, toIndex: range.to, data, barSpace: chart.getBarSpace().bar, paneHeights: semanticPaneHeights() })
  return buildChartCapture({ timeframe: props.timeframe, bars: toCaptureBars(data), drawings: drawings(), view, costPrice: props.chartCostPrice ?? props.costPrice })
}
let captureTimer: ReturnType<typeof setTimeout> | null = null
function cancelChartCapture(): void {
  if (captureTimer !== null) { clearTimeout(captureTimer); captureTimer = null }
}
function scheduleChartCapture(): void {
  if (props.readOnly || restoringView || disposed || !chart) return
  cancelChartCapture()
  captureTimer = setTimeout(() => {
    captureTimer = null
    if (disposed || props.readOnly || restoringView || !chart) return
    try {
      emit('chartCapture', captureState())
    } catch (error) {
      // 定时器里的抛错父层接不到（emit 未执行、无处 try/catch）：转成 captureError 供录制层展示；
      // 只读回放静默；直接调用 captureState（expose）依旧原样抛出
      if (!disposed && !props.readOnly) emit('captureError', error instanceof Error ? error.message : String(error))
    }
  }, VIEWPORT_CAPTURE_THROTTLE_MS)
}
// chart.viewport 只认真实用户导航：wheel 平移、框选/轴缩放/窗格分隔拖动结束、中键平移结束、
// zoomBy/resetView 的用户调用。初始化 feed、默认 reset、补历史、replayView 恢复与布局 resize
// 不经这些入口，绝不冒充用户；恢复视窗前撤销挂起的上报，避免把恢复结果当作用户操作。
let viewportOpTimer: ReturnType<typeof setTimeout> | null = null
function cancelViewportOperation(): void {
  if (viewportOpTimer !== null) { clearTimeout(viewportOpTimer); viewportOpTimer = null }
}
function scheduleViewportOperation(): void {
  if (props.readOnly || disposed) return
  cancelViewportOperation()
  viewportOpTimer = setTimeout(() => {
    viewportOpTimer = null
    if (disposed || props.readOnly || restoringView || !chart) return
    const barSpace = chart.getBarSpace().bar
    if (!Number.isFinite(barSpace) || barSpace <= 0) return
    const range = chart.getVisibleRange()
    const view = captureView({ fromIndex: range.from, toIndex: range.to, data: chart.getDataList(), barSpace, paneHeights: semanticPaneHeights() })
    emitOperation('chart.viewport', { fromTimestamp: view.fromTimestamp, toTimestamp: view.toTimestamp, barSpace: view.barSpace, paneHeights: view.paneHeights })
  }, VIEWPORT_CAPTURE_THROTTLE_MS)
}
// replayView 恢复：feed 完成布局后按时间戳重定位右侧锚点（不套旧 dataIndex）、恢复 barSpace
// 与语义窗格高度；相同 view 不重复恢复，恢复期间静默捕获（库的视窗 action 为同步派发）。
let appliedReplayView: string | null = null
let restoringView = false
function applyReplayView(view: ChartCaptureView | undefined): void {
  if (!view || !chart || disposed || !loadedData.length) return
  const key = JSON.stringify(view)
  if (appliedReplayView === key) return
  appliedReplayView = key
  restoringView = true
  cancelChartCapture()
  cancelViewportOperation()
  try {
    for (const [name, height] of Object.entries(view.paneHeights)) {
      if (!Number.isFinite(height) || height <= 0) continue
      // 语义副图当前不存在（如录像带 KDJ 高度但 KDJ 偏好已关）：跳过该项，
      // 不得把副图高度写回 fallback 的 candle_pane（回放按当前开关渲染，M6-01 边界）
      if (name !== 'candle_pane' && actualPaneId(name) === 'candle_pane') continue
      chart.setPaneOptions({ id: actualPaneId(name), height })
    }
    if (Number.isFinite(view.barSpace) && view.barSpace > 0) chart.setBarSpace(view.barSpace)
    const anchor = view.toTimestamp ?? view.fromTimestamp
    if (anchor !== null && Number.isFinite(anchor)) chart.scrollToTimestamp(anchor)
  } finally {
    queueMicrotask(() => { restoringView = false })
  }
}
// 回放恢复的排程：挂载序是 feedData→resetView 同步完成，loader 回调内若同步恢复会被默认视窗覆盖，
// 因此借 rAF 排到本次 feed 的同步收尾与布局之后；恢复完成再补调度捕获（applyReplayView 会先取消恢复前的旧定时器）。
let replayRestoreFrame: number | null = null
function cancelReplayRestore(): void {
  if (replayRestoreFrame !== null) { cancelAnimationFrame(replayRestoreFrame); replayRestoreFrame = null }
}
function scheduleReplayRestore(): void {
  if (!props.replayView) return
  cancelReplayRestore()
  replayRestoreFrame = requestAnimationFrame(() => {
    replayRestoreFrame = null
    if (disposed || !chart || !props.replayView) return
    applyReplayView(props.replayView)
    scheduleChartCapture()
  })
}
watch(() => props.replayView, view => { if (view) applyReplayView(view) })
// 国内口径：最新价线线体/轴标签的方向色由 klinecharts 按 priceMark.last.upColor 系
// （相对前收，见 theme.ts）自动计算；这里按同一口径（涨跌相对前收）重涂标签底色，
// 保证标签与线体一致。跳空日阴阳与涨跌可能相反，不能按当日阴阳取色。
function applyLastPriceStyle(): void {
  if (!chart) return
  const last = props.bars.at(-1)
  const prev = props.bars.at(-2)
  const color = hasPhasePrice(props.currentPrice) ? currentPriceColor() : phasePriceColor(last?.close, prev?.close)
  // 有阶段执行价时，阶段线负责唯一的线体和轴标签；内置最新价只在没有阶段价时使用。
  const showLastMark = !hasPhasePrice(props.currentPrice)
  chart.setStyles({ candle: { priceMark: { last: { show: showLastMark, upColor: color, downColor: color, noChangeColor: color, text: { color: '#ffffff' } } } } })
}

function configurePhasePriceRange(): void {
  if (!chart) return
  // 正常纵轴在最新视窗纳入阶段执行价；浏览历史、手动纵轴缩放及副图保持原有范围规则。
  // overrideYAxis 会重设自动范围标志，故只在挂载时注册一次，不随主题/订单刷新调用。
  chart.overrideYAxis({ paneId: 'candle_pane', createRange: ({ defaultRange, chart: source }) => includePhasePriceRange(defaultRange, source.getVisibleRange().to >= source.getDataList().length ? props.currentPrice : null) })
}

function currentPriceColor(): string {
  return phasePriceColor(props.currentPrice, props.previousClose)
}

function tradeTimestamp(date: string): number {
  if (props.timeframe === '1W') { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day.getTime() }
  if (props.timeframe === '1M') return Date.parse(`${date.slice(0, 7)}-01T00:00:00Z`)
  return Date.parse(`${date}T00:00:00Z`)
}

function refreshMarks(): void {
  if (!chart) return
  chart.removeOverlay({ name: 'bsMark' }); chart.removeOverlay({ name: 'costLine' }); chart.removeOverlay({ name: 'phasePriceLine' }); chart.removeOverlay({ name: 'orderTriggerMark' })
  orderTooltip.value = null
  for (const trade of props.trades) chart.createOverlay({ name: 'bsMark', points: [{ timestamp: tradeTimestamp(trade.date), value: trade.chartPrice ?? trade.price }], extendData: { side: trade.side, shares: trade.shares, price: trade.chartPrice ?? trade.price } })
  const cost = props.chartCostPrice ?? props.costPrice
  if (cost !== null && cost > 0) chart.createOverlay({ name: 'costLine', points: [{ value: cost }], extendData: cost })
  if (hasPhasePrice(props.currentPrice)) {
    chart.createOverlay({ name: 'phasePriceLine', points: [{ value: props.currentPrice }], extendData: { price: props.currentPrice, color: currentPriceColor() }, lock: true })
  }
  for (const order of props.orders.filter(order => order.status === 'pending')) {
    chart.createOverlay({ name: 'orderTriggerMark', points: [{ value: order.triggerPrice }], extendData: { side: order.side, orderType: order.orderType, triggerPrice: order.triggerPrice, shares: order.shares, status: order.status } })
  }
  applyLastPriceStyle()
  updateMarkerRail()
}

// 挂单触发点命中检测：指针落在任一挂单标记（价格轴圆点，横向触达区 98px、纵向 ±12px）上时
// 返回命中的挂单，按纵向距离就近排序；多笔挂单标记重叠时全部返回，悬浮层合并展示。
function hitPendingOrders(clientX: number, clientY: number): OrderView[] {
  if (!chart || !host.value) return []
  const pending = props.orders.filter(order => order.status === 'pending')
  if (!pending.length) return []
  const rect = host.value.getBoundingClientRect()
  const axis = chart.getSize('candle_pane', 'yAxis')
  const markerX = rect.left + (axis?.left ?? 0) - 7
  if (clientX < markerX - 86 || clientX > markerX + 12) return []
  const hits: Array<{ order: OrderView; distance: number }> = []
  for (const order of pending) {
    const point = chart.convertToPixel({ value: order.triggerPrice }, { paneId: 'candle_pane', absolute: true })
    const y = rect.top + (point.y ?? Number.NaN)
    if (!Number.isFinite(y)) continue
    const distance = Math.abs(clientY - y)
    if (distance <= 12) hits.push({ order, distance })
  }
  return hits.sort((a, b) => a.distance - b.distance).map(hit => hit.order)
}

// 挂单悬浮信息（用户 1.2.3 拍板：悬停显示、移开消失，取代 1.2.2 的点击显示）：
// 定位锚定触发点标记左上并钳制在图表宿主内（不随指针漂移）；命中多笔时合并展示。
function showOrderTooltip(orders: OrderView[]): void {
  if (!chart || !host.value || !orders.length) return
  const rect = host.value.getBoundingClientRect()
  const axis = chart.getSize('candle_pane', 'yAxis')
  const anchor = chart.convertToPixel({ value: orders[0].triggerPrice }, { paneId: 'candle_pane', absolute: true })
  const x = clampToHost((axis?.left ?? 0) - 190, 234, rect.width)
  const y = clampToHost((anchor.y ?? 0) - 28, 120, rect.height)
  const text = orders.map(orderTooltipText).join('\n')
  if (orderTooltip.value?.text === text && orderTooltip.value.x === x && orderTooltip.value.y === y) return
  orderTooltip.value = { x, y, text }
}

function orderTooltipText(order: OrderView): string {
  const direction = orderTriggerDirection(order) === 'up' ? '上触' : '下触'
  return `${order.side === 'buy' ? '买入' : '卖出'} · ${order.orderType === 'limit' ? '限价' : '止损'} · ${direction}触发价 ${order.triggerPrice.toFixed(2)} · ${order.shares} 股${order.reason ? `\n理由：${order.reason}` : ''}`
}

// 价格轴手动缩放（拖动/滚轮）会把 klinecharts 纵轴置为手动模式（范围冻结，双击价格轴是库内解除方式）。
// 我们的框选/键盘/复位缩放会改变可见 K 线，若纵轴仍冻结就不再自动适配，图表会整体漂移乃至移出视图；
// 因此这类缩放前必须恢复纵轴自动适配（buildTicks 在 flag=true 时按可见数据重建范围）。
function restoreYAxisAutoFit(): void {
  if (!chart) return
  const axes = chart.getYAxes({}) as unknown as Array<{ setAutoCalcTickFlag?: (flag: boolean) => void }>
  for (const axis of axes) axis.setAutoCalcTickFlag?.(true)
}
function visibleCount(): number { if (!chart) return 0; const range = chart.getVisibleRange(); return clampCount(Math.round(Math.max(1, range.to - range.from))) }
function zoomBy(factor: number): void {
  if (!chart || !Number.isFinite(factor) || factor <= 0 || factor === 1) return
  const range = chart.getVisibleRange()
  const count = Math.max(1, range.to - range.from)
  const next = clampCount(Math.round(count * factor))
  const width = chart.getSize('candle_pane')?.width ?? 800
  // Few recorded bars can round to the same count; zoom their spacing instead
  // of swallowing the key. clampBarSpace still owns the 1..840 viewport limits.
  const space = next === count ? chart.getBarSpace().bar / factor : (width - RIGHT_MARGIN) / next
  restoreYAxisAutoFit()
  chart.setBarSpace(clampBarSpace(space))
  chart.scrollToDataIndex(range.to - 1)
  emit('visibleCount', visibleCount())
  scheduleViewportOperation()
}
function moveCrosshair(delta: number): void { if (!chart) return; const range = chart.getVisibleRange(); if (crossIndex < range.from || crossIndex >= range.to) crossIndex = range.to - 1; crossIndex = Math.min(range.to - 1, Math.max(range.from, crossIndex + delta)); const bar = chart.getDataList()[crossIndex]; if (!bar) return; const pixel = chart.convertToPixel({ dataIndex: crossIndex, value: bar.close }, { paneId: 'candle_pane' }); const pane = chart.getSize('candle_pane'); const anchorY = pane ? pane.top + pane.height / 2 : 100; chart.executeAction('onCrosshairChange', { x: pixel?.x ?? 0, y: anchorY, paneId: 'candle_pane' }); showHoverCardNow(crossIndex, pixel?.x ?? 0, anchorY) }
// 复位视窗：只有 userInitiated 复位（回到最新按钮、Home 键）算用户导航并上报 chart.viewport。
// 挂载初始化与父层的程序化复位（timeframe/数据加载）必须传 resetView(false)，绝不冒充用户操作
function resetView(userInitiated = true): void { if (!chart) return; crossIndex = -1; chart.executeAction('onCrosshairChange', {}); hideHoverCard(); restoreYAxisAutoFit(); const width = chart.getSize('candle_pane')?.width ?? 800; chart.setBarSpace(Math.max(2, (width - RIGHT_MARGIN) / props.defaultCount)); chart.scrollToRealTime(0); emit('visibleCount', props.defaultCount); if (userInitiated) scheduleViewportOperation() }
function selectionRect(): HTMLElement | null { return host.value?.parentElement?.querySelector('.select-rect') ?? null }
// 计算框选绘图区边界：右缘＝主图价格轴 bounding.left（getSize 的 right/bottom 恒 0，只能用 left+width），
// 底缘＝时间轴 pane（x_axis_pane）的 top，顶缘＝主图 pane 的 top。
function computePlotBounds(): void {
  plotBounds = null
  if (!chart || !hostRect) return
  const yAxis = chart.getSize('candle_pane', 'yAxis')
  const xAxis = chart.getSize('x_axis_pane')
  const pane = chart.getSize('candle_pane')
  if (!yAxis || !xAxis || !pane) return
  plotBounds = { right: yAxis.left, top: pane.top, bottom: xAxis.top }
}
// 框选坐标钳制在绘图区内：指针拖进价格轴/训练控制台时，选中框与缩放范围都止步于绘图区边界。
function hostX(clientX: number): number {
  if (!hostRect) hostRect = host.value?.getBoundingClientRect() ?? null
  const x = clientX - (hostRect?.left ?? 0)
  return Math.max(0, Math.min(plotBounds?.right ?? hostRect?.width ?? x, x))
}
function paneIdAt(clientY: number): string | null {
  if (!chart) return null
  hostRect = host.value?.getBoundingClientRect() ?? null
  const y = clientY - (hostRect?.top ?? 0)
  const panes = chart.getPaneOptions()
  const list = (Array.isArray(panes) ? panes : [panes]) as Array<{ id: string }>
  for (const pane of list) {
    const size = chart.getSize(pane.id)
    if (size && y >= size.top && y < size.top + size.height) return pane.id
  }
  return null
}
// 图层约定：框选缩放只属于主图背景层，仅在 candle_pane 区域按下左键时启动；
// VOL/MACD/KDJ 副图与坐标轴区域不触发框选。B/S 标记与成本线是 ignoreEvent 的纯渲染层，
// 不拦截指针事件，因此不会与框选互相干扰。
// 价格轴（主图 y 轴）区域判定：klinecharts 原生在轴上滚轮缩放纵轴比例。
// 平移、框选都必须避开该区域，避免与纵轴缩放互相干扰（用户口径：两种滚轮逻辑分离）。
// 注意：getSize 的 bounding 只可靠提供 left/top/width/height（right/bottom 恒 0）
function isOverPriceAxis(clientX: number, clientY: number): boolean {
  if (!chart) return false
  if (!hostRect) hostRect = host.value?.getBoundingClientRect() ?? null
  if (!hostRect) return false
  const x = clientX - hostRect.left
  const y = clientY - hostRect.top
  // 主图与副图地位相同（用户 D4 验收拍板）：任一绘图 pane 的 y 轴区域都按"轴"处理
  const panes = chart.getPaneOptions()
  const list = (Array.isArray(panes) ? panes : [panes]) as Array<{ id: string }>
  for (const pane of list) {
    if (pane.id === 'x_axis_pane') continue
    const zone = chart.getSize(pane.id, 'yAxis')
    if (!zone) continue
    if (x >= zone.left && x <= zone.left + zone.width && y >= zone.top && y <= zone.top + zone.height) return true
  }
  return false
}
// 绘图 pane 判定：主图与副图同权（x 轴除外）——框选/多选/Ctrl 点选/按线补齐在各绘图 pane 同规则
function isDrawPane(paneId: string | null): boolean {
  return !!paneId && paneId !== 'x_axis_pane'
}
function isOverPaneSeparator(event: MouseEvent | PointerEvent): boolean {
  if (!chart || !host.value) return false
  const separators = (chart as unknown as {
    getSeparatorPanes: () => Map<unknown, {
      getBounding: () => { left: number; top: number; width: number; height: number }
      getWidget: () => { getContainer: () => HTMLElement }
    }>
  }).getSeparatorPanes()
  const hostBounds = host.value.getBoundingClientRect()
  const x = event.clientX - hostBounds.left, y = event.clientY - hostBounds.top
  for (const separator of separators.values()) {
    const bounds = separator.getBounding()
    if (bounds.height <= 0) continue
    const container = separator.getWidget().getContainer()
    // Match v10's full separator hit band, including its margins and fill/y-axis width.
    const height = container.offsetHeight
    const top = bounds.top - Math.round((height - chart.getStyles().separator.size) / 2)
    const targetInside = event.target instanceof Node && container.contains(event.target)
    if (targetInside || (x >= bounds.left && x <= bounds.left + bounds.width && y >= top && y <= top + height)) return true
  }
  return false
}
function beginPaneResize(event: PointerEvent): void {
  paneResizePointerId = event.pointerId
  selecting = false
  multiDragStart = null
  multiBounds = null
  multiRect.value = null
  axisScaleDrag = false
  plotBounds = null
  chart?.setScrollEnabled(!props.drawTool)
  const rect = selectionRect(); if (rect) rect.style.display = 'none'
}
function onPaneResizeCancel(event: PointerEvent): void {
  if (event.pointerId === paneResizePointerId) paneResizePointerId = null
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !chart) return
  // Native separator drag owns the whole gesture; its widget applies dragEnabled/min-height rules.
  if (isOverPaneSeparator(event)) { beginPaneResize(event); return }
  // 画线模式下不启动框选：事件放行给 klinecharts overlay 取点交互（三态模式机隔离）
  if (props.drawTool) return
  // 主图与副图同权：框选缩放/多选框选在任一绘图 pane 启动（用户 D4 验收拍板：操作逻辑主副图一致）
  if (!isDrawPane(paneIdAt(event.clientY))) return
  hostRect = host.value?.getBoundingClientRect() ?? null
  // 指针命中用户画线：放行给库内选择/拖拽，不启动框选——否则拖动已画线段会触发框选缩放（用户 D1 验收反馈）
  if (hitTestUserOverlay(event.clientX, event.clientY)) return
  if (isOverPriceAxis(event.clientX, event.clientY)) return
  // 空白按下＝点击了画线以外区域：立即解除库内持久选中态（用户 D4 验收拍板，
  // 框选拦截会吞掉库的空白 click 解除链路，必须主动解除——否则端点常显假选中）
  deselectLibrarySelected()
  // 多选模式：绘图 pane 空白的框选拖拽变为划线批量选中（不缩放 K 线；平移走中键、缩放走键盘）
  if (props.multiSelect) {
    const sx = event.clientX - (hostRect?.left ?? 0)
    const sy = event.clientY - (hostRect?.top ?? 0)
    multiDragStart = { x: sx, y: sy }
    computePlotBounds()
    multiBounds = plotBounds
    multiRect.value = { left: sx, top: sy, width: 0, height: 0 }
    return
  }
  selecting = true
  computePlotBounds()
  selectStartX = hostX(event.clientX)
  chart.setScrollEnabled(false)
  const rect = selectionRect(); if (rect) { rect.style.left = `${selectStartX}px`; rect.style.width = '0px'; rect.style.display = 'block'; if (plotBounds) { rect.style.top = `${plotBounds.top}px`; rect.style.height = `${Math.max(0, plotBounds.bottom - plotBounds.top)}px` } }
}
function onPointerMove(event: PointerEvent): void {
  if (paneResizePointerId !== null) return
  // M6-03 信息卡可见性跟随十字线：库在指针移到价格轴/时间轴/分隔条时不派发 onCrosshairChange
  // 但已清除十字线，这里兜底隐藏（指针在图表外或轴区都不该有卡；挂起中的停留计时一并取消）
  if ((hoverCard.value !== null || hoverTimer !== null) && host.value) {
    hostRect = host.value.getBoundingClientRect()
    const outside = event.clientX < hostRect.left || event.clientX > hostRect.right || event.clientY < hostRect.top || event.clientY > hostRect.bottom
    if (outside || isOverPriceAxis(event.clientX, event.clientY) || !isDrawPane(paneIdAt(event.clientY))) hideHoverCard()
  }
  // 挂单标记悬停信息：无按键移动时命中即显示、离开标记区即隐藏（拖拽与框选期间不打扰）
  if (event.buttons === 0 && !selecting && !multiDragStart && !props.drawTool) {
    const hits = hitPendingOrders(event.clientX, event.clientY)
    if (hits.length) showOrderTooltip(hits)
    else if (orderTooltip.value) orderTooltip.value = null
  }
  if (host.value && !props.drawTool && event.buttons === 0) {
    hostRect = host.value.getBoundingClientRect()
    host.value.style.cursor = hitTestUserOverlay(event.clientX, event.clientY) ? 'pointer' : ''
  }
  // 纵轴缩放拖拽中：把指针位置重路由回轴区域，库原生缩放持续生效（与框选互斥）
  if (axisScaleDrag) { dispatchSyntheticAxisMove(event); return }
  // 有多选成员时实时跟随（拖拽画线/端点时库移动 points，dots 须同步）
  if (multiSelectedIds.value.length) updateAnchorDots()
  // 多选模式橡皮筋矩形更新（钳制在绘图区内，口径修订七）
  if (multiDragStart) {
    const cur = {
      x: Math.min(Math.max(event.clientX - (hostRect?.left ?? 0), 0), multiBounds?.right ?? Number.MAX_SAFE_INTEGER),
      y: Math.min(Math.max(event.clientY - (hostRect?.top ?? 0), multiBounds?.top ?? 0), multiBounds?.bottom ?? Number.MAX_SAFE_INTEGER),
    }
    multiRect.value = {
      left: Math.min(multiDragStart.x, cur.x),
      top: Math.min(multiDragStart.y, cur.y),
      width: Math.abs(cur.x - multiDragStart.x),
      height: Math.abs(cur.y - multiDragStart.y),
    }
    return
  }
  if (!selecting) return
  const current = hostX(event.clientX); const rect = selectionRect()
  if (rect) { rect.style.left = `${Math.min(selectStartX, current)}px`; rect.style.width = `${Math.abs(current - selectStartX)}px` }
}
function onPointerUp(event: PointerEvent): void {
  if (event.pointerId === paneResizePointerId) { paneResizePointerId = null; scheduleViewportOperation(); return }
  // 中键释放：库的 mouseUp 处理只认左键（button=1 直接 return），补发合成左键 mouseup
  // 让库完成滚动状态清理——否则残留的 _startScrollCoordinate 会让松键后的自由移动鼠标持续平移
  if (event.button === 1 && chart) {
    const container = host.value?.firstElementChild as HTMLElement | null
    container?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: event.clientX, clientY: event.clientY }))
    scheduleViewportOperation()
  }
  // 纵轴缩放拖拽结束（松手才算完成一次交互）
  if (axisScaleDrag) { axisScaleDrag = false; scheduleViewportOperation(); return }
  // 多选模式框选结束：矩形相交的画线加入多选集合；极小框选＝点空白，清空多选
  if (multiDragStart) {
    const cur = {
      x: Math.min(Math.max(event.clientX - (hostRect?.left ?? 0), 0), multiBounds?.right ?? Number.MAX_SAFE_INTEGER),
      y: Math.min(Math.max(event.clientY - (hostRect?.top ?? 0), multiBounds?.top ?? 0), multiBounds?.bottom ?? Number.MAX_SAFE_INTEGER),
    }
    const rect = {
      left: Math.min(multiDragStart.x, cur.x),
      top: Math.min(multiDragStart.y, cur.y),
      width: Math.abs(cur.x - multiDragStart.x),
      height: Math.abs(cur.y - multiDragStart.y),
    }
    if (rect.width > 4 && rect.height > 4) selectDrawingsInRect(rect)
    else clearMultiSelection()
    multiDragStart = null
    multiRect.value = null
    return
  }
  if (!selecting || !chart) return
  selecting = false; chart.setScrollEnabled(true)
  const rect = selectionRect(); if (rect) rect.style.display = 'none'
  const end = hostX(event.clientX)
  const width = chart.getSize('candle_pane')?.width ?? 800
  const drawable = Math.max(1, width - RIGHT_MARGIN)
  if (end >= selectStartX) {
    // 右滑：选中的 K 线范围放大到铺满主图（选中几根就放大到几根，柱宽上限见 BAR_SPACE_MAX）
    if (end - selectStartX < 12) return
    restoreYAxisAutoFit()
    const from = chart.convertFromPixel([{ x: selectStartX }], { paneId: 'candle_pane' })[0]?.dataIndex
    const to = chart.convertFromPixel([{ x: end }], { paneId: 'candle_pane' })[0]?.dataIndex
    if (from === undefined || to === undefined) return
    const count = clampCount(Math.abs(to - from) + 1)
    chart.setBarSpace(clampBarSpace(drawable / count)); chart.scrollToDataIndex(Math.max(from, to)); emit('visibleCount', count); scheduleViewportOperation()
  } else {
    // 左滑：按滑动距离占主图宽度的比例缩小，容纳更多 K 线；右端锚定不动。
    const dragWidth = selectStartX - end
    if (dragWidth < 12) return
    restoreYAxisAutoFit()
    const range = chart.getVisibleRange()
    const current = Math.max(1, range.to - range.from)
    const count = clampCount(Math.round(current * drawable / dragWidth))
    chart.setBarSpace(clampBarSpace(drawable / count)); chart.scrollToDataIndex(range.to - 1); emit('visibleCount', count); scheduleViewportOperation()
  }
}
function onPaneDblClick(event: MouseEvent): void {
  if (!chart || props.drawTool) return
  if (isOverPaneSeparator(event)) return
  const paneId = paneIdAt(event.clientY)
  if (!paneId || paneId === 'candle_pane' || paneId === 'x_axis_pane') return
  const panes = chart.getPaneOptions(); const list = (Array.isArray(panes) ? panes : [panes]) as Array<{ id: string; state?: string }>
  const maximized = list.find(pane => pane.id === paneId)?.state === 'maximize'
  for (const pane of list) if (pane.state === 'maximize' && pane.id !== paneId) chart.setPaneOptions({ id: pane.id, state: 'normal' })
  chart.setPaneOptions({ id: paneId, state: maximized ? 'normal' : 'maximize' })
}
// 用户画线命中判定：指针落在画线锚点（±8px）或线体（点到线段距离≤7px）上时，放行给库内选择/拖拽，
// 不启动框选——否则拖动已画线段会与框选缩放重叠（用户 D1 验收反馈）。阈值与计划 D25 hover 加粗一致。
// 返回命中的 overlay 实例（库内同一实例，供按下状态补齐），未命中返回 null。
function hitTestUserOverlay(clientX: number, clientY: number): OverlayLike | null {
  if (!chart || !hostRect) return null
  const x = clientX - hostRect.left
  const y = clientY - hostRect.top
  const overlays = (chart.getOverlays() as unknown as OverlayLike[]).filter(overlay => !engineMarkNames.has(overlay.name) && !overlay.isDrawing())
  const currentPane = paneIdAt(clientY)
  if (isOverPriceAxis(clientX, clientY)) return null
  for (const overlay of overlays.reverse()) {
    if (overlay.paneId !== currentPane) continue
    const { anchors, segs, polygon } = overlayHitGeometry(overlay)
    if (polygon && pointInPolygon({ x, y }, polygon)) return overlay
    // 锚点命中（±8px，始终用真实端点）
    for (const c of anchors) if (Math.hypot(c.x - x, c.y - y) <= 8) return overlay
    // 线体命中（≤7px）：射线/直线的线段已按图元覆盖范围延伸——延伸段同样可选中（用户 D3 验收反馈）
    for (const seg of segs) {
      const [a, b] = seg
      if (distanceToSegment(x, y, a, b) <= 7) return overlay
    }
  }
  return null
}
function distanceToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x; const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(px - a.x, py - a.y)
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSq))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}
function onWheel(event: WheelEvent): void {  event.preventDefault()
  // 价格轴上滚轮＝klinecharts 原生纵轴比例缩放（不平移）；其余区域滚轮＝K 线平移
  if (isOverPriceAxis(event.clientX, event.clientY)) return
  chart?.scrollByDistance(event.deltaY !== 0 ? event.deltaY : event.deltaX, 0)
  scheduleViewportOperation()
}

onMounted(() => { if (!host.value) return; chart = init(host.value, { locale: 'zh-CN', timezone: 'Asia/Shanghai', styles: chartStyles(theme.value) }) as RuntimeChart | null; if (!chart) return; const layout = (chart as unknown as { _chartStore?: { getLayoutOptions?: () => { barSpaceLimit?: { min?: number; max?: number } } } })._chartStore?.getLayoutOptions?.(); if (layout?.barSpaceLimit) { layout.barSpaceLimit.min = 0.1; layout.barSpaceLimit.max = BAR_SPACE_MAX; } chart.setSymbol({ ticker: 'training', pricePrecision: 2, volumePrecision: 0 }); chart.setPeriod({ type: 'day', span: 1 }); chart.setOffsetRightDistance(RIGHT_MARGIN); chart.setZoomEnabled(false); chart.setLeftMinVisibleBarCount(MIN_COUNT); chart.setRightMinVisibleBarCount(1); chart.createIndicator({ name: 'MA', calcParams: [25, 60, 144], paneId: 'candle_pane', styles: { lines: [{ color: '#f5a623' }, { color: '#54b8cc' }, { color: '#c793e0' }] } }, true); applySubchartPanes(); chart.subscribeAction('onVisibleRangeChange', () => { emit('visibleCount', visibleCount()); updateAnchorDots(); scheduleChartCapture() }); chart.subscribeAction('onCrosshairChange', onCrosshairAction); host.value.addEventListener('mouseleave', hideHoverCard); host.value.addEventListener('wheel', onWheel, { passive: false }); host.value.addEventListener('pointerdown', onPointerDown, true); host.value.addEventListener('mousedown', onHostMouseDown, true); host.value.addEventListener('mousedown', onHostMouseDownBubble, false); host.value.addEventListener('dblclick', onPaneDblClick); host.value.addEventListener('contextmenu', suppressNativeContextMenu); window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); window.addEventListener('keydown', onPanelKeydown, true); window.addEventListener('pointerdown', onGlobalPointerDown, true); feedData(); resetView(false); if (import.meta.env.MODE === 'journey') { (window as unknown as { __trainerChart?: unknown }).__trainerChart = { overlayCount: (name?: string) => chart!.getOverlays(name ? { name } : {}).filter(overlay => !overlay.isDrawing()).length, selectedCount: () => multiSelectedIds.value.length, mode: () => ({ draw: props.drawTool ?? null, multiSelect: props.multiSelect ?? false, axisScaleDrag }), yRange: () => (chart!.getYAxes({ paneId: 'candle_pane' })[0] as unknown as { getRange: () => unknown } | undefined)?.getRange?.() ?? null, hitTest: (clientX: number, clientY: number) => { hostRect = host.value?.getBoundingClientRect() ?? null; return hitTestUserOverlay(clientX, clientY)?.id ?? null }, overlayInfo: (index: number) => { const o = (chart!.getOverlays() as unknown as Array<{ id: string; paneId: string; styles?: { line?: { color?: string } } }>)[index]; return o ? { id: o.id, paneId: o.paneId, lineColor: o.styles?.line?.color ?? null } : null }, singleSelected: () => selectedOverlayId.value, clickSelectedId: () => ((chart as unknown as { getChartStore: () => { getClickOverlayInfo: () => { overlay: { id: string } | null } } }).getChartStore().getClickOverlayInfo()?.overlay?.id ?? null) } } })
onUnmounted(() => { cancelChartCapture(); cancelReplayRestore(); cancelViewportOperation(); cancelHoverTimer(); host.value?.removeEventListener('wheel', onWheel); host.value?.removeEventListener('mouseleave', hideHoverCard); host.value?.removeEventListener('pointerdown', onPointerDown, true); host.value?.removeEventListener('mousedown', onHostMouseDown, true); host.value?.removeEventListener('mousedown', onHostMouseDownBubble, false); host.value?.removeEventListener('dblclick', onPaneDblClick); host.value?.removeEventListener('contextmenu', suppressNativeContextMenu); window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('keydown', onPanelKeydown, true); window.removeEventListener('pointerdown', onGlobalPointerDown, true); if (host.value) dispose(host.value); chart = null })
// 画线模式机：工具激活＝创建无 points 的 overlay 进入库内交互取点（step 模式，逐点点击）；
// 取点期间锁定拖拽平移，避免取点与视图平移互相干扰；退出/切换工具前取消未完成的取点。
// 一次性语义：取点完成（onDrawEnd）即自动退回默认模式。库不处理 Esc，取消由 cancelDrawing 完成。
// D2：所有用户画线挂 onSelected/onDeselected（Delete 删除依据）与 onRightClick（接管库默认"右键即删除"）。
// 取消未完成的取点：只有确实存在半成品 overlay 时才发 chart.drawing.cancel；
// restoreDrawings 的清理调用发生在 restoringDrawings 期间，由 emitOperation 总闸静默。
function cancelDrawing(): void {
  if (!chart) return
  const drawing = (chart.getOverlays() as Array<{ id: string; name: string; points?: Array<{ timestamp?: number; value?: number }>; isDrawing?: () => boolean }>).find(o => o.isDrawing?.())
  if (!drawing) return
  chart.removeOverlay({ id: drawing.id })
  const points = (drawing.points ?? []).filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.value)) as Array<{ timestamp: number; value: number }>
  emitOperation('chart.drawing.cancel', { id: drawing.id, name: drawing.name, points })
}
function drawingEvents(): Partial<OverlayCreate> {
  return {
    onDrawEnd: event => {
      emit('toolChange', null)
      queueMicrotask(() => {
        if (disposed || !chart) return
        deselectLibrarySelected()
        // 文本标注只开面板不记 create：确认/取消在 confirmTextPanel/cancelTextPanel 落账
        if (event.overlay.name === 'textAnnotation') openTextPanel(event.overlay.id, true)
        else { recordDrawings(); emitDrawingAction('chart.drawing.create', event.overlay.id) }
      })
    },
    onPressedMoveEnd: event => { updateAnchorDots(); recordDrawings(); emitMoveIfChanged(event.overlay.id) },
    onSelected: event => { selectedOverlayId.value = event.overlay.id },
    onDeselected: event => { if (selectedOverlayId.value === event.overlay.id) selectedOverlayId.value = null },
    onRightClick: event => {
      event.preventDefault?.()
      if ((event.overlay as RuntimeOverlay).isDrawing()) {
        if (event.overlay.name === 'polyline') { finishPolyline(event); return }
        cancelDrawing(); emit('toolChange', null); return
      }
      openCtxMenu(event.overlay.id, event.x ?? 0, event.y ?? 0)
    },
  }
}
function finishPolyline(event: OverlayEvent<unknown>): void {
  const overlay = event.overlay as typeof event.overlay & { forceComplete: () => void }
  const fixed = overlay.points.slice(0, overlay.currentStep - 1)
  if (fixed.length < 2) { cancelDrawing(); emit('toolChange', null); return }
  overlay.points = fixed
  overlay.forceComplete()
  ;(chart as any).getChartStore().progressOverlayComplete()
  chart?.overrideOverlay({ id: overlay.id, points: fixed })
  emit('toolChange', null)
  recordDrawings()
  emitDrawingAction('chart.drawing.create', overlay.id)
  queueMicrotask(() => { deselectLibrarySelected(); selectedOverlayId.value = null })
}
// 工具真正激活（drawTool 变为具体工具）＝chart.tool；取点完成自动退回 null 是组件内收尾，
// 不冒充一次选择。切换工具时旧半成品由 cancelDrawing 落 cancel。
watch(() => props.drawTool, tool => {
  if (!chart || props.readOnly) return
  cancelDrawing()
  if (tool) {
    emitOperation('chart.tool', { name: tool })
    resetLibraryClick()
    chart.setScrollEnabled(false)
    chart.createOverlay({
      name: tool,
      mode: props.magnet ?? 'weak_magnet',
      styles: configuredOverlayStyle(tool),
      extendData: configuredOverlayText(tool),
      ...(tool === 'bullArrow' || tool === 'bearArrow' ? { styles: { line: { color: tool === 'bullArrow' ? '#ef4444' : '#16a34a' } } } : {}),
      ...drawingEvents(),
    })
  } else {
    chart.setScrollEnabled(true)
  }
})
// 多选模式关闭：清空多选集合与选中标识
watch(() => props.multiSelect, on => { if (!on) clearMultiSelection() })
watch(() => props.magnet, mode => { for (const overlay of chart?.getOverlays() ?? []) if (!engineMarkNames.has(overlay.name)) chart?.overrideOverlay({ id: overlay.id, mode }) })
watch(() => [props.savedDrawings, props.bars] as const, () => {
  if (chart && props.savedDrawings && props.bars.length && !restoredDrawings) restoreDrawings(props.savedDrawings.filter(item => (item.timeframe ?? '1D') === props.timeframe), true)
}, { flush: 'post' })

// D2 右键菜单与编辑划线面板：锚定图表宿主层内并钳制边界（口径修订七）。
// 库默认行为是"右键命中画线即删除"，已在 createOverlay 的 onRightClick 里 preventDefault 接管。
const ctxMenu = ref<{ x: number; y: number; overlayId: string; batch: boolean } | null>(null)
const editPanel = ref<{ x: number; y: number } | null>(null)
const selectedOverlayId = ref<string | null>(null)
type EditForm = { id: string; label: string; color: string; size: number; style: 'solid' | 'dashed' | 'dotted'; values: number[] } & { text?: { text: string; size: number; bold: boolean; italic: boolean } }
const editForms = ref<EditForm[]>([])
const activeEditIndex = ref(0)
function clampToHost(value: number, size: number, limit: number): number { return Math.max(4, Math.min(value, Math.max(4, limit - size - 4))) }
function closePanels(): void { ctxMenu.value = null; editPanel.value = null; cancelTextPanel() }
function openCtxMenu(overlayId: string, x: number, y: number): void {
  if (props.readOnly || !host.value) return
  const rect = host.value.getBoundingClientRect()
  ctxMenu.value = { overlayId, batch: isMultiSelected(overlayId), x: clampToHost(x, 150, rect.width), y: clampToHost(y, 92, rect.height) }
  editPanel.value = null
}
function removeViaMenu(): void {
  if (props.readOnly || !chart || !ctxMenu.value) return
  const ids = ctxMenu.value.batch ? [...multiSelectedIds.value] : [ctxMenu.value.overlayId]
  // params 只带真实存在的语义图形：右键菜单弹出后图形可能已被其他入口删除
  const removed = ids.map(id => findDrawing(id)).filter((drawing): drawing is Drawing => !!drawing)
  if (!removed.length) { closePanels(); return }
  ids.forEach(id => chart!.removeOverlay({ id }))
  removed.forEach(drawing => lastReportedDrawing.delete(drawing.id))
  multiSelectedIds.value = multiSelectedIds.value.filter(id => !ids.includes(id))
  if (selectedOverlayId.value && ids.includes(selectedOverlayId.value)) selectedOverlayId.value = null
  updateAnchorDots()
  closePanels()
  recordDrawings()
  emitOperation('chart.drawing.delete', { ids: removed.map(drawing => drawing.id), drawings: removed.map(drawingOperationParams) })
}
// 选项卡式编辑面板：单个选中＝单表单（无标签行）；多选＝每个选中对象一个标签
// （标签＝类型+中文序号，如“线段一”），确定时批量应用全部表单（用户 D3 追加需求）
function openEditPanel(targetIds: string[], x: number, y: number): void {
  if (!chart || !host.value) return
  const first = chart.getOverlays({ id: targetIds[0] })[0]
  if (targetIds.length === 1 && first?.name === 'textAnnotation') { openTextPanel(first.id); return }
  const forms: EditForm[] = []
  const typeCount = new Map<string, number>()
  for (const id of targetIds) {
    const overlay = (chart.getOverlays({ id }) as unknown as Array<OverlayLike & { styles?: { line?: { color?: string; size?: number; style?: string; dashedValue?: number[] } } }>)[0]
    if (!overlay) continue
    const line = overlay.styles?.line ?? {}
    const annotation = overlay.name === 'textAnnotation' ? overlay.extendData as Partial<TextForm> : undefined
    const labelBase = typeLabel(overlay.name)
    const n = (typeCount.get(labelBase) ?? 0) + 1
    typeCount.set(labelBase, n)
    forms.push({
      id,
      label: labelBase + (cnNums[n - 1] ?? String(n)),
      color: annotation?.color ?? line.color ?? DRAW_DEFAULT_COLOR,
      size: line.size ?? 1,
      style: (line.style ?? 'dashed') === 'dashed' ? ((line.dashedValue?.[0] ?? 4) <= 3 ? 'dotted' : 'dashed') : 'solid',
      values: overlay.points.map(point => Number((point.value ?? 0).toFixed(2))).slice(0, overlay.name.startsWith('horizontal') ? 1 : undefined),
      ...(annotation ? { text: { text: annotation.text ?? '', size: annotation.size ?? 14, bold: annotation.bold ?? false, italic: annotation.italic ?? false } } : {}),
    })
  }
  if (!forms.length) { closePanels(); return }
  editForms.value = forms
  activeEditIndex.value = 0
  const rect = host.value.getBoundingClientRect()
  editPanel.value = { x: clampToHost(x, 214, rect.width), y: clampToHost(y, 360, rect.height) }
  ctxMenu.value = null
}
function applyEdit(): void {
  if (props.readOnly || !chart) return
  if (editForms.value.some(form => form.values.some(value => typeof value !== 'number' || !Number.isFinite(value)))) return
  if (editForms.value.some(form => form.text && (!form.text.text.trim() || !Number.isFinite(form.text.size)))) return
  let applied = 0
  for (const form of editForms.value) {
    const overlay = (chart.getOverlays({ id: form.id }) as unknown as Array<OverlayLike & { styles?: { line?: { color?: string; size?: number; style?: string; dashedValue?: number[] } } }>)[0]
    if (!overlay) continue
    const line = { color: form.color, size: form.size, style: (form.style === 'solid' ? 'solid' : 'dashed') as 'solid' | 'dashed', dashedValue: form.style === 'dotted' ? [2, 4] : [4, 4] }
    const points = applyDrawingPrices(overlay.points, form.values, overlay.name)
    chart.overrideOverlay({ id: form.id, styles: { line }, points })
    if (form.text) chart.overrideOverlay({ id: form.id, extendData: { ...form.text, color: form.color, size: Math.min(36, Math.max(10, form.text.size)) } })
    applied++
  }
  if (!applied) { closePanels(); return }
  // 批量应用完成：清除多选（锚点层随集合清空而消失）
  multiSelectedIds.value = []
  updateAnchorDots()
  closePanels()
  recordDrawings()
  // 一次确定＝一条 edit，params 汇总本次实际应用的全部语义图形
  const edited = editForms.value.map(form => findDrawing(form.id)).filter((drawing): drawing is Drawing => !!drawing)
  edited.forEach(drawing => markDrawingReported(lastReportedDrawing, drawing))
  emitOperation('chart.drawing.edit', { drawings: edited.map(drawingOperationParams) })
}
// Delete 删除选中画线：多选集合非空＝只删集合（画线完成/点击时库会把 overlay 置为选中态，
// selectedOverlayId 可能指向不在多选集合里的画线，多选场景下追加它会误删第三条——用户 journey 抓出）；
// 空集合＝删单击选中的单个。引擎标记不可选中、不受影响。
function deleteSelected(): boolean {
  if (props.readOnly || !chart) return false
  const ids = multiSelectedIds.value.length ? [...multiSelectedIds.value] : (selectedOverlayId.value ? [selectedOverlayId.value] : [])
  if (!ids.length) { closePanels(); return false }
  const removed = ids.map(id => findDrawing(id)).filter((drawing): drawing is Drawing => !!drawing)
  ids.forEach(id => chart!.removeOverlay({ id }))
  removed.forEach(drawing => lastReportedDrawing.delete(drawing.id))
  multiSelectedIds.value = []
  selectedOverlayId.value = null
  updateAnchorDots()
  closePanels()
  if (!removed.length) return false
  recordDrawings()
  emitOperation('chart.drawing.delete', { ids: removed.map(drawing => drawing.id), drawings: removed.map(drawingOperationParams) })
  return true
}

type TextForm = { id: string; isNew: boolean; x: number; y: number; text: string; color: string; size: number; bold: boolean; italic: boolean }
const textPanel = ref<TextForm | null>(null)
function openTextPanel(id: string, isNew = false): void {
  const overlay = chart?.getOverlays({ id })[0]
  if (!overlay || !host.value) return
  const data = overlay.extendData as Partial<TextForm> | undefined
  const point = overlayHitGeometry(overlay as unknown as OverlayLike).anchors[0] ?? { x: 40, y: 40 }
  const rect = host.value.getBoundingClientRect()
  textPanel.value = { id, isNew, x: clampToHost(point.x + 16, 280, rect.width), y: clampToHost(point.y, 300, rect.height), text: data?.text ?? '', color: data?.color ?? DRAW_DEFAULT_COLOR, size: data?.size ?? 14, bold: data?.bold ?? false, italic: data?.italic ?? false }
  ctxMenu.value = null
  editPanel.value = null
  emit('panelChange', true)
}
function cancelTextPanel(): void {
  const form = textPanel.value
  if (form?.isNew) {
    // 新建标注被放弃＝移除半成品 overlay 并落 cancel；已存在标注的取消不改任何数据，不上报
    const drawing = findDrawing(form.id)
    chart?.removeOverlay({ id: form.id })
    if (drawing) emitOperation('chart.drawing.cancel', drawingOperationParams(drawing))
  }
  textPanel.value = null
  emit('panelChange', false)
}
function confirmTextPanel(): void {
  const form = textPanel.value
  if (props.readOnly || !chart || !form || !form.text.trim() || !Number.isFinite(form.size)) return
  chart.overrideOverlay({ id: form.id, extendData: { text: form.text.trim(), color: form.color, size: Math.max(10, Math.min(36, form.size)), bold: form.bold, italic: form.italic } })
  textPanel.value = null
  emit('panelChange', false)
  recordDrawings()
  emitDrawingAction(form.isNew ? 'chart.drawing.create' : 'chart.drawing.edit', form.id)
}
// 菜单/面板打开期间：Esc 关闭；训练热键拦截防误操作（capture 先于 Training 的 window 冒泡监听）
function onPanelKeydown(event: KeyboardEvent): void {
  if (maSettingsOpen.value) return // Native modal owns focus, Esc and editable number inputs.
  if (!ctxMenu.value && !editPanel.value && !textPanel.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanels(); return }
  event.stopPropagation()
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return
  if (event.code === 'Space' || ['b', 'B', 's', 'S'].includes(event.key) || event.key === 'Delete') event.preventDefault()
}
// D2 补丁：编辑划线面板可拖拽（按住标题栏移动，避免遮挡 K 线；全程钳制在图表宿主内，口径修订七）。
// 标题栏 setPointerCapture 后拖动中 pointermove 持续派发到标题元素，指针移出面板也不丢。
const panelDragging = ref(false)
const panelDragOffset = { x: 0, y: 0 }
function onPanelTitlePointerDown(event: PointerEvent): void {
  if (!editPanel.value || !host.value) return
  const rect = host.value.getBoundingClientRect()
  panelDragOffset.x = event.clientX - rect.left - editPanel.value.x
  panelDragOffset.y = event.clientY - rect.top - editPanel.value.y
  panelDragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function onPanelTitlePointerMove(event: PointerEvent): void {
  if (!panelDragging.value || !editPanel.value || !host.value) return
  const rect = host.value.getBoundingClientRect()
  editPanel.value = {
    ...editPanel.value,
    x: clampToHost(event.clientX - rect.left - panelDragOffset.x, 214, rect.width),
    y: clampToHost(event.clientY - rect.top - panelDragOffset.y, 300, rect.height),
  }
}
function onPanelTitlePointerUp(): void { panelDragging.value = false }
// 点击菜单/面板以外区域时关闭（capture 阶段，先于其他处理）
function onGlobalPointerDown(event: PointerEvent): void {
  if (!ctxMenu.value && !editPanel.value && !textPanel.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.ctx-menu, .overlay-edit-panel, .text-edit-panel')) return
  closePanels()
}
// D3 追加：划线多选支持。multiSelectedIds＝多选集合；multiRect＝多选模式下的橡皮筋矩形。
// 选中标识（用户 D4 验收拍板）：锚点呈选中态（变大变亮，与单选选中态同一设计），线体颜色绝不变动——
// 此前天蓝变色方案与用户自定义线色冲突，已废弃。multiRect 必须是 ref：普通变量赋值不触发模板重渲染
// （multiRect 不可见缺陷的最终根因——const→let 只修了报错，丢掉响应性；教训：视觉元素必须配可见性断言）。
const multiSelectedIds = ref<string[]>([])
const multiRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let multiDragStart: { x: number; y: number } | null = null
// 框选/橡皮筋的纵向边界随起点 pane 变化前先取全绘图区（主图顶～时间轴顶），横向钳制在价格轴左缘内
let multiBounds: { right: number; top: number; bottom: number } | null = null
type OverlayLike = {
  id: string
  name: string
  paneId: string
  lock: boolean
  isDrawing: () => boolean
  startPressedMove: (point: { dataIndex?: number; value?: number }) => void
  points: Array<{ timestamp?: number; value?: number }>
  extendData?: unknown
}
const engineMarkNames = new Set(['bsMark', 'costLine', 'phasePriceLine', 'orderTriggerMark'])
const cnNums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
function typeLabel(name: string): string {
  return DRAW_TOOLS.find(tool => tool.name === name)?.label ?? name
}
function isMultiSelected(id: string): boolean { return multiSelectedIds.value.includes(id) }
// 多选成员的端点视觉＝自绘锚点层（anchor-dot）：库 drawDefaultFigures 只为 hover/click 选中态绘制锚点，
// box 选中的画线两者皆非、锚点根本不渲染（point 样式覆盖因此无效——用户验收实证）。dot 位置随
// 选中集合变化/可见范围变化/指针拖动实时重算，视觉与库单选选中态锚点一致（黄芯白圈 18px）。
const anchorDots = ref<Array<{ key: string; x: number; y: number }>>([])
function updateAnchorDots(): void {
  if (!chart) { anchorDots.value = []; return }
  const dots: Array<{ key: string; x: number; y: number }> = []
  for (const id of multiSelectedIds.value) {
    const overlay = (chart.getOverlays({ id }) as unknown as OverlayLike[])[0]
    if (!overlay) continue
    overlayHitGeometry(overlay).anchors.forEach((p, i) => dots.push({ key: `${id}:${i}`, x: p.x, y: p.y }))
  }
  anchorDots.value = dots
}
// 解除库内持久选中态（用户 D4 验收拍板：点击空白即解除）。库仅在收到空白 click 时自解，
// 而我们的框选接管 stopPropagation 拦掉了该链路——画线端点常显（假选中）的根因。
// 必须传 onDeselected 回调：setClickOverlayInfo 在新旧 id 不同时直接调用它（不判空）。
function deselectLibrarySelected(): void {
  if (!chart) return
  const store = (chart as unknown as { getChartStore: () => {
    getClickOverlayInfo: () => { overlay: { id: string; onDeselected?: (e: unknown) => void } | null }
    setClickOverlayInfo: (info: Record<string, unknown>, onSel?: (o: unknown, f: unknown) => void, onDes?: (o: unknown, f: unknown) => void) => void
  } }).getChartStore()
  const prev = store.getClickOverlayInfo()
  if (!prev?.overlay) return
  store.setClickOverlayInfo(
    { paneId: 'candle_pane', overlay: null, figureType: 'none', figureIndex: -1, figure: null },
    undefined,
    o => { (o as { onDeselected?: (e: unknown) => void }).onDeselected?.({ overlay: o }) },
  )
}
function toggleMultiSelect(id: string): void {
  if (isMultiSelected(id)) {
    multiSelectedIds.value = multiSelectedIds.value.filter(x => x !== id)
  }
  else {
    multiSelectedIds.value = [...multiSelectedIds.value, id]
  }
  updateAnchorDots()
}
function clearMultiSelection(): void {
  multiSelectedIds.value = []
  updateAnchorDots()
}
// 框选矩形与画线的相交判定：端点落在矩形内，或线体采样点（含射线/直线延伸段）落在矩形内
function selectDrawingsInRect(rect: { left: number; top: number; width: number; height: number }): void {
  if (!chart) return
  const overlays = (chart.getOverlays() as unknown as OverlayLike[]).filter(overlay => !engineMarkNames.has(overlay.name) && !overlay.isDrawing())
  for (const overlay of overlays) {
    if (isMultiSelected(overlay.id)) continue
    const pane = chart.getSize(overlay.paneId)
    if (!pane) continue
    const top = Math.max(rect.top, pane.top)
    const bottom = Math.min(rect.top + rect.height, pane.top + pane.height)
    if (bottom <= top) continue
    const visibleRect = { ...rect, top, height: bottom - top }
    const inside = (p: { x: number; y: number }) => p.x >= rect.left && p.x <= rect.left + rect.width && p.y >= top && p.y <= bottom
    const { anchors, segs, polygon } = overlayHitGeometry(overlay)
    const hit = anchors.some(inside) || segs.some(seg => segmentInRect(seg, visibleRect)) || (polygon && pointInPolygon({ x: rect.left, y: top }, polygon))
    if (hit) {
      multiSelectedIds.value = [...multiSelectedIds.value, overlay.id]
    }
  }
  updateAnchorDots()
}
// 画线命中/框选几何：anchors＝真实端点像素，segs＝线体覆盖线段（射线/直线按图元覆盖范围延伸）。
// 坐标按 overlay.paneId 转换——画线可落在主图或副图（取点第一击所在 pane 即落点，库同步 overlay.paneId）。
// absolute:true 必须带：库默认返回 pane 相对 y（主图 pane top=0 掩盖此差异，副图必须加 bounding.top 才是 host 坐标）
function overlayHitGeometry(overlay: OverlayLike): { anchors: Array<{ x: number; y: number }>; segs: Array<Array<{ x: number; y: number }>>; polygon?: Array<{ x: number; y: number }> } {
  const pts = overlay.points
    .filter(point => point.timestamp !== undefined && point.value !== undefined)
    .map(point => chart!.convertToPixel({ timestamp: point.timestamp, value: point.value }, { paneId: overlay.paneId || 'candle_pane', absolute: true }))
    .filter(c => !!c && Number.isFinite(c.x) && Number.isFinite(c.y)) as Array<{ x: number; y: number }>
  const pane = chart!.getSize(overlay.paneId || 'candle_pane')
  const yAxis = chart!.getSize(overlay.paneId || 'candle_pane', 'yAxis')
  const bounds = { left: 0, right: yAxis?.left ?? pane?.width ?? 2000, top: pane?.top ?? 0, bottom: (pane?.top ?? 0) + (pane?.height ?? 0) }
  return builtInGeometry(overlay.name, pts, bounds) ?? drawingFigureGeometry(overlay.name, pts, bounds, overlay.extendData)
}
function suppressNativeContextMenu(event: MouseEvent): void {
  event.preventDefault()
  if (props.readOnly || props.drawTool) return
  hostRect = host.value?.getBoundingClientRect() ?? null
  const hit = hitTestUserOverlay(event.clientX, event.clientY)
  if (hit) openCtxMenu(hit.id, event.clientX - (hostRect?.left ?? 0), event.clientY - (hostRect?.top ?? 0))
}

// D3 验收反馈修复：纵轴拖拽缩放持续到松手。
// 库按 widget 名称路由拖拽事件：轴上起拖后指针移入主图即"中断"（名称不匹配不再分发）。
// 补丁＝轴上按下后，把真实指针的纵向位置重路由为"轴区域内"的合成 mousemove，
// 让库的原生缩放管线（_processYAxisScalingEvent，含其自身重绘）持续工作，直到松手。
let axisScaleDrag = false
let axisScaleDragX = 0
// host 捕获阶段拦截 mousedown：主图空白的按下＝框选接管，拦截库的 mousedown——
// 否则库会在拖拽中对手动模式纵轴叠加纵向平移（框选时所有画线整体上下移动的根因）；
// 轴上按下与画线命中照常放行给库（轴缩放起点/画线选中拖拽不受影响）
// host 捕获阶段拦截 mousedown：
// ① 中键按下＝平移整个主图：合成左键 mousedown 交给库的原生滚动管线（横向平移＋手动纵轴纵向平移），
//    并 preventDefault 阻止浏览器中键自动滚动；
// ② 主图空白的左键按下＝框选接管，拦截库的 mousedown——否则库会在拖拽中对手动模式纵轴叠加纵向平移
//    （框选时所有画线整体上下移动的根因）；
// ③ 轴上按下与画线命中照常放行给库（轴缩放起点/画线选中拖拽不受影响），画线模式的取点交互也不受影响
function onHostMouseDown(event: MouseEvent): void {
  // 中键合成的左键 mousedown：直接放行给库（跳过本拦截器与冒泡修补，避免自我拦截）
  if ((event as MouseEvent & { __klineSynthetic?: boolean }).__klineSynthetic) return
  if (event.button === 0 && (paneResizePointerId !== null || isOverPaneSeparator(event))) return
  if (props.drawTool && event.button === 0) resetLibraryClick()
  // 左键点选画线（Ctrl 组合，或多选模式下普通左键——用户 D4 验收反馈：仅靠 Ctrl 无法凸显多选价值）：
  // 加入/移出多选集合（点空白清空多选），拦截库的单选与平移；主副图同权。仅左键（右键放行给库的菜单链路）
  if ((event.ctrlKey || props.multiSelect) && !props.drawTool && event.button === 0) {
    if (!isDrawPane(paneIdAt(event.clientY))) return
    hostRect = host.value?.getBoundingClientRect() ?? null
    const hit = hitTestUserOverlay(event.clientX, event.clientY)
    if (hit) toggleMultiSelect(hit.id)
    else { clearMultiSelection(); deselectLibrarySelected() }
    event.stopPropagation()
    return
  }
  if (event.button === 1) {
    event.preventDefault()
    if (!chart) return
    // 纵轴强制进入手动模式：库仅对手动模式纵轴记录值域基准并随拖拽纵向平移，
    // 否则自动模式下（Space/Home 之后）中键拖拽只有横向生效（用户 D3 验收反馈）
    ;(chart.getYAxes({ paneId: 'candle_pane' }) as unknown as Array<{ setAutoCalcTickFlag: (flag: boolean) => void }>).forEach(axis => axis.setAutoCalcTickFlag(false))
    // 中键只做画面平移：临时锁定用户画线，让合成按下不命中画线拖拽（用户 D3 验收反馈：功能重叠）
    const userOverlays = (chart.getOverlays() as unknown as Array<{ name: string; lock: boolean; isDrawing: () => boolean }>).filter(overlay => !engineMarkNames.has(overlay.name))
    userOverlays.forEach(overlay => { overlay.lock = true })
    const container = host.value?.firstElementChild as HTMLElement | null
    const synthetic = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: event.clientX, clientY: event.clientY })
    ;(synthetic as MouseEvent & { __klineSynthetic?: boolean }).__klineSynthetic = true
    container?.dispatchEvent(synthetic)
    userOverlays.forEach(overlay => { overlay.lock = props.readOnly })
    return
  }
  // 条件单触发点标记上按下：只拦截，不触发轴缩放/画线选择（1.2.2 起的保护保持不变；
  // 悬浮信息改由悬停驱动，点击不再显示）
  if (event.button === 2 && hitPendingOrders(event.clientX, event.clientY).length) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.button !== 0 || !chart) return
  if (hitPendingOrders(event.clientX, event.clientY).length) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (props.drawTool) return
  if (!isDrawPane(paneIdAt(event.clientY))) return
  hostRect = host.value?.getBoundingClientRect() ?? null
  if (hitTestUserOverlay(event.clientX, event.clientY)) return
  if (isOverPriceAxis(event.clientX, event.clientY)) {
    axisScaleDrag = true
    axisScaleDragX = event.clientX
    return
  }
  event.stopPropagation()
}

function isNearPendingOrder(clientX: number, clientY: number): boolean {
  if (!chart || !props.orders.some(order => order.status === 'pending')) return false
  const rect = host.value?.getBoundingClientRect()
  if (!rect) return false
  const order = props.orders.find(item => item.status === 'pending')!
  const point = chart.convertToPixel({ value: order.triggerPrice }, { paneId: 'candle_pane', absolute: true })
  const axis = chart.getSize('candle_pane', 'yAxis')
  const x = rect.left + (axis?.left ?? 0) - 7
  const y = rect.top + (point.y ?? Number.NaN)
  return Number.isFinite(y) && Math.abs(clientY - y) <= 12 && clientX >= x - 86 && clientX <= x + 12
}
// host 冒泡阶段（库的 mousedown 处理之后）补齐按下与选中状态：
// ① 压下态补齐：我们 7px 命中比库内 figure 命中（DEVIATION=2）宽，2~7px 环带库未命中会进滚动拖拽（整图平移 bug）；
// ② 选中态补齐：库 figure 点击分派对部分几何（水平全宽线体，Act2e 实证）不可靠——点击后 click 选中态未切换。
//    点击画线＝持久选中是用户拍板的确定性模型，命中即补齐（库已选中同一画线时不重复触发回调）。
function onHostMouseDownBubble(event: MouseEvent): void {
  if ((event as MouseEvent & { __klineSynthetic?: boolean }).__klineSynthetic) return
  // 只读：这里的手动按下/选中补齐会绕过库的 ignoreEvent 强开拖拽与选中链，必须整段拦下
  if (props.readOnly) return
  if (event.button !== 0 || !chart) return
  if (hitPendingOrders(event.clientX, event.clientY).length) return
  if (paneResizePointerId !== null || isOverPaneSeparator(event)) return
  if (props.drawTool) return
  if (!isDrawPane(paneIdAt(event.clientY))) return
  const hit = hitTestUserOverlay(event.clientX, event.clientY)
  if (!hit) return
  const store = (chart as unknown as { getChartStore: () => {
    setPressedOverlayInfo: (info: Record<string, unknown>) => void
    getPressedOverlayInfo: () => { overlay: unknown } | null
    setClickOverlayInfo: (info: Record<string, unknown>, onSel?: (o: unknown, f: unknown) => void, onDes?: (o: unknown, f: unknown) => void) => void
    getClickOverlayInfo: () => { overlay: { id: string } | null }
  } }).getChartStore()
  const paneId = hit.paneId || 'candle_pane'
  hostRect = host.value?.getBoundingClientRect() ?? null
  if (!store.getPressedOverlayInfo()?.overlay) {
    // absolute:true：输入为 host 坐标（库内部对副图会先减 bounding.top，主图 top=0 行为不变）
    const coord = chart.convertFromPixel([{ x: event.clientX - (hostRect?.left ?? 0), y: event.clientY - (hostRect?.top ?? 0) }], { paneId, absolute: true })[0]
    if (!coord || coord.dataIndex === undefined) return
    hit.startPressedMove({ dataIndex: coord.dataIndex, value: coord.value })
    store.setPressedOverlayInfo({ paneId, overlay: hit, figureType: 'other', figureIndex: -1, figure: null })
  }
  if (store.getClickOverlayInfo()?.overlay?.id !== hit.id) {
    store.setClickOverlayInfo(
      { paneId, overlay: hit, figureType: 'other', figureIndex: -1, figure: null },
      o => { (o as { onSelected?: (e: unknown) => void }).onSelected?.({ overlay: o }) },
      o => { (o as { onDeselected?: (e: unknown) => void }).onDeselected?.({ overlay: o }) },
    )
  }
}
// 拖拽中：把指针位置重路由为轴区域内的合成 mousemove（x 固定在按下点，y 用真实值——
// 库的缩放公式按 pageY 比例计算），真实移动事件本身因 widget 名称不匹配已被库忽略
function dispatchSyntheticAxisMove(event: PointerEvent): void {
  const container = host.value?.firstElementChild as HTMLElement | null
  if (!container) return
  container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: axisScaleDragX, clientY: event.clientY }))
}
// The library discards a second click inside 500ms even when it is far away.
// A fresh tool/anchor is an independent action, not a double-click completion.
function resetLibraryClick(): void {
  ;(chart as unknown as { _chartEvent?: { _event?: { _resetClickTimeout?: () => void } } } | null)?._chartEvent?._event?._resetClickTimeout?.()
}
function completePointerAction(): void { queueMicrotask(() => { updateAnchorDots(); recordDrawings() }) }
onMounted(() => {
  configurePhasePriceRange()
  window.addEventListener('pointerup', completePointerAction)
  window.addEventListener('pointercancel', onPaneResizeCancel)
  chart?.subscribeAction('onVisibleRangeChange', updateMarkerRail)
  markerResizeObserver = new ResizeObserver(() => { enforceVisibleLimit(); updateMarkerRail() })
  if (host.value) markerResizeObserver.observe(host.value)
  updateMarkerRail()
  if (props.savedDrawings && props.bars.length) restoreDrawings(props.savedDrawings.filter(item => (item.timeframe ?? '1D') === props.timeframe), true)
  if (import.meta.env.MODE === 'journey') Object.assign((window as any).__trainerChart, {
    ma: () => {
      const indicator = chart?.getIndicators({ name: 'MA' })[0]
      return indicator ? { periods: indicator.calcParams, visible: indicator.visible, colors: indicator.styles?.lines?.map(line => line.color), result: indicator.result } : null
    },
    drawings,
    geometry: () => (chart?.getOverlays() ?? []).filter(overlay => !engineMarkNames.has(overlay.name) && !overlay.isDrawing()).map(overlay => ({ id: overlay.id, name: overlay.name, ...overlayHitGeometry(overlay as unknown as OverlayLike) })),
    panes: () => (chart?.getPaneOptions() as Array<{ id: string }> ?? []).filter(pane => pane.id !== 'x_axis_pane').map(pane => ({ id: pane.id, name: paneName(pane.id), ...chart!.getSize(pane.id) })),
    // M6-01 KDJ e2e 只读探针：各绘图窗格的语义指标名（['candle_pane','VOL','MACD','KDJ']，
    // KDJ 偏好关时不含 'KDJ'）——测试专用，不影响生产行为
    indicatorPanes: () => (chart?.getPaneOptions() as Array<{ id: string }> ?? []).filter(pane => pane.id !== 'x_axis_pane').map(pane => paneName(pane.id)),
    // M6-03 信息卡 e2e 只读探针：卡可见性/内容/位置（测试专用，不影响生产行为）
    hoverCard: () => ({ visible: hoverCard.value !== null, date: hoverCard.value?.model.date ?? null, rows: hoverCard.value?.model.rows.map(row => `${row.label}:${row.value}`) ?? null, pctText: hoverCard.value?.model.pct.text ?? null, pctCls: hoverCard.value?.model.pct.cls ?? null, x: hoverCard.value?.x ?? null, y: hoverCard.value?.y ?? null }),
    visibleRange: () => chart?.getVisibleRange(),
    costLine: () => {
      const overlay = chart?.getOverlays({ name: 'costLine' })[0]
      const value = overlay?.points[0]?.value
      return value === undefined ? null : { value, y: chart?.convertToPixel({ value }, { paneId: 'candle_pane', absolute: true }).y }
    },
    viewportMetrics: () => ({ width: chart?.getSize('candle_pane', 'main')?.width, bar: chart?.getBarSpace().bar, range: chart?.getVisibleRange(), scrollEnabled: chart?.isScrollEnabled() }),
    bars: () => chart?.getDataList(),
    pointToPixel: (timestamp: number, value: number, pane = 'candle_pane') => chart?.convertToPixel({ timestamp, value }, { paneId: actualPaneId(pane), absolute: true }),
    lastPriceMarkShow: () => chart?.getStyles().candle.priceMark.last.show ?? null,
    lastPriceMarkColor: () => chart?.getStyles().candle.priceMark.last.upColor ?? null,
    phasePriceMark: () => {
      const overlays = chart?.getOverlays({ name: 'phasePriceLine' }) ?? []
      return {
        count: overlays.length, previousClose: props.previousClose ?? null,
        markers: overlays.map(overlay => {
          const coordinates = chart!.convertToPixel(overlay.points, { paneId: 'candle_pane' }) as Coordinate[]
          const params = { chart: chart!, overlay, coordinates, bounding: chart!.getSize('candle_pane', 'main')!, xAxis: null, yAxis: chart!.getYAxes({ paneId: 'candle_pane' })[0] ?? null } as OverlayCreateFiguresCallbackParams<unknown>
          return { price: overlay.points[0]?.value ?? null, y: coordinates[0]?.y ?? null, height: params.bounding.height, lineFigures: overlay.createPointFigures?.(params) ?? [], axisFigures: overlay.createYAxisFigures?.({ ...params, bounding: chart!.getSize('candle_pane', 'yAxis')! }) ?? [] }
        }),
      }
    },
    orderMarkerPoints: () => props.orders.filter(order => order.status === 'pending').map(order => ({ id: order.id, side: order.side, trigger: order.triggerPrice, x: chart?.getSize('candle_pane', 'yAxis')?.left ?? 0, y: chart?.convertToPixel({ value: order.triggerPrice }, { paneId: 'candle_pane', absolute: true }).y ?? null })),
  })
})
onUnmounted(() => { disposed = true; markerResizeObserver?.disconnect(); window.removeEventListener('pointerup', completePointerAction); window.removeEventListener('pointercancel', onPaneResizeCancel) })
// 前复权推进（DRAW-02）：喂新K线前按旧基准捕获画线快照，喂完再统一投影到新基准。
// 基准推进与图形数量解耦（advanceRenderedBasis）：图上无画线（空图/清空/撤销到空）也必须
// 推进目标基准，否则跨权息后新建画线被盖印旧基准，下次普通刷新遭二次投影错位；
// 有画线时才恢复投影并恰好外发一次 drawingsChange 让持久化层保存新基准数值。
// 基准未变（刷新/周期切换/无权息推进）绝不重复投影；推进不清撤销历史（历史状态各带基准，
// 恢复时再投影）；投影走 restoreDrawings——restoringDrawings 静默语义操作并重播种上报基线，
// 不产生 drawing.move。只读回放快照永不按当前行情二次复权；prop 缺省时整段跳过＝旧行为。
watch(() => props.bars, () => {
  const from = renderedBasis
  const to = currentDrawingPriceBasis()
  const stale = from && to && !sameDrawingPriceBasis(from, to) && restoredDrawings ? drawings() : null
  feedData()
  const { basis, changed } = advanceRenderedBasis(from, to)
  if (!basis || basis === from) return
  renderedBasis = basis
  if (changed) drawingHistory.rebasePriceBasis(basis)
  if (changed && stale?.length) {
    restoreDrawings(projectDrawings(stale, from!, basis))
    emit('drawingsChange', drawings())
  }
})
watch(() => [props.trades, props.costPrice, props.chartCostPrice, props.currentPrice, props.previousClose, props.orders], refreshMarks, { deep: true }); watch(theme, value => { chart?.setStyles(chartStyles(value)); applyLastPriceStyle() })
// 副图偏好切换（任一）：立即增/删对应窗格（paneHeights 变化属布局结果，刷新捕获供后续
// 检查点；非用户导航，不发 chart.viewport 操作）
watch([appKdjSubchart, appVolSubchart, appMacdSubchart], () => { applySubchartPanes(); scheduleChartCapture() })
onMounted(applyMaSettings)
watch(appMaSettings, applyMaSettings)
defineExpose({ zoomBy, moveCrosshair, resetView, deleteSelected, clearMultiSelection, undoDrawing, redoDrawing, clearDrawings, drawings, captureState })
</script>

<template>
  <div class="chart-frame">
  <div class="chart-wrap">
    <button class="ma-settings-trigger" aria-label="设置均线" title="设置主图均线周期和颜色" :disabled="!!props.drawTool" @click="openMaSettings">MA 设置</button>
    <MaSettingsDialog v-if="maSettingsOpen" @close="closeMaSettings" />
    <button v-if="maHistoryError" class="ma-history-error" role="alert" @click="ensureMaHistory">{{ maHistoryError }}，点击重试</button>
    <div ref="host" class="chart-host"></div>
    <div v-if="orderTooltip" class="order-tooltip" :style="{ left: `${orderTooltip.x}px`, top: `${orderTooltip.y}px` }" role="status">{{ orderTooltip.text }}</div>
    <!-- M6-03 悬浮信息卡：日期＋开/高/低/收＋涨幅（红涨/绿跌/零灰）；纯信息层不拦截指针 -->
    <div v-if="hoverCard" class="hover-card" data-testid="hover-card" :style="{ left: `${hoverCard.x}px`, top: `${hoverCard.y}px` }">
      <div class="hover-card-date">{{ hoverCard.model.date }}</div>
      <div v-for="row in hoverCard.model.rows" :key="row.label" class="hover-card-row"><span class="hover-card-label">{{ row.label }}</span><span class="hover-card-value">{{ row.value }}</span></div>
      <div class="hover-card-row"><span class="hover-card-label">涨幅</span><span class="hover-card-value" :class="hoverCard.model.pct.cls">{{ hoverCard.model.pct.text }}</span></div>
    </div>
    <div class="select-rect"></div>
    <!-- 多选模式橡皮筋矩形：框选划线批量选中（不缩放 K 线） -->
    <div v-if="multiRect" class="multi-rect" :style="{ left: `${multiRect.left}px`, top: `${multiRect.top}px`, width: `${multiRect.width}px`, height: `${multiRect.height}px` }"></div>
    <!-- 右键菜单/编辑划线面板：锚定图表宿主层内并钳制边界（口径修订七） -->
    <div v-if="ctxMenu" class="ctx-menu" :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }">
      <button @click="openEditPanel(ctxMenu.batch ? multiSelectedIds : [ctxMenu.overlayId], ctxMenu.x, ctxMenu.y)">{{ ctxMenu.batch ? `编辑划线（${multiSelectedIds.length}）` : '编辑划线' }}</button>
      <button @click="removeViaMenu">{{ ctxMenu.batch ? `删除画线（${multiSelectedIds.length}）` : '删除画线' }}</button>
    </div>
    <!-- 多选成员锚点层：box 选中的画线库不绘制锚点（仅 hover/click 选中态绘制），自绘端点与单选选中态同视觉 -->
    <div v-for="dot in anchorDots" :key="dot.key" class="anchor-dot" :style="{ left: `${dot.x - 9}px`, top: `${dot.y - 9}px` }"></div>
    <div v-if="editPanel" class="overlay-edit-panel" :style="{ left: `${editPanel.x}px`, top: `${editPanel.y}px` }">
      <div class="panel-title" title="按住标题栏拖动面板" @pointerdown="onPanelTitlePointerDown" @pointermove="onPanelTitlePointerMove" @pointerup="onPanelTitlePointerUp">编辑划线<span v-if="editForms.length > 1" class="panel-count">（{{ editForms.length }} 个）</span></div>
      <div v-if="editForms.length > 1" class="edit-tabs">
        <button v-for="(f, i) in editForms" :key="f.id" :class="{ active: activeEditIndex === i }" @click="activeEditIndex = i">{{ f.label }}</button>
      </div>
      <template v-if="editForms[activeEditIndex]">
        <div class="field-row"><span class="field-label">颜色</span><input v-model="editForms[activeEditIndex].color" type="color"></div>
        <template v-if="editForms[activeEditIndex].text">
          <textarea v-model="editForms[activeEditIndex].text!.text" aria-label="标注内容" maxlength="2000" rows="3"></textarea>
          <label>字号<input v-model.number="editForms[activeEditIndex].text!.size" type="number" min="10" max="36"></label>
          <label><input v-model="editForms[activeEditIndex].text!.bold" type="checkbox">加粗</label>
          <label><input v-model="editForms[activeEditIndex].text!.italic" type="checkbox">斜体</label>
        </template>
        <template v-else>
          <div class="field-row"><span class="field-label">粗细</span><select v-model.number="editForms[activeEditIndex].size"><option v-for="s in [1, 2, 3, 4, 5]" :key="s" :value="s">{{ s }}px</option></select></div>
          <div class="field-row"><span class="field-label">样式</span><select v-model="editForms[activeEditIndex].style"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></div>
        </template>
        <div v-for="(_, i) in editForms[activeEditIndex].values" :key="i" class="field-row"><span class="field-label">端点{{ i + 1 }}价位</span><input v-model.number="editForms[activeEditIndex].values[i]" type="number" step="0.01"></div>
      </template>
      <div class="panel-actions"><button @click="applyEdit">确定</button><button @click="closePanels">取消</button></div>
    </div>
    <div v-if="textPanel" class="text-edit-panel" :style="{ left: `${textPanel.x}px`, top: `${textPanel.y}px` }">
      <strong>文本标注</strong>
      <textarea v-model="textPanel.text" aria-label="标注内容" maxlength="2000" rows="4" autofocus></textarea>
      <label>颜色<input v-model="textPanel.color" type="color" aria-label="文本颜色"></label>
      <label>字号<input v-model.number="textPanel.size" type="number" min="10" max="36" aria-label="字号"></label>
      <div class="text-style-options"><label><input v-model="textPanel.bold" type="checkbox">加粗</label><label><input v-model="textPanel.italic" type="checkbox">斜体</label></div>
      <div class="panel-actions"><button :disabled="!textPanel.text.trim()" @click="confirmTextPanel">确定</button><button @click="cancelTextPanel">取消</button></div>
    </div>
  </div>
  <TradeMarkerRail :trades="trades" :timeframe="timeframe" :project="projectTradeTime" :width="markerWidth" :revision="markerRevision" :training-id="props.trainingId" />
  </div>
</template>

<style scoped>
.ma-settings-trigger { position: absolute; top: 5px; right: 90px; z-index: 4; border: 1px solid var(--surface-border); border-radius: 4px; padding: 3px 8px; background: var(--control-background); color: var(--text-secondary); font-size: 11px; }
.ma-settings-trigger:disabled { opacity: .5; cursor: default; }
.ma-settings-trigger:focus-visible { outline: 2px solid #54b8cc; }
.ma-history-error { position: absolute; top: 35px; right: 90px; z-index: 4; padding: 4px 8px; border: 1px solid var(--surface-border); border-radius: 4px; background: var(--surface-background); color: var(--text-primary); font-size: 12px; }
.chart-frame { display: grid; grid-template-rows: minmax(0, 1fr) 40px; height: 100%; min-height: 0; }
.chart-wrap { position: relative; width: 100%; height: 100%; overflow: hidden; user-select: none; }
/* 挂单悬浮信息层：只引用全局已定义的设计令牌（--surface-*、--text-*），深浅主题随令牌自动切换。
   此前引用未定义的 --surface-raised 导致深色主题下回落到浅色（用户 1.2.3 反馈）；纯信息层不拦截指针。 */
.order-tooltip { position: absolute; z-index: 20; max-width: 230px; white-space: pre-line; padding: 8px 10px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; background: var(--surface-background, #fff); color: var(--text-primary, #25364b); box-shadow: 0 5px 18px rgba(0,0,0,.18); font-size: 11px; line-height: 1.5; pointer-events: none; }
.chart-host { width: 100%; height: 100%; }
/* M6-03 悬浮信息卡：日期＋开高低收＋涨幅；涨幅红涨/绿跌/零灰（冻结配色，与 phasePriceColor
   同约定）；背景随主题令牌（--surface-*），深浅主题均可见；纯信息层不拦截指针 */
.hover-card { position: absolute; z-index: 7; width: 128px; box-sizing: content-box; padding: 7px 9px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; background: var(--surface-background, #fff); color: var(--text-primary, #25364b); box-shadow: 0 5px 18px rgba(0,0,0,.18); font-size: 11px; line-height: 16px; pointer-events: none; display: grid; gap: 1px; }
.hover-card-date { font-weight: 600; margin-bottom: 2px; }
.hover-card-row { display: flex; justify-content: space-between; gap: 10px; }
.hover-card-label { color: var(--text-secondary, #5c7187); }
.hover-card-value { font-variant-numeric: tabular-nums; }
.hover-card-value.pct-up { color: #ef4444; font-weight: 600; }
.hover-card-value.pct-down { color: #16a34a; font-weight: 600; }
.hover-card-value.pct-flat { color: #94a3b8; font-weight: 600; }
.select-rect { display: none; position: absolute; top: 0; height: 100%; border: 1px solid #2563eb; background: rgba(37,99,235,.08); pointer-events: none; z-index: 5; }
.ctx-menu { position: absolute; z-index: 8; display: grid; min-width: 128px; padding: 4px; background: #fff; border: 1px solid #dfe5eb; border-radius: 6px; box-shadow: 0 4px 16px rgba(15,23,42,.14); }
.ctx-menu button { border: 0; background: transparent; text-align: left; padding: 7px 10px; font-size: 12px; color: #334155; border-radius: 4px; }
.ctx-menu button:hover { background: #eef2f7; }
.overlay-edit-panel { position: absolute; z-index: 8; width: 208px; padding: 12px; background: #fff; border: 1px solid #dfe5eb; border-radius: 6px; box-shadow: 0 4px 16px rgba(15,23,42,.14); display: grid; gap: 8px; font-size: 12px; color: #334155; }
.overlay-edit-panel { max-height: calc(100% - 8px); overflow-y: auto; max-width: calc(100% - 8px); }
.text-edit-panel { position: absolute; z-index: 9; width: 272px; max-width: calc(100% - 8px); max-height: calc(100% - 8px); overflow: auto; padding: 12px; display: grid; gap: 9px; border: 1px solid #94a3b8; border-radius: 6px; background: #ffffff; color: #334155; font-size: 12px; }
.text-edit-panel textarea { resize: vertical; min-height: 60px; width: 100%; font: inherit; }
.text-edit-panel label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.text-edit-panel input[type='number'] { width: 70px; }
.text-style-options, .text-edit-panel .panel-actions { display: flex; gap: 12px; }
.text-edit-panel .panel-actions button { flex: 1; padding: 6px; }
body.dark .text-edit-panel { background: var(--surface-background); color: var(--text-primary); border-color: var(--surface-border); }
body.dark .text-edit-panel textarea, body.dark .text-edit-panel input { background: var(--control-background); color: var(--text-primary); border: 1px solid var(--surface-border); }
.overlay-edit-panel .panel-title { font-weight: 650; cursor: move; user-select: none; touch-action: none; }
.overlay-edit-panel .field-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overlay-edit-panel .field-label { flex: 0 0 auto; }
.overlay-edit-panel input[type='number'], .overlay-edit-panel select { flex: 1; min-width: 0; height: 26px; border: 1px solid #d5dde7; border-radius: 3px; padding: 0 6px; background: #fff; color: #233044; }
.overlay-edit-panel input[type='color'] { width: 40px; height: 26px; padding: 1px; border: 1px solid #d5dde7; border-radius: 3px; background: #fff; }
.overlay-edit-panel input[type='number']:hover, .overlay-edit-panel select:hover { border-color: #94bec5; }
.overlay-edit-panel .panel-actions { display: flex; gap: 8px; margin-top: 2px; }
.overlay-edit-panel .panel-actions button { flex: 1; height: 28px; border: 1px solid #d7dfe7; border-radius: 3px; background: #fafcfd; color: #5c7187; }
.overlay-edit-panel .panel-actions button:first-child { border-color: #2e8191; background: #eaf5f6; color: #245a72; font-weight: 600; }
body.dark .ctx-menu, body.dark .overlay-edit-panel { background: var(--surface-background); border-color: var(--surface-border); color: var(--text-primary); }
body.dark .ctx-menu button { color: var(--text-primary); }
body.dark .ctx-menu button:hover { background: var(--surface-hover); }
body.dark .overlay-edit-panel input[type='number'], body.dark .overlay-edit-panel select { background: var(--control-background); border-color: var(--surface-border); color: var(--text-primary); }
body.dark .overlay-edit-panel input[type='color'] { background: var(--control-background); border-color: var(--surface-border); }
body.dark .overlay-edit-panel .panel-actions button { background: var(--control-background); border-color: var(--surface-border); color: var(--text-secondary); }
body.dark .overlay-edit-panel .panel-actions button:first-child { background: var(--surface-selected); border-color: var(--surface-border); color: var(--text-primary); }
.multi-rect { position: absolute; border: 1px dashed #38bdf8; background: rgba(56,189,248,.08); pointer-events: none; z-index: 5; }
/* 多选成员锚点：黄芯白圈 18px，与库单选选中态锚点（activeRadius 7 + border 2）同视觉；随 updateAnchorDots 重算 */
.anchor-dot { position: absolute; width: 18px; height: 18px; border: 2px solid #ffffff; border-radius: 50%; background: #f5c343; pointer-events: none; z-index: 6; box-sizing: border-box; }
.edit-tabs { display: flex; flex-wrap: wrap; gap: 3px; }
.edit-tabs button { border: 1px solid #d7dfe7; background: #fafcfd; padding: 3px 8px; font-size: 11px; color: #5c7187; border-radius: 3px; }
.edit-tabs button.active { border-color: #2e8191; background: #eaf5f6; color: #245a72; font-weight: 600; }
.panel-count { color: #8a98aa; font-size: 11px; font-weight: 400; }
body.dark .edit-tabs button { background: var(--control-background); border-color: var(--surface-border); color: var(--text-secondary); }
body.dark .edit-tabs button.active { background: var(--surface-selected); border-color: var(--surface-border); color: var(--text-primary); }
body.dark .panel-count { color: var(--text-muted); }
</style>
