<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, type Chart, type DataLoadMore, type KLineData } from 'klinecharts'
import '../overlays'
import '../indicators'
import { chartStyles, theme, DRAW_DEFAULT_COLOR } from '../theme'
import type { Bar, Timeframe, TradeView } from '../api'

const props = withDefaults(defineProps<{
  bars: Bar[]
  trades: TradeView[]
  costPrice: number | null
  chartCostPrice?: number | null
  timeframe?: Timeframe
  defaultCount?: number
  /** 是否还有更早历史可动态加载（初始窗口） */
  hasMoreBars?: boolean
  /** 视窗移到已加载窗口之前时取更早历史（每批独立请求） */
  fetchEarlier?: (before: string, count: number) => Promise<{ bars: Bar[]; hasMore: boolean }>
  /** 当前画线工具（null＝默认模式）：画线模式下框选手势与 Space/B/S 热键被隔离 */
  drawTool?: string | null
}>(), { chartCostPrice: null, timeframe: '1D' as Timeframe, defaultCount: 150, hasMoreBars: false, drawTool: null })

const emit = defineEmits<{ visibleCount: [number]; toolChange: [string | null] }>()
const host = ref<HTMLElement | null>(null)
let chart: Chart | null = null
// 缩放范围：1~420 为"同屏可见根数"上下限；420 不是加载总量，更早历史按需动态加载
const MIN_COUNT = 1
const MAX_COUNT = 420
const RIGHT_MARGIN = 80
// klinecharts 默认单根柱宽上限 50px（barSpaceLimit.max），框选少于约 18 根时请求的柱宽超限被静默忽略成平移；
// 提高到 300 以支持"选中几根就放大到铺满"（依赖钉定的 klinecharts 10.0.3 内部结构，升级需复查）
const BAR_SPACE_MAX = 300
const LOAD_CHUNK_BARS = 300
let crossIndex = -1
let selecting = false
let selectStartX = 0
let hostRect: DOMRect | null = null
// 框选绘图区边界（每次框选启动时计算）：水平止于价格轴左缘、垂直止于时间轴上缘——
// 价格轴/时间轴是 K 线图外部的坐标轴，选中框与选点坐标不得侵入（用户 D1 验收反馈）
let plotBounds: { right: number; top: number; bottom: number } | null = null
// 组件内持有累进后的全量数据（初始窗口 + 动态加载的更早历史）
let loadedData: KLineData[] = []
let hasMoreForward = false
let loadingForward = false

function clampCount(value: number): number { return Math.min(MAX_COUNT, Math.max(MIN_COUNT, value)) }
function clampBarSpace(space: number): number { return Math.min(BAR_SPACE_MAX, Math.max(1, space)) }
function dateTimestamp(date: string): number { return Date.parse(`${date.length === 7 ? `${date}-01` : date}T00:00:00Z`) }
// date 必须随对象保留：动态加载的 before 参数取自 loadedData[0].date（KLineData 本身只有 timestamp）
function toK(bar: Bar): KLineData & { date: string } { return { timestamp: dateTimestamp(bar.date), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, date: bar.date } }

async function loadEarlierBars(callback: (data: KLineData[], more?: DataLoadMore) => void): Promise<void> {
  const first = loadedData[0] as (KLineData & { date?: string }) | undefined
  if (!first?.date || loadingForward || !props.fetchEarlier) { callback([], { forward: hasMoreForward }); return }
  loadingForward = true
  try {
    // 库的 forward 前插是自锚定的（可见范围按 diff+total 推算，diff 不变 → 同名日期不动），
    // 不要再做任何锚定/补偿滚动——额外滚动会把滚动差值打到负极限，引发视图塌缩与加载风暴
    const result = await props.fetchEarlier(first.date, LOAD_CHUNK_BARS)
    const older = result.bars.map(toK)
    if (older.length) loadedData = [...older, ...loadedData]
    hasMoreForward = result.hasMore
    callback(older, { forward: result.hasMore })
  } catch {
    callback([], { forward: hasMoreForward })
  } finally {
    loadingForward = false
  }
}

function feedData(): void {
  if (!chart) return
  loadedData = props.bars.map(toK)
  hasMoreForward = props.hasMoreBars
  chart.setDataLoader({
    getBars: ({ type, callback }) => {
      if (type === 'forward') { void loadEarlierBars(callback); return }
      if (type === 'update') return
      callback(loadedData, { forward: hasMoreForward, backward: false })
    },
  })
  applyLastPriceStyle()
  refreshMarks()
}

// 国内口径：最新价线线体/轴标签的方向色由 klinecharts 按 priceMark.last.upColor 系
// （相对前收，见 theme.ts）自动计算；这里按同一口径（涨跌相对前收）重涂标签底色，
// 保证标签与线体一致。跳空日阴阳与涨跌可能相反，不能按当日阴阳取色。
function applyLastPriceStyle(): void {
  if (!chart) return
  const last = props.bars.at(-1)
  if (!last) return
  const prev = props.bars.at(-2)
  const color = prev ? (last.close > prev.close ? '#ef4444' : last.close < prev.close ? '#16a34a' : '#94a3b8') : '#94a3b8'
  chart.setStyles({ candle: { priceMark: { last: { text: { backgroundColor: color, color: '#ffffff' } } } } })
}

function tradeTimestamp(date: string): number {
  if (props.timeframe === '1W') { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day.getTime() }
  if (props.timeframe === '1M') return Date.parse(`${date.slice(0, 7)}-01T00:00:00Z`)
  return Date.parse(`${date}T00:00:00Z`)
}

function refreshMarks(): void {
  if (!chart) return
  chart.removeOverlay({ name: 'bsMark' }); chart.removeOverlay({ name: 'costLine' })
  for (const trade of props.trades) chart.createOverlay({ name: 'bsMark', points: [{ timestamp: tradeTimestamp(trade.date), value: trade.chartPrice ?? trade.price }], extendData: { side: trade.side, shares: trade.shares, price: trade.chartPrice ?? trade.price } })
  const cost = props.chartCostPrice ?? props.costPrice
  if (cost !== null && cost > 0) chart.createOverlay({ name: 'costLine', points: [{ value: cost }], extendData: cost })
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
function zoomBy(factor: number): void { if (!chart) return; const range = chart.getVisibleRange(); const count = Math.max(1, range.to - range.from); const next = clampCount(Math.round(count * factor)); if (next === count) return; restoreYAxisAutoFit(); const width = chart.getSize('candle_pane')?.width ?? 800; chart.setBarSpace(clampBarSpace((width - RIGHT_MARGIN) / next)); chart.scrollToDataIndex(range.to - 1); emit('visibleCount', next) }
function moveCrosshair(delta: number): void { if (!chart) return; const range = chart.getVisibleRange(); if (crossIndex < range.from || crossIndex >= range.to) crossIndex = range.to - 1; crossIndex = Math.min(range.to - 1, Math.max(range.from, crossIndex + delta)); const bar = chart.getDataList()[crossIndex]; if (!bar) return; const pixel = chart.convertToPixel({ dataIndex: crossIndex, value: bar.close }, { paneId: 'candle_pane' }); const pane = chart.getSize('candle_pane'); chart.executeAction('onCrosshairChange', { x: pixel?.x ?? 0, y: pane ? pane.height / 2 : 100, paneId: 'candle_pane' }) }
function resetView(): void { if (!chart) return; crossIndex = -1; chart.executeAction('onCrosshairChange', {}); restoreYAxisAutoFit(); const width = chart.getSize('candle_pane')?.width ?? 800; chart.setBarSpace(Math.max(2, (width - RIGHT_MARGIN) / props.defaultCount)); chart.scrollToRealTime(0); emit('visibleCount', props.defaultCount) }
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
// VOL/MACD 副图与坐标轴区域不触发框选。B/S 标记与成本线是 ignoreEvent 的纯渲染层，
// 不拦截指针事件，因此不会与框选互相干扰。
// 价格轴（主图 y 轴）区域判定：klinecharts 原生在轴上滚轮缩放纵轴比例。
// 平移、框选都必须避开该区域，避免与纵轴缩放互相干扰（用户口径：两种滚轮逻辑分离）。
// 注意：getSize 的 bounding 只可靠提供 left/top/width/height（right/bottom 恒 0）
function isOverPriceAxis(clientX: number, clientY: number): boolean {
  if (!chart) return false
  if (!hostRect) hostRect = host.value?.getBoundingClientRect() ?? null
  const zone = chart.getSize('candle_pane', 'yAxis')
  if (!zone || !hostRect) return false
  const x = clientX - hostRect.left
  const y = clientY - hostRect.top
  return x >= zone.left && x <= zone.left + zone.width && y >= zone.top && y <= zone.top + zone.height
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !chart) return
  // 画线模式下不启动框选：事件放行给 klinecharts overlay 取点交互（三态模式机隔离）
  if (props.drawTool) return
  if (paneIdAt(event.clientY) !== 'candle_pane') return
  hostRect = host.value?.getBoundingClientRect() ?? null
  // 指针命中用户画线：放行给库内选择/拖拽，不启动框选——否则拖动已画线段会触发框选缩放（用户 D1 验收反馈）
  if (isOverUserOverlay(event.clientX, event.clientY)) return
  if (isOverPriceAxis(event.clientX, event.clientY)) return
  selecting = true
  computePlotBounds()
  selectStartX = hostX(event.clientX)
  chart.setScrollEnabled(false)
  const rect = selectionRect(); if (rect) { rect.style.left = `${selectStartX}px`; rect.style.width = '0px'; rect.style.display = 'block'; if (plotBounds) { rect.style.top = `${plotBounds.top}px`; rect.style.height = `${Math.max(0, plotBounds.bottom - plotBounds.top)}px` } }
}
function onPointerMove(event: PointerEvent): void {
  if (!selecting) return
  const current = hostX(event.clientX); const rect = selectionRect()
  if (rect) { rect.style.left = `${Math.min(selectStartX, current)}px`; rect.style.width = `${Math.abs(current - selectStartX)}px` }
}
function onPointerUp(event: PointerEvent): void {
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
    chart.setBarSpace(clampBarSpace(drawable / count)); chart.scrollToDataIndex(Math.max(from, to)); emit('visibleCount', count)
  } else {
    // 左滑：按滑动距离占主图宽度的比例缩小，容纳更多 K 线；右端锚定不动。
    const dragWidth = selectStartX - end
    if (dragWidth < 12) return
    restoreYAxisAutoFit()
    const range = chart.getVisibleRange()
    const current = Math.max(1, range.to - range.from)
    const count = clampCount(Math.round(current * drawable / dragWidth))
    chart.setBarSpace(clampBarSpace(drawable / count)); chart.scrollToDataIndex(range.to - 1); emit('visibleCount', count)
  }
}
function onPaneDblClick(event: MouseEvent): void {
  if (!chart) return
  const paneId = paneIdAt(event.clientY)
  if (!paneId || paneId === 'candle_pane' || paneId === 'x_axis_pane') return
  const panes = chart.getPaneOptions(); const list = (Array.isArray(panes) ? panes : [panes]) as Array<{ id: string; state?: string }>
  const maximized = list.find(pane => pane.id === paneId)?.state === 'maximize'
  for (const pane of list) if (pane.state === 'maximize' && pane.id !== paneId) chart.setPaneOptions({ id: pane.id, state: 'normal' })
  chart.setPaneOptions({ id: paneId, state: maximized ? 'normal' : 'maximize' })
}
// 用户画线命中判定：指针落在画线锚点（±8px）或线体（点到线段距离≤7px）上时，放行给库内选择/拖拽，
// 不启动框选——否则拖动已画线段会与框选缩放重叠（用户 D1 验收反馈）。阈值与计划 D25 hover 加粗一致。
// 仅检测用户画线（排除引擎标记与取点中的 overlay），点位经 convertToPixel 还原为像素后做几何判定。
function isOverUserOverlay(clientX: number, clientY: number): boolean {
  if (!chart || !hostRect) return false
  const x = clientX - hostRect.left
  const y = clientY - hostRect.top
  const engineMarks = new Set(['bsMark', 'costLine'])
  const overlays = (chart.getOverlays() as Array<{ name: string; isDrawing: () => boolean; points: Array<{ timestamp?: number; value?: number }> }>)
    .filter(overlay => !engineMarks.has(overlay.name) && !overlay.isDrawing())
  for (const overlay of overlays) {
    const coords = overlay.points
      .filter(point => point.timestamp !== undefined && point.value !== undefined)
      .map(point => chart.convertToPixel({ timestamp: point.timestamp, value: point.value }, { paneId: 'candle_pane' }))
    for (const coordinate of coords) if (coordinate && Math.hypot(coordinate.x - x, coordinate.y - y) <= 8) return true
    for (let i = 0; i + 1 < coords.length; i++) {
      const a = coords[i]; const b = coords[i + 1]
      if (!a || !b) continue
      if (distanceToSegment(x, y, a, b) <= 7) return true
    }
  }
  return false
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
}

onMounted(() => { if (!host.value) return; chart = init(host.value, { locale: 'zh-CN', timezone: 'Asia/Shanghai', styles: chartStyles(theme.value) }); const layout = (chart as unknown as { _chartStore?: { getLayoutOptions?: () => { barSpaceLimit?: { max?: number } } } })._chartStore?.getLayoutOptions?.(); if (layout?.barSpaceLimit) layout.barSpaceLimit.max = BAR_SPACE_MAX; chart.setSymbol({ ticker: 'training', pricePrecision: 2, volumePrecision: 0 }); chart.setPeriod({ type: 'day', span: 1 }); chart.setOffsetRightDistance(RIGHT_MARGIN); chart.setZoomEnabled(false); chart.setLeftMinVisibleBarCount(MIN_COUNT); chart.setRightMinVisibleBarCount(1); chart.createIndicator({ name: 'MA', calcParams: [25, 60, 144], paneId: 'candle_pane', styles: { lines: [{ color: '#f5a623' }, { color: '#54b8cc' }, { color: '#c793e0' }] } }, true); chart.createIndicator({ name: 'VOL', styles: { bars: [{ upColor: '#ef4444', downColor: '#16a34a', noChangeColor: '#94a3b8' }] } }, false); chart.createIndicator({ name: 'MACD', styles: { lines: [{ color: '#f2f2f2' }, { color: '#f5c343' }] } }, false); chart.subscribeAction('onVisibleRangeChange', () => emit('visibleCount', visibleCount())); host.value.addEventListener('wheel', onWheel, { passive: false }); host.value.addEventListener('pointerdown', onPointerDown, true); host.value.addEventListener('dblclick', onPaneDblClick); host.value.addEventListener('contextmenu', suppressNativeContextMenu); window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); window.addEventListener('keydown', onPanelKeydown, true); window.addEventListener('pointerdown', onGlobalPointerDown, true); feedData(); resetView() })
onUnmounted(() => { host.value?.removeEventListener('wheel', onWheel); host.value?.removeEventListener('pointerdown', onPointerDown, true); host.value?.removeEventListener('dblclick', onPaneDblClick); host.value?.removeEventListener('contextmenu', suppressNativeContextMenu); window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('keydown', onPanelKeydown, true); window.removeEventListener('pointerdown', onGlobalPointerDown, true); chart?.destroy(); chart = null })
// 画线模式机：工具激活＝创建无 points 的 overlay 进入库内交互取点（step 模式，逐点点击）；
// 取点期间锁定拖拽平移，避免取点与视图平移互相干扰；退出/切换工具前取消未完成的取点。
// 一次性语义：取点完成（onDrawEnd）即自动退回默认模式。库不处理 Esc，取消由 cancelDrawing 完成。
// D2：所有用户画线挂 onSelected/onDeselected（Delete 删除依据）与 onRightClick（接管库默认"右键即删除"）。
function cancelDrawing(): void {
  if (!chart) return
  const drawing = (chart.getOverlays() as Array<{ id: string; isDrawing?: () => boolean }>).find(o => o.isDrawing?.())
  if (drawing) chart.removeOverlay({ id: drawing.id })
}
watch(() => props.drawTool, tool => {
  if (!chart) return
  cancelDrawing()
  if (tool) {
    chart.setScrollEnabled(false)
    chart.createOverlay({
      name: tool,
      mode: 'normal',
      onDrawEnd: () => emit('toolChange', null),
      onSelected: event => { selectedOverlayId.value = event.overlay.id },
      onDeselected: event => { if (selectedOverlayId.value === event.overlay.id) selectedOverlayId.value = null },
      onRightClick: event => {
        event.preventDefault?.()
        // 取点中右键＝取消绘制；取消后取点交互已随 overlay 移除终止，须同步退出画线模式避免死态
        if (event.overlay.isDrawing()) { cancelDrawing(); emit('toolChange', null); return }
        openCtxMenu(event.overlay.id, event.x, event.y)
      },
    })
  } else {
    chart.setScrollEnabled(true)
  }
})

// D2 右键菜单与编辑划线面板：锚定图表宿主层内并钳制边界（口径修订七）。
// 库默认行为是"右键命中画线即删除"，已在 createOverlay 的 onRightClick 里 preventDefault 接管。
const ctxMenu = ref<{ x: number; y: number; overlayId: string } | null>(null)
const editPanel = ref<{ x: number; y: number; overlayId: string } | null>(null)
const selectedOverlayId = ref<string | null>(null)
const editForm = ref({ color: DRAW_DEFAULT_COLOR, size: 1, style: 'dashed' as 'solid' | 'dashed' | 'dotted', values: [] as number[] })
function clampToHost(value: number, size: number, limit: number): number { return Math.max(4, Math.min(value, Math.max(4, limit - size - 4))) }
function closePanels(): void { ctxMenu.value = null; editPanel.value = null }
function openCtxMenu(overlayId: string, x: number, y: number): void {
  if (!host.value) return
  const rect = host.value.getBoundingClientRect()
  ctxMenu.value = { overlayId, x: clampToHost(x, 150, rect.width), y: clampToHost(y, 92, rect.height) }
  editPanel.value = null
}
function removeViaMenu(): void {
  if (!chart || !ctxMenu.value) return
  const id = ctxMenu.value.overlayId
  if (selectedOverlayId.value === id) selectedOverlayId.value = null
  chart.removeOverlay({ id })
  closePanels()
}
function openEditPanel(): void {
  if (!chart || !ctxMenu.value) return
  const { overlayId, x, y } = ctxMenu.value
  const overlay = chart.getOverlays({ id: overlayId })[0]
  if (!overlay) { closePanels(); return }
  const line = (overlay.styles?.line ?? {}) as { color?: string; size?: number; style?: string; dashedValue?: number[] }
  // 库内像素→价格换算产生长浮点，回读按价格精度（两位小数）取整
  editForm.value = {
    color: line.color ?? DRAW_DEFAULT_COLOR,
    size: line.size ?? 1,
    style: (line.style ?? 'dashed') === 'dashed' ? ((line.dashedValue?.[0] ?? 4) <= 3 ? 'dotted' : 'dashed') : 'solid',
    values: overlay.points.map(point => Number((point.value ?? 0).toFixed(2))),
  }
  if (!host.value) return
  const rect = host.value.getBoundingClientRect()
  editPanel.value = { overlayId, x: clampToHost(x, 214, rect.width), y: clampToHost(y, 300, rect.height) }
  ctxMenu.value = null
}
function applyEdit(): void {
  if (!chart || !editPanel.value) return
  const id = editPanel.value.overlayId
  const overlay = chart.getOverlays({ id })[0]
  if (overlay) {
    const line: { color: string; size: number; style: 'solid' | 'dashed'; dashedValue?: number[] } = { color: editForm.value.color, size: editForm.value.size, style: editForm.value.style === 'solid' ? 'solid' : 'dashed' }
    if (editForm.value.style !== 'solid') line.dashedValue = editForm.value.style === 'dotted' ? [2, 4] : [6, 4]
    const points = overlay.points.map((point, index) => ({ ...point, value: editForm.value.values[index] }))
    chart.overrideOverlay({ id, styles: { line }, points })
  }
  closePanels()
}
// Delete 键删除选中画线（选中态来自 onSelected/onDeselected；引擎标记不可选中、不受影响）
function deleteSelected(): boolean {
  if (!chart || !selectedOverlayId.value) return false
  const id = selectedOverlayId.value
  selectedOverlayId.value = null
  closePanels()
  return chart.removeOverlay({ id })
}
// 菜单/面板打开期间：Esc 关闭；训练热键拦截防误操作（capture 先于 Training 的 window 冒泡监听）
function onPanelKeydown(event: KeyboardEvent): void {
  if (!ctxMenu.value && !editPanel.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanels(); return }
  if (event.code === 'Space' || ['b', 'B', 's', 'S'].includes(event.key) || event.key === 'Delete') { event.preventDefault(); event.stopPropagation() }
}
// 点击菜单/面板以外区域时关闭（capture 阶段，先于其他处理）
function onGlobalPointerDown(event: PointerEvent): void {
  if (!ctxMenu.value && !editPanel.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.ctx-menu, .overlay-edit-panel')) return
  closePanels()
}
function suppressNativeContextMenu(event: MouseEvent): void { event.preventDefault() }
watch(() => props.bars, feedData); watch(() => [props.trades, props.costPrice, props.chartCostPrice], refreshMarks); watch(theme, value => { chart?.setStyles(chartStyles(value)); applyLastPriceStyle() })
defineExpose({ zoomBy, moveCrosshair, resetView, deleteSelected })
</script>

<template>
  <div class="chart-wrap">
    <div ref="host" class="chart-host"></div>
    <div class="select-rect"></div>
    <!-- 右键菜单/编辑划线面板：锚定图表宿主层内并钳制边界（口径修订七） -->
    <div v-if="ctxMenu" class="ctx-menu" :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }">
      <button @click="openEditPanel">编辑划线</button>
      <button @click="removeViaMenu">删除画线</button>
    </div>
    <div v-if="editPanel" class="overlay-edit-panel" :style="{ left: `${editPanel.x}px`, top: `${editPanel.y}px` }">
      <div class="panel-title">编辑划线</div>
      <label>颜色<input v-model="editForm.color" type="color"></label>
      <label>粗细<select v-model.number="editForm.size"><option v-for="s in [1, 2, 3, 4, 5]" :key="s" :value="s">{{ s }}px</option></select></label>
      <label>样式<select v-model="editForm.style"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
      <label v-for="(_, i) in editForm.values" :key="i">端点{{ i + 1 }}价位<input v-model.number="editForm.values[i]" type="number" step="0.01"></label>
      <div class="panel-actions"><button @click="applyEdit">确定</button><button @click="closePanels">取消</button></div>
    </div>
  </div>
</template>

<style scoped>
.chart-wrap { position: relative; width: 100%; height: 100%; overflow: hidden; user-select: none; }
.chart-host { width: 100%; height: 100%; }
.select-rect { display: none; position: absolute; top: 0; height: 100%; border: 1px solid #2563eb; background: rgba(37,99,235,.08); pointer-events: none; z-index: 5; }
.ctx-menu { position: absolute; z-index: 8; display: grid; min-width: 128px; padding: 4px; background: #fff; border: 1px solid #dfe5eb; border-radius: 6px; box-shadow: 0 4px 16px rgba(15,23,42,.14); }
.ctx-menu button { border: 0; background: transparent; text-align: left; padding: 7px 10px; font-size: 12px; color: #334155; border-radius: 4px; }
.ctx-menu button:hover { background: #eef2f7; }
.overlay-edit-panel { position: absolute; z-index: 8; width: 208px; padding: 12px; background: #fff; border: 1px solid #dfe5eb; border-radius: 6px; box-shadow: 0 4px 16px rgba(15,23,42,.14); display: grid; gap: 8px; font-size: 12px; color: #334155; }
.overlay-edit-panel .panel-title { font-weight: 650; }
.overlay-edit-panel label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.overlay-edit-panel input[type='number'], .overlay-edit-panel select { flex: 1; min-width: 0; height: 26px; border: 1px solid #d5dde7; border-radius: 3px; padding: 0 6px; background: #fff; color: #233044; }
.overlay-edit-panel input[type='color'] { width: 40px; height: 26px; padding: 1px; border: 1px solid #d5dde7; border-radius: 3px; background: #fff; }
.overlay-edit-panel .panel-actions { display: flex; gap: 8px; margin-top: 2px; }
.overlay-edit-panel .panel-actions button { flex: 1; height: 28px; border: 1px solid #d7dfe7; border-radius: 3px; background: #fafcfd; color: #5c7187; }
.overlay-edit-panel .panel-actions button:first-child { border-color: #2e8191; background: #eaf5f6; color: #245a72; font-weight: 600; }
body.dark .ctx-menu, body.dark .overlay-edit-panel { background: #1b2836; border-color: #2c3f57; color: #d5e0ec; }
body.dark .ctx-menu button { color: #c9d6e4; }
body.dark .ctx-menu button:hover { background: #243550; }
body.dark .overlay-edit-panel input[type='number'], body.dark .overlay-edit-panel select { background: #223349; border-color: #32465f; color: #d5e0ec; }
body.dark .overlay-edit-panel input[type='color'] { background: #223349; border-color: #32465f; }
body.dark .overlay-edit-panel .panel-actions button { background: #223349; border-color: #32465f; color: #aebfd2; }
body.dark .overlay-edit-panel .panel-actions button:first-child { background: #1d4253; border-color: #3a8ba0; color: #9adbe8; }
</style>
