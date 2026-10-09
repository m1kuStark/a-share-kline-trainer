import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { exerciseChartZoom } from './helpers/chart-zoom'

const chartPath = new URL('../../web/src/components/KlineChart.vue', import.meta.url)
const trainingPath = new URL('../../web/src/views/Training.vue', import.meta.url)
const historyPath = new URL('../../web/src/views/History.vue', import.meta.url)
const reportPath = new URL('../../web/src/components/HistoryReport.vue', import.meta.url)
const appPath = new URL('../../web/src/App.vue', import.meta.url)
const launcherPath = new URL('../../web/src/views/Launcher.vue', import.meta.url)
const rankingsPath = new URL('../../web/src/views/Rankings.vue', import.meta.url)

describe('M2 chart interaction contract', () => {
  it('routes recordings separately from settled training history and displays each recording source', async () => {
    const source = await readFile(appPath, 'utf8')
    expect(source).toMatch(/<RecordingLibrary v-else-if="view === 'library'"/)
    expect(source).toMatch(/<History v-else-if="view === 'history'"/)
    const library = await readFile(new URL('../../web/src/components/RecordingLibrary.vue', import.meta.url), 'utf8')
    expect(library).toMatch(/data-recording-source="local"/)
    expect(library).toMatch(/data-recording-source="imported"/)
    // REC-BULK-01 起列表数据源为 displayItems（props.items + 批量导入补充行），分列过滤语义不变
    expect(library).toMatch(/displayItems\.value\.filter\(item => item\.source === 'local'\)/)
    expect(library).toMatch(/displayItems\.value\.filter\(item => item\.source === 'imported'\)/)
  })
  it('keeps exact stock matches in the clickable suggestion list and exposes search progress', async () => {
    const source = await readFile(launcherPath, 'utf8')
    expect(source).toMatch(/正在检索股票/)
    expect(source).toMatch(/请点击下方检索结果确认股票/)
    expect(source).not.toMatch(/if \(exact\) \{\s*choose\(exact\)/)
  })
  it('renders industry rankings as a picker before opening one industry table', async () => {
    const source = await readFile(rankingsPath, 'utf8')
    expect(source).toMatch(/选择行业板块/)
    expect(source).toMatch(/返回行业列表/)
    expect(source).toMatch(/fetchIndustryRankings\(targetIndustry \|\| undefined\)/)
  })
  it('places the earnings curve before the unbounded trade table in the report', async () => {
    const source = await readFile(reportPath, 'utf8')
    expect(source.indexOf('<h2>收益率曲线</h2>')).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('<h2>收益率曲线</h2>')).toBeLessThan(source.indexOf('<h2>逐笔成交</h2>'))
  })
  it('registers shared transparent measurement labels without changing the Fibonacci tool name', async () => {
    const overlays = await readFile(new URL('../../web/src/drawingOverlays.ts', import.meta.url), 'utf8')
    expect(overlays).toMatch(/\['fibonacciLine', 3\]/)
    expect(overlays).toMatch(/name === 'percentageLine' \|\| name === 'fibonacciLine'/)
    expect(overlays).toMatch(/backgroundColor: 'transparent', borderSize: 0/)
  })
  it('starts box select only on the draw-pane layer and supports right-drag zoom-in / left-drag zoom-out', async () => {
    const source = await readFile(chartPath, 'utf8')
    // 框选在任一绘图 pane 启动（主副图同权，用户 D4 验收拍板），x 轴除外
    expect(source).toMatch(/if \(!isDrawPane\(paneIdAt\(event\.clientY\)\)\) return/)
    expect(source).toMatch(/if \(end >= selectStartX\)/)
    expect(source).toMatch(/const dragWidth = selectStartX - end/)
    expect(source).toMatch(/current \* drawable \/ dragWidth/)
  })

  it('confines box-select visuals and zoom range to the chart plot area, clear of the price/time axes (no leaking into the console)', async () => {
    const source = await readFile(chartPath, 'utf8')
    // 绘图区边界：右缘＝价格轴左缘、底缘＝时间轴上缘（用户 D1 验收反馈：选中框不得侵入坐标轴）
    expect(source).toMatch(/function computePlotBounds\(\): void/)
    expect(source).toMatch(/getSize\('x_axis_pane'\)/)
    expect(source).toMatch(/plotBounds = \{ right: yAxis\.left, top: pane\.top, bottom: xAxis\.top \}/)
    expect(source).toMatch(/Math\.max\(0, Math\.min\(plotBounds\?\.right \?\? hostRect\?\.width \?\? x, x\)\)/)
    expect(source).toMatch(/rect\.style\.top = `\$\{plotBounds\.top\}px`/)
    expect(source).toMatch(/\.chart-wrap \{[^}]*overflow: hidden/)
  })

  it('colors the last price line by change vs previous close in CN convention and re-applies it after theme switches', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function applyLastPriceStyle\(\): void/)
    // Numeric palette/reference behavior is covered by phase-price.test.ts;
    // these assertions retain integration and theme-switch protection.
    expect(source).toMatch(/phasePriceColor\(props\.currentPrice, props\.previousClose\)/)
    expect(source).toMatch(/phasePriceColor\(last\?\.close, prev\?\.close\)/)
    expect(source).toMatch(/watch\(theme, value => \{ chart\?\.setStyles\(chartStyles\(value\)\); applyLastPriceStyle\(\) \}\)/)
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/last: \{ upColor: '#ef4444', downColor: '#16a34a', noChangeColor: '#94a3b8'/)
  })

  it('runs drawings through the M3 mode machine: console-docked toolbar, box-select isolated, trade hotkeys disabled (D1)', async () => {
    const source = await readFile(chartPath, 'utf8')
    // 画线模式下不启动框选：事件放行给 klinecharts overlay 取点交互
    expect(source).toMatch(/if \(props\.drawTool\) return/)
    // 指针命中用户画线（锚点±8px/线体≤7px）时同样放行：拖动已画线段不得触发框选（用户 D1 验收反馈）
    expect(source).toMatch(/if \(hitTestUserOverlay\(event\.clientX, event\.clientY\)\) return/)
    expect(source).toMatch(/function distanceToSegment\(/)
    // 取点期间锁定平移；退出/切换前取消未完成取点（库不处理 Esc，取消自行实现）
    expect(source).toMatch(/function cancelDrawing\(\): void/)
    expect(source).toMatch(/isDrawing\?\.\(\)/)
    expect(source).toMatch(/onDrawEnd: event => \{\s*emit\('toolChange', null\)/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    // 工具条停靠训练控制台底部（用户 D1 验收反馈改定：不遮挡图表），内容区滚动观察
    expect(trainingSource).toMatch(/class="console-scroll"/)
    expect(trainingSource).toMatch(/class="draw-toolbar"/)
    expect(trainingSource).toMatch(/DRAW_TOOLS/)
    expect(trainingSource).toMatch(/drawTool = drawTool === tool\.name \? null : tool\.name/)
    // 画线模式下 Space/B/S 禁用（防误推进/误交易）、Esc 退出、状态条提示
    expect(trainingSource).toMatch(/if \(drawTool\.value\) \{/)
    expect(trainingSource).toMatch(/event\.key === 'Escape'/)
    expect(trainingSource).toMatch(/isShortcut\('buy', event\)/)
    expect(trainingSource).toMatch(/isShortcut\('sell', event\)/)
    expect(trainingSource).toMatch(/画线模式：/)
    expect(trainingSource).toMatch(/:draw-tool="drawTool"/)
    // 绝对定位文本为已裁剪功能（M3 拍板），不得回潮
    expect(source).not.toMatch(/absoluteTexts|__absoluteText/)
  })

  it('replaces the library right-click delete with an edit/delete context menu and supports Delete-key removal (D2)', async () => {
    const source = await readFile(chartPath, 'utf8')
    // 右键接管：preventDefault 抑制库默认"右键即删除"，改为弹出菜单；取点中右键＝取消绘制
    expect(source).toMatch(/onRightClick: event => \{/)
    expect(source).toMatch(/event\.preventDefault\?\.\(\)/)
    expect(source).toMatch(/if \(\(event\.overlay as RuntimeOverlay\)\.isDrawing\(\)\) \{/)
    expect(source).toMatch(/cancelDrawing\(\); emit\('toolChange', null\); return/)
    expect(source).toMatch(/编辑划线/)
    expect(source).toMatch(/删除画线/)
    // 编辑面板四类参数：颜色/粗细/样式/端点价位（不编辑横坐标），确定走 overrideOverlay
    expect(source).toMatch(/type: 'color'|type="color"/)
    expect(source).toMatch(/端点\{\{ i \+ 1 \}\}价位/)
    expect(source).toMatch(/value="solid">实线/)
    expect(source).toMatch(/overrideOverlay\(\{ id: form\.id, styles: \{ line \}, points \}\)/)
    // Delete 删除选中画线（选中态由 onSelected/onDeselected 跟踪）
    expect(source).toMatch(/function deleteSelected\(\): boolean/)
    expect(source).toMatch(/onSelected: event => \{ selectedOverlayId\.value = event\.overlay\.id \}/)
    // 菜单/面板锚定图表宿主层内（口径修订七），打开期间拦截训练热键
    expect(source).toMatch(/function onGlobalPointerDown\(event: PointerEvent\): void/)
    expect(source).toMatch(/function onPanelKeydown\(event: KeyboardEvent\): void/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/isShortcut\('deleteDrawing', event\)/)
    expect(trainingSource).toMatch(/deleteSelected\(\)/)
    // 默认样式（用户 D2 验收反馈）：1px 虚线；端点价位回读按价格两位小数取整
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/line: \{ color: DRAW_DEFAULT_COLOR, size: 1, style: 'dashed', dashedValue: \[4, 4\] \}/)
    expect(source).toMatch(/size: line\.size \?\? 1/)
    expect(source).toMatch(/Number\(\(point\.value \?\? 0\)\.toFixed\(2\)\)/)
    // 编辑表单状态：多选选项卡式（每选中对象一表单）；默认 1px 虚线
    expect(source).toMatch(/type EditForm = \{ id: string; label: string; color: string; size: number; style: 'solid' \| 'dashed' \| 'dotted'; values: number\[\] \}/)
    // D2 补丁：编辑面板标题栏可拖拽（避免遮挡 K 线），拖动中钳制在图表宿主内
    expect(source).toMatch(/function onPanelTitlePointerDown\(event: PointerEvent\): void/)
    expect(source).toMatch(/setPointerCapture\?\.\(event\.pointerId\)/)
    expect(source).toMatch(/panel-title" title="按住标题栏拖动面板"/)
    // D3 验收反馈修复：纵轴缩放自研接管——轴上起拖持续到松手（不随指针移出轴中断），
    // 且框选拖拽不再叠加库对手动纵轴的纵向平移（画线整体上下移动的根因）
    expect(source).toMatch(/function onHostMouseDown\(event: MouseEvent\): void/)
    expect(source).toMatch(/function dispatchSyntheticAxisMove\(event: PointerEvent\): void/)
    expect(source).toMatch(/let axisScaleDrag = false/)
    expect(source).toMatch(/clientX: axisScaleDragX, clientY: event\.clientY/)
    expect(source).toMatch(/host\.value\.addEventListener\('mousedown', onHostMouseDown, true\)/)
    // D3 验收反馈修复：7px 命中与库 2px figure 命中的落差补齐（按画线不再触发整图平移）＋中键拖拽平移整个主图
    expect(source).toMatch(/function onHostMouseDownBubble\(event: MouseEvent\): void/)
    expect(source).toMatch(/hit\.startPressedMove\(\{ dataIndex: coord\.dataIndex, value: coord\.value \}\)/)
    expect(source).toMatch(/store\.setPressedOverlayInfo\(\{ paneId, overlay: hit, figureType: 'other', figureIndex: -1, figure: null \}\)/)
    // 选中态补齐：库 figure 点击分派对水平全宽线体等几何不可靠（Act2e 实证），命中即补齐持久选中
    expect(source).toMatch(/if \(store\.getClickOverlayInfo\(\)\?\.overlay\?\.id !== hit\.id\) \{/)
    expect(source).toMatch(/if \(event\.button === 1\) \{/)
    expect(source).toMatch(/function hitTestUserOverlay\(clientX: number, clientY: number\)/)
    // D3 验收反馈修复：中键纵向平移不受 Space/Home 限制（强制手动模式）＋中键不拖画线（临时锁定）＋射线/直线命中延伸
    expect(source).toMatch(/forEach\(axis => axis\.setAutoCalcTickFlag\(false\)\)/)
    expect(source).toMatch(/userOverlays\.forEach\(overlay => \{ overlay\.lock = true \}\)/)
    // 射线/直线命中几何按图元覆盖范围延伸（overlayHitGeometry）
    expect(source).toMatch(/builtInGeometry\(overlay.name, pts, bounds\)/)
    // 虚线段长统一为库默认 [4,4]（编辑前后渲染一致）；字段改无关联 div 结构（label 点击区溢出修复）
    expect(themeSource).toMatch(/dashedValue: \[4, 4\]/)
    expect(source).toMatch(/dashedValue: form\.style === 'dotted' \? \[2, 4\] : \[4, 4\]/)
    expect(source).toMatch(/class="field-row"/)
    expect(source).not.toMatch(/<label[^>]*class="field-row"/)
  })

  it('registers the ray tool in the drawing registry (D3)', async () => {
    // D3/D4/D5~D7：射线/直线/水平线系入注册表（库内置；命中几何延伸见 overlayHitGeometry）
    const drawToolsSource = await readFile(new URL('../../web/src/drawTools.ts', import.meta.url), 'utf8')
    expect(drawToolsSource).toMatch(/\{ name: 'rayLine', label: '射线' \}/)
    expect(drawToolsSource).toMatch(/\{ name: 'straightLine', label: '直线' \}/)
    expect(drawToolsSource).toMatch(/\{ name: 'horizontalStraightLine', label: '水平直线' \}/)
    expect(drawToolsSource).toMatch(/\{ name: 'horizontalSegment', label: '水平线段' \}/)
    expect(drawToolsSource).toMatch(/\{ name: 'horizontalRayLine', label: '水平射线' \}/)
    const chartSource = await readFile(chartPath, 'utf8')
    // 水平系命中几何与库渲染范围一致：水平直线单点全宽、水平射线沿点2方向延伸到边
    expect(chartSource).toMatch(/builtInGeometry\(overlay.name, pts, bounds\)/)
    expect(chartSource).toMatch(/DRAW_TOOLS.find\(tool => tool.name === name\)/)
  })

  it('supports drawing multi-select: ctrl+click, multi-mode box select, batch delete, tabbed edit panel', async () => {
    const source = await readFile(chartPath, 'utf8')
    // 左键点选画线（Ctrl 组合或多选模式下普通左键——用户 D4 验收反馈）：加入/移出多选集合（点空白清空）
    expect(source).toMatch(/if \(\(event\.ctrlKey \|\| props\.multiSelect\) && !props\.drawTool && event\.button === 0\) \{/)
    expect(source).toMatch(/function toggleMultiSelect\(id: string\): void/)
    // 多选模式：主图空白框选拖拽变为划线批量选中（不缩放 K 线）
    expect(source).toMatch(/multiSelect\?: boolean/)
    expect(source).toMatch(/if \(props\.multiSelect\) \{/)
    expect(source).toMatch(/function selectDrawingsInRect\(/)
    expect(source).toMatch(/class="multi-rect"/)
    // 橡皮筋矩形必须是 ref（multiRect 不可见缺陷两连：const 赋值报错→let 丢响应性；视觉元素必须可断言）
    expect(source).toMatch(/const multiRect = ref<\{ left: number; top: number; width: number; height: number \} \| null>\(null\)/)
    expect(source).toMatch(/multiRect\.value = \{/)
    expect(source).toMatch(/multiRect\.value = null/)
    // 选中标识＝自绘锚点层（库只为 hover/click 选中态绘制锚点，box 选中的画线两者皆非）；
    // 线体绝不变色（与用户自定义线色不冲突）；点空白解除库持久选中（框选拦截吞掉库解除链路的回归）
    expect(source).toMatch(/const anchorDots = ref<Array<\{ key: string; x: number; y: number \}>>\(\[\]\)/)
    expect(source).toMatch(/function updateAnchorDots\(\): void/)
    expect(source).toMatch(/function deselectLibrarySelected\(\): void/)
    expect(source).toMatch(/deselectLibrarySelected\(\)/)
    expect(source).toMatch(/class="anchor-dot"/)
    expect(source).toMatch(/if \(multiSelectedIds\.value\.length\) updateAnchorDots\(\)/)
    expect(source).not.toMatch(/DRAW_MULTI_SELECT_COLOR/)
    expect(source).not.toMatch(/applySelectionVisual|clearSelectionVisual/)
    // 主副图同权：框选/多选/Ctrl 点选/冒泡补齐的门限用 isDrawPane（非 x 轴 pane 一律生效）
    expect(source).toMatch(/function isDrawPane\(paneId: string \| null\): boolean/)
    expect(source).toMatch(/if \(!isDrawPane\(paneIdAt\(event\.clientY\)\)\) return/)
    // 画线命中几何按 overlay.paneId 转换（副图画线的坐标在自己 pane 内）；absolute:true＝host 坐标系（副图 pane top≠0）
    expect(source).toMatch(/\{ paneId: overlay\.paneId \|\| 'candle_pane', absolute: true \}/)
    expect(source).toMatch(/\{ paneId, absolute: true \}/)
    // 选项卡式编辑面板：标签＝类型+中文序号，确定批量应用全部表单
    expect(source).toMatch(/class="edit-tabs"/)
    expect(source).toMatch(/label: labelBase \+ \(cnNums\[n - 1\] \?\? String\(n\)\)/)
    // 批量删除：多选集合非空＝只删集合（画线完成时库的选中态不追加，防误删第三条——journey 抓出）
    expect(source).toMatch(/const ids = multiSelectedIds\.value\.length \? \[\.\.\.multiSelectedIds\.value\] : \(selectedOverlayId\.value \? \[selectedOverlayId\.value\] : \[\]\)/)
    // 多选模式关闭：清空多选集合与选中标识
    expect(source).toMatch(/watch\(\(\) => props\.multiSelect, on => \{ if \(!on\) clearMultiSelection\(\) \}\)/)
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    // 锚点常态/选中态常量同源（theme 全局默认供库 hover/click 选中锚点引用；多选视觉走自绘层，颜色与之一致）
    expect(themeSource).toMatch(/export const DRAW_POINT_DEFAULT = \{ color: DRAW_DEFAULT_COLOR, borderColor: '#ffffff', borderSize: 1, radius: 5 \}/)
    expect(themeSource).toMatch(/export const DRAW_POINT_ACTIVE = \{ color: DRAW_DEFAULT_COLOR, borderColor: '#ffffff', borderSize: 2, radius: 7 \}/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/:multi-select="multiSelectMode"/)
    expect(trainingSource).toMatch(/function toggleMultiSelectMode\(\): void/)
    expect(trainingSource).toMatch(/if \(multiSelectMode.value\) return '多选模式'/)
  })

  it('maps ArrowUp to zoom-in and ArrowDown to zoom-out', async () => {
    const source = await readFile(trainingPath, 'utf8')
    expect(source).toMatch(/isShortcut\('zoomIn', event\)[\s\S]{0,120}?zoomBy\(1 \/ 1\.3\)/)
    expect(source).toMatch(/isShortcut\('zoomOut', event\)[\s\S]{0,120}?zoomBy\(1\.3\)/)
  })

  it('slims MACD histogram bars to 2/5 of the default width', async () => {
    const source = await readFile(new URL('../../web/src/indicators.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/barSpace\.halfGapBar \* 2 \* 0\.4/)
  })

  it('mounts the KDJ subchart pane with an app-preference toggle and equal pane semantics (M6-01)', async () => {
    const indicators = await readFile(new URL('../../web/src/indicators.ts', import.meta.url), 'utf8')
    const chart = await readFile(chartPath, 'utf8')
    const appSettings = await readFile(new URL('../../web/src/appSettings.ts', import.meta.url), 'utf8')
    const app = await readFile(appPath, 'utf8')
    // 注册口径：通达信 9,3,3 与 K/D/J 三线（数值口径由 kdj-indicator.test.ts 的独立 oracle 锁定）
    expect(indicators).toMatch(/name: 'KDJ',\s*\n\s*shortName: 'KDJ',\s*\n\s*calcParams: \[9, 3, 3\],/)
    expect(indicators).toMatch(/key: 'k', title: 'K: ', type: 'line'/)
    expect(indicators).toMatch(/key: 'd', title: 'D: ', type: 'line'/)
    expect(indicators).toMatch(/key: 'j', title: 'J: ', type: 'line'/)
    expect(indicators).toMatch(/calc: \(dataList, indicator\) => computeKdj\(dataList, indicator\.calcParams as number\[\]\)/)
    // 挂载：MA 创建后按偏好统一挂三个副图（M6-04 起 VOL/MACD/KDJ 同走 applySubchartPanes；
    // KDJ 配色为 proposed_default 待验收）
    expect(chart).toMatch(/createIndicator\(\{ name: 'MA'[^;]*\}, true\); applySubchartPanes\(\);/)
    expect(chart).toMatch(/function applySubchartPanes\(\): void/)
    expect(chart).toMatch(/chart\.removeIndicator\(\{ name \}\)/)
    expect(chart).toMatch(/styles: \{ lines: \[\{ color: '#f2f2f2' \}, \{ color: '#f5c343' \}, \{ color: '#d446d6' \}\] \}/)
    // 开关：任一副图偏好切换立即生效（watch），并且不发 chart.viewport（非用户导航）
    expect(chart).toMatch(/watch\(\[appKdjSubchart, appVolSubchart, appMacdSubchart\], \(\) => \{ applySubchartPanes\(\); scheduleChartCapture\(\) \}\)/)
    // 副图同等语义：paneName/actualPaneId 两处判定都纳入 KDJ（画线持久化与录像 paneHeights 的语义名）
    expect(chart.match(/\['VOL', 'MACD', 'KDJ'\]/g)?.length).toBeGreaterThanOrEqual(2)
    // 录像回放边界：目标副图当前不存在时跳过该项，不得把副图高度写回主图
    expect(chart).toMatch(/if \(name !== 'candle_pane' && actualPaneId\(name\) === 'candle_pane'\) continue/)
    // 应用偏好层：localStorage 持久化、默认开（'0' 才是关）
    expect(appSettings).toMatch(/const KDJ_SUBCHART_STORAGE_KEY = 'trainer_kdj_subchart'/)
    expect(appSettings).toMatch(/storage\.getItem\(KDJ_SUBCHART_STORAGE_KEY\) !== '0'/)
    expect(appSettings).toMatch(/storage\.setItem\(KDJ_SUBCHART_STORAGE_KEY, enabled \? '1' : '0'\)/)
    // journey 只读探针：indicatorPanes 暴露语义窗格名（测试专用，不影响生产行为）
    expect(chart).toMatch(/indicatorPanes: \(\) => \(chart\?\.getPaneOptions\(\) as Array<\{ id: string \}> \?\? \[\]\)/)
  })

  it('moves the KDJ/VOL/MACD toggles into the period row with independent persisted preferences (M6-04)', async () => {
    const chart = await readFile(chartPath, 'utf8')
    const training = await readFile(trainingPath, 'utf8')
    const app = await readFile(appPath, 'utf8')
    const appSettings = await readFile(new URL('../../web/src/appSettings.ts', import.meta.url), 'utf8')
    // 三开关与周期按钮（日K/周K/月K）同行同区（股票信息条内），aria-pressed 语义保留
    expect(training).toMatch(/<div class="indicator-toggles" role="group" aria-label="副图指标开关">/)
    expect(training).toMatch(/:aria-pressed="item\.enabled\.value \? 'true' : 'false'"/)
    expect(training).toMatch(/@click="item\.toggle\(!item\.enabled\.value\)"/)
    expect(training).toMatch(/\{ name: 'VOL', label: '[^']+', enabled: appVolSubchart, toggle: setVolSubchart \}/)
    expect(training).toMatch(/\{ name: 'MACD', label: '[^']+', enabled: appMacdSubchart, toggle: setMacdSubchart \}/)
    expect(training).toMatch(/\{ name: 'KDJ', label: '[^']+', enabled: appKdjSubchart, toggle: setKdjSubchart \}/)
    // 顶栏原 KDJ 按钮删除（"记录操作/导出录制/TD 状态"等顶栏元素不动）
    expect(app).not.toMatch(/kdj-toggle|appKdjSubchart|setKdjSubchart/)
    expect(app).toMatch(/class="top-actions"/)
    // 副图增删统一入口：三偏好独立、默认全开、关即移除对应副图
    expect(chart).toMatch(/const SUBCHART_PREFS/)
    expect(chart).toMatch(/VOL: \{ enabled: \(\) => appVolSubchart\.value/)
    expect(chart).toMatch(/MACD: \{ enabled: \(\) => appMacdSubchart\.value/)
    expect(chart).toMatch(/KDJ: \{ enabled: \(\) => appKdjSubchart\.value/)
    expect(chart).toMatch(/for \(const name of \['VOL', 'MACD', 'KDJ'\] as ToggleableIndicator\[\]\)/)
    // 偏好层：VOL/MACD 与 KDJ 同层同机制，localStorage 键独立（'0' 才是关，默认全开＝现状）
    expect(appSettings).toMatch(/const VOL_SUBCHART_STORAGE_KEY = 'trainer_vol_subchart'/)
    expect(appSettings).toMatch(/const MACD_SUBCHART_STORAGE_KEY = 'trainer_macd_subchart'/)
    expect(appSettings).toMatch(/storage\.getItem\(VOL_SUBCHART_STORAGE_KEY\) !== '0'/)
    expect(appSettings).toMatch(/storage\.getItem\(MACD_SUBCHART_STORAGE_KEY\) !== '0'/)
    expect(appSettings).toMatch(/storage\.setItem\(VOL_SUBCHART_STORAGE_KEY, enabled \? '1' : '0'\)/)
    expect(appSettings).toMatch(/storage\.setItem\(MACD_SUBCHART_STORAGE_KEY, enabled \? '1' : '0'\)/)
    // 回放 paneHeights 守卫沿用 KDJ 机制：目标窗格不存在（任一偏好关闭）即跳过该项
    expect(chart).toMatch(/if \(name !== 'candle_pane' && actualPaneId\(name\) === 'candle_pane'\) continue/)
  })

  it('shows a dwell-triggered hover card with OHLC and pct, replacing the badge; the corner legend keeps MA only (M6-03)', async () => {
    const chart = await readFile(chartPath, 'utf8')
    const training = await readFile(trainingPath, 'utf8')
    const replay = await readFile(new URL('../../web/src/views/SessionReplay.vue', import.meta.url), 'utf8')
    const phasePrice = await readFile(new URL('../../web/src/phasePrice.ts', import.meta.url), 'utf8')
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    // 纯函数与冻结延时在 phasePrice.ts（数值/卡内容口径由 percent-hover.test.ts 的独立 oracle 锁定），组件按导入接线
    expect(phasePrice).toMatch(/export const HOVER_CARD_DWELL_MS = 1000/)
    expect(phasePrice).toMatch(/export function formatHoverCard\(/)
    expect(chart).toMatch(/import \{ formatHoverCard, hasPhasePrice, includePhasePriceRange, phasePriceColor, HOVER_CARD_DWELL_MS, type HoverCardModel \} from '\.\.\/phasePrice'/)
    // 停留触发：定时器以 dataIndex 为键（同一根内指针微动不重置计时），延时取冻结常量
    expect(chart).toMatch(/function scheduleHoverCard\(dataIndex: number, anchorX: number, anchorY: number\): void/)
    expect(chart).toMatch(/hoverTimer = setTimeout\(\(\) => \{/)
    expect(chart).toMatch(/\}, HOVER_CARD_DWELL_MS\)/)
    // 移到另一根 K 线＝隐藏并重计时（同根微动只更新锚点，不重置）
    expect(chart).toMatch(/if \(hoverPendingIndex === dataIndex\) \{[\s\S]*?return\r?\n\s*\}/)
    expect(chart).toMatch(/cancelHoverTimer\(\)\r?\n  if \(hoverCard\.value !== null\) hoverCard\.value = null/)
    // 键盘十字线＝立即显示（无延时）：先取消挂起计时再渲染
    expect(chart).toMatch(/function showHoverCardNow\(dataIndex: number, anchorX: number, anchorY: number\): void \{[\s\S]*?cancelHoverTimer\(\)/)
    // 十字线订阅（klinecharts v10 onCrosshairChange）＋指针离开图表立即隐藏（mouseleave）＋卸载解绑
    expect(chart).toMatch(/chart\.subscribeAction\('onCrosshairChange', onCrosshairAction\)/)
    expect(chart).toMatch(/host\.value\.addEventListener\('mouseleave', hideHoverCard\)/)
    expect(chart).toMatch(/host\.value\?\.removeEventListener\('mouseleave', hideHoverCard\)/)
    // 库清除十字线不派发事件（坐标轴/时间轴/图表外），兜底隐藏维持"卡可见 ⇔ 十字线存在"
    expect(chart).toMatch(/if \(outside \|\| isOverPriceAxis\(event\.clientX, event\.clientY\) \|\| !isDrawPane\(paneIdAt\(event\.clientY\)\)\) hideHoverCard\(\)/)
    // 键盘十字线与复位联动：moveCrosshair 立即显示，resetView 清除
    expect(chart).toMatch(/executeAction\('onCrosshairChange', \{ x: pixel\?\.x \?\? 0, y: anchorY, paneId: 'candle_pane' \}\); showHoverCardNow\(crossIndex, pixel\?\.x \?\? 0, anchorY\)/)
    expect(chart).toMatch(/chart\.executeAction\('onCrosshairChange', \{\}\); hideHoverCard\(\)/)
    // 卡位置＝十字线交点右下方、右侧不足翻左侧、钳制绘图区内不遮价格轴/时间轴
    expect(chart).toMatch(/function placeHoverCard\(/)
    expect(chart).toMatch(/if \(x \+ HOVER_CARD_W > plotRight - 4\) x = anchorX - HOVER_CARD_OFFSET - HOVER_CARD_W/)
    // 卡 DOM：v-if 挂载、data-testid 可寻址、纯信息层不拦截指针（框选/拖拽/画线/键盘十字线不受影响）
    expect(chart).toMatch(/data-testid="hover-card"/)
    expect(chart).toMatch(/\.hover-card \{[^}]*pointer-events: none/)
    // v1 徽标 pct-badge 不复存在（DOM/样式/探针一并移除）
    expect(chart).not.toMatch(/pct-badge/)
    // 冻结配色：红涨 #ef4444 / 绿跌 #16a34a / 零灰 #94a3b8（与 phasePriceColor 同约定），背景随主题令牌
    expect(chart).toMatch(/\.hover-card-value\.pct-up \{ color: #ef4444;/)
    expect(chart).toMatch(/\.hover-card-value\.pct-down \{ color: #16a34a;/)
    expect(chart).toMatch(/\.hover-card-value\.pct-flat \{ color: #94a3b8;/)
    expect(chart).toMatch(/\.hover-card \{[^}]*background: var\(--surface-background, #fff\)/)
    // 左上角只留均线（CARD-CORNER-MA-ONLY）：candle legend 模板返回空，OHLC 不再出现于左上角；
    // MA(25,60,144) 数值走库内 indicator tooltip legend（默认 showRule 'always'），不受 candle legend 影响
    const legendBlock = themeSource.match(/candleLegendTemplate[\s\S]{0,300}/)?.[0] ?? ''
    expect(legendBlock).not.toMatch(/开 |高 |低 |收 |成交量|时间/)
    // 回放一致（PCT-REPLAY-PARITY）：卡数据源＝chart.getDataList()（回放数据同路径喂入），
    // 卡计算路径不受 readOnly 门控（只读回放十字线照常可用）
    expect(chart).toMatch(/function buildHoverModel\(dataIndex: number\)[\s\S]*?chart\.getDataList\(\)/)
    const cardSection = chart.slice(chart.indexOf('const hoverCard = ref'), chart.indexOf('function onCrosshairAction'))
    expect(cardSection).not.toMatch(/readOnly/)
    // 两视图共用 KlineChart：训练页与录像回放页都挂载同一组件（卡一处实现两处生效）
    expect(training).toMatch(/<KlineChart/)
    expect(replay).toMatch(/<KlineChart/)
    expect(replay).toMatch(/:bars="observation\.bars"/)
    // 无持久化：卡状态不外发、不进 defineExpose（录像/布局/画线持久层拿不到它）
    expect(chart).not.toMatch(/defineExpose\(\{[^)]*hoverCard/)
    expect(chart).not.toMatch(/emit[^\n]{0,80}hoverCard|hoverCard[^\n]{0,80}emit\(/)
    // journey 只读探针：hoverCard 暴露卡内容/可见性（测试专用，不影响生产行为）
    expect(chart).toMatch(/hoverCard: \(\) => \(\{ visible: hoverCard\.value !== null/)
  })

  it('animates only equity and return-pct as odometers with a final-exact text layer (M6-05)', async () => {
    const training = await readFile(trainingPath, 'utf8')
    const styles = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8')
    const odometer = await readFile(new URL('../../web/src/odometer.ts', import.meta.url), 'utf8')
    // 核心逻辑在纯模块（数值/口径由 odometer.test.ts 的独立 oracle 锁定），组件按导入接线
    // M6-06：滚动层权益帧改经 rollDisplayEquity（取整后格式化，无幻影小数），终值路径不动
    expect(training).toMatch(/import \{ createRollCounter, formatEquity, formatReturnPct, rollDisplayEquity \} from '\.\.\/odometer'/)
    expect(odometer).toMatch(/export const MIN_ROLL_MS = 300/)
    expect(odometer).toMatch(/export const MAX_ROLL_MS = 600/)
    // 作用域（ODO-SCOPE-ONLY-TWO）：只有 equity-block 的两个数字挂 odo 结构；
    // 可用资金/持仓市值/持仓/摊薄成本（account-stats）与结算弹窗两个数字不得接入
    const equityBlock = training.slice(training.indexOf('class="equity-block"'), training.indexOf('class="account-stats"'))
    expect(equityBlock).toMatch(/<strong class="odo-host"/)
    expect(equityBlock).toMatch(/<em class="odo-host"/)
    expect(equityBlock).toMatch(/class="odo-text">\{\{ formatEquity\(account\.equity\) \}\}/)
    expect(equityBlock).toMatch(/class="odo-text">\{\{ formatReturnPct\(returnPct\) \}\}/)
    // 前缀/涨跌配色绑定保持现状（¥ 前缀在 formatEquity 内；em 的 up/down 类不动）
    expect(odometer).toMatch(/return `¥\$\{value\.toLocaleString\('zh-CN', \{ maximumFractionDigits: 2 \}\)\}`/)
    expect(equityBlock).toMatch(/:class="\[returnPct >= 0 \? 'up' : 'down', \{ rolling: returnRoll !== null \}\]"/)
    const accountStats = training.slice(training.indexOf('class="account-stats"'), training.indexOf('class="panel-divider"'))
    expect(accountStats).not.toMatch(/odo-/)
    const settleGrid = training.slice(training.indexOf('class="settle-grid"'), training.indexOf('class="settle-actions"'))
    expect(settleGrid).not.toMatch(/odo-/)
    // 真实文本恒终值＋动画视觉层（终值精确与既有文本断言共存策略）
    expect(equityBlock).toMatch(/aria-hidden="true"/)
    expect(equityBlock).toMatch(/translateY\(\$\{-col\.digit\}lh\)/)
    // 中断重定向与收尾：单一 rAF 泵＋条带过渡收尾后卸视觉层；挂载即静止（不播首屏动画）
    expect(training).toMatch(/const equityCounter = createRollCounter\(account\.value\.equity\)/)
    expect(training).toMatch(/const returnCounter = createRollCounter\(returnPct\.value\)/)
    expect(training).toMatch(/function pumpRoll\(\): void/)
    expect(training).toMatch(/ODO_SETTLE_MS = 120/)
    // M6-05R 语义反转：动效门＝应用偏好（ODO-MOTION-PREF，由下一条用例独立锁定）；
    // 旧"reduced-motion 双道防线"（组件 matchMedia 判定＋CSS 媒体查询兜底隐藏）已随缺陷修复移除
    expect(training).not.toMatch(/matchMedia\(|prefers-reduced-motion:\s*reduce/)
    expect(styles).not.toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.equity-block \.odo-roll/)
    // 样式不变（ODO-STYLE-UNCHANGED 的结构/样式层）：数字位样式只继承宿主（禁新字号/颜色声明），
    // 并显式重置 .equity-block span（含 dark 变体）对数字 span 的污染
    expect(styles).toMatch(/\.equity-block \.odo-host\.rolling \.odo-text \{ opacity: 0; \}/)
    // M6-06 起 dark 重置行追加 tabular-nums 声明（字宽稳定授权扩展；color 重置仍入锁）
    expect(styles).toMatch(/body\.dark \.equity-block span\.odo-roll \{ color: inherit; font-variant-numeric: tabular-nums; \}/)
    const odoStyleBlock = styles.slice(styles.indexOf('===== M6-05'))
    expect(odoStyleBlock).not.toMatch(/font-size: \d|color: #/)
  })

  it('keeps equity roll frames integer-only and digit widths tabular across both odometer layers (M6-06)', async () => {
    // ODO-NO-PHANTOM-DECIMALS＋ODO-WIDTH-STABLE（用户 2026-10-05 验收反馈：
    // ①中间值 ¥1,000,872.45 而终值 ¥1,000,872——幻影小数；②动画中数字位等宽、播完后比例
    // 字宽重排——衔接错位）。数值口径由 odometer.test.ts 独立 oracle 锁定，本用例锁接线与样式契约。
    const training = await readFile(trainingPath, 'utf8')
    const styles = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8')
    const odometer = await readFile(new URL('../../web/src/odometer.ts', import.meta.url), 'utf8')
    // ①滚动层权益帧全部先取整再格式化（纯函数在 odometer.ts 供单测；字面量锁定实现形态）
    expect(odometer).toMatch(/export function rollDisplayEquity\(value: number\): string \{\r?\n\s*return formatEquity\(Math\.round\(value\)\)\r?\n\}/)
    const rollingBranch = training.slice(training.indexOf('function pumpRoll'), training.indexOf('interface RollBinding'))
    expect(rollingBranch).toMatch(/equityRoll\.value = odoColumns\(rollDisplayEquity\(equityCounter\.displayed\(now\)\)\)/)
    // 初帧（beginRoll 经 equityBinding.format）同走取整口径；收益率滚动帧保持 formatReturnPct（两位小数）
    expect(training).toMatch(/counter: equityCounter, roll: equityRoll, format: rollDisplayEquity,/)
    expect(rollingBranch).toMatch(/returnRoll\.value = odoColumns\(formatReturnPct\(returnCounter\.displayed\(now\)\)\)/)
    // settle 帧走终值格式（displayed 已＝账面终值 ⇒ 与真实文本层逐字一致，切换零跳变）
    expect(training).toMatch(/equityRoll\.value = odoColumns\(formatEquity\(equityCounter\.displayed\(now\)\)\)/)
    // 终值文本层不动（模板仍直读 formatEquity(account.equity)，由 M6-05 用例锁定）
    // ②两层数字位统一 tabular-nums（真实文本层 odo-text/odo-char＋动画层 odo-roll/odo-digit，
    //   各含 dark 档——沿用 M6-05 双档重置写法，压过 .equity-block span 污染）
    const odoStyleBlock = styles.slice(styles.indexOf('===== M6-05'))
    expect(odoStyleBlock).toMatch(/\.equity-block span\.odo-text, \.equity-block span\.odo-char \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/)
    expect(odoStyleBlock).toMatch(/body\.dark \.equity-block span\.odo-text, body\.dark \.equity-block span\.odo-char \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/)
    expect(odoStyleBlock).toMatch(/\.equity-block span\.odo-roll \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/)
    expect(odoStyleBlock).toMatch(/body\.dark \.equity-block span\.odo-roll \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/)
    expect(odoStyleBlock).toMatch(/\.equity-block span\.odo-digit \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/)
    expect(odoStyleBlock).toMatch(/body\.dark \.equity-block span\.odo-digit \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/)
    // computed 层（含 dark 主题实际生效）由 e2e odometer.spec 的宽度采样用例锁定
  })

  it('gates the odometer roll on the app motion preference, not the OS reduced-motion query (ODO-MOTION-PREF, M6-05R)', async () => {
    // 用户环境 prefers-reduced-motion 恒 true 导致滚动全程不可见（2026-10-05 验收反馈）：
    // 动效门从 OS 媒体查询改为应用偏好（默认开），逃生阀＝应用开关。独立 oracle（内嵌冻结）：
    // '0'＝关；未设置/异常值＝默认开（＝现状）；写入 '1'/'0'；键名沿用 trainer_* 风格。
    const appSettings = await readFile(new URL('../../web/src/appSettings.ts', import.meta.url), 'utf8')
    const start = appSettings.indexOf('const ODO_MOTION_STORAGE_KEY')
    const end = appSettings.indexOf('export const appOdoMotion')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const exports_: Record<string, unknown> = {}
    new Function('exports', ts.transpile(appSettings.slice(start, end), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(exports_)
    const read = exports_.readOdoMotionPref as (storage: Pick<Storage, 'getItem'>) => boolean
    const write = exports_.writeOdoMotionPref as (storage: Pick<Storage, 'setItem'>, enabled: boolean) => void
    expect(read).toBeTypeOf('function')
    expect(write).toBeTypeOf('function')
    expect(read({ getItem: () => '0' }), "显式 '0'＝关").toBe(false)
    expect(read({ getItem: () => '1' }), "显式 '1'＝开").toBe(true)
    expect(read({ getItem: () => null }), '未设置＝默认开').toBe(true)
    expect(read({ getItem: () => 'garbage' }), '异常值不翻转为关').toBe(true)
    const written: Record<string, string> = {}
    const store = { setItem: (key: string, value: string): void => { written[key] = value } } as Pick<Storage, 'setItem'>
    write(store, false)
    expect(written).toEqual({ trainer_odo_motion: '0' })
    write(store, true)
    expect(written).toEqual({ trainer_odo_motion: '1' })
    expect(appSettings).toMatch(/const ODO_MOTION_STORAGE_KEY = 'trainer_odo_motion'/)
    // 组件门＝应用偏好：beginRoll 不再读媒体查询；关闭＝卸视觉层直显终值
    const training = await readFile(trainingPath, 'utf8')
    expect(training).not.toMatch(/matchMedia\(|prefers-reduced-motion:\s*reduce/)
    expect(training).toMatch(/import \{[^}]*appOdoMotion[^}]*\} from '\.\.\/appSettings'/)
    expect(training).toMatch(/if \(!appOdoMotion\.value\) \{ binding\.roll\.value = null; return \}/)
    // 逃生阀 UI 入口：M6-07 起收纳进设置面板"动画效果"分栏（顶栏胶囊按钮已移除），
    // 入口契约由下方 M6-07 用例锁定，此处不再断言顶栏按钮。
    // styles.css：odo-roll 的 reduce 抑制移除（其余通用 reduce 规则不动，由字面量反向断言锁死）
    const styles = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8')
    expect(styles).not.toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.equity-block \.odo-roll/)
  })

  it('moves the odometer motion switch into an animation-effects settings section and removes the topbar capsule (M6-07)', async () => {
    // 用户 2026-10-05 验收拍板：动画开关应进设置（训练中可调），单独"动画效果"分栏，
    // 未来其它动画统一在此管理；顶栏"滚动"胶囊按钮移除，其余顶栏元素不动。
    // 持久化键沿用 trainer_odo_motion（不换键，由 ODO-MOTION-PREF 用例锁定）。
    const training = await readFile(trainingPath, 'utf8')
    const settings = await readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')
    // 顶栏负向断言：胶囊按钮与其分组容器不复存在（注释亦不留关键词——源码注释也是契约文本）
    expect(training).not.toMatch(/motion-toggle|动效开关/)
    // 设置面板：分栏结构可扩展（activeSection 增 'animation' 档；nav 按钮平铺追加）
    expect(settings).toMatch(/'defaults' \| 'preferences' \| 'animation' \| 'data'/)
    expect(settings).toMatch(/activeSection = 'animation'">动画效果<\/button>/)
    expect(settings).toMatch(/aria-label="动画效果"/)
    // 首项"数字滚动动效"开关：读 appOdoMotion、切换 setOdoMotion（即改即生效，localStorage）
    expect(settings).toMatch(/import \{[^}]*appOdoMotion[^}]*setOdoMotion[^}]*\} from '\.\.\/appSettings'/)
    expect(settings).toMatch(/aria-label="数字滚动动效"/)
    expect(settings).toMatch(/:checked="appOdoMotion"/)
    expect(settings).toMatch(/setOdoMotion\(\(event\.target as HTMLInputElement\)\.checked\)/)
  })

  it('adds zero npm dependencies for the odometer (self-built CSS+JS, M6-05)', async () => {
    // ODO-NO-DEPS：依赖清单与基线完全一致（冻结清单，新增依赖即红）。
    // 基线演进记录：runtime dependencies 自 M6-04 起未动（ODO 零运行时依赖仍成立）；
    // devDependencies 于 PACK-01（桌面 exe 形态）按派发简报授权新增 electron＋electron-builder，
    // 均为构建工具链，不进生产依赖；dependencies 于 PACK-04（更新通道整合）按派发简报显式授权
    // 新增 electron-updater（桌面主进程运行时依赖，随 exe 打包；ODO 动效自身仍零依赖）。
    const raw = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    expect(Object.keys(raw.dependencies).sort()).toEqual(['@fastify/cors', '@fastify/static', 'electron-updater', 'fastify', 'klinecharts', 'lucide-vue-next', 'pinia', 'pinyin-pro', 'vue'])
    expect(Object.keys(raw.devDependencies).sort()).toEqual(['@playwright/test', '@types/node', '@vitejs/plugin-vue', 'concurrently', 'electron', 'electron-builder', 'tsx', 'typescript', 'vite', 'vitest', 'vue-tsc'])
  })

  it('keeps the blind toggle out of the creation form (V1 shows stock info openly)', async () => {
    const source = await readFile(new URL('../../web/src/views/Launcher.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/const blind|blind: blind\.value|双盲模式/)
  })

  it('keeps price-axis wheel scaling separate from chart panning and out of box select', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function isOverPriceAxis\(/)
    // 主副图同权：轴判定遍历全部绘图 pane 的 y 轴矩形（left+width/top+height，right/bottom 恒 0 不可用）
    expect(source).toMatch(/const zone = chart\.getSize\(pane\.id, 'yAxis'\)/)
    expect(source).toMatch(/x >= zone\.left && x <= zone\.left \+ zone\.width && y >= zone\.top && y <= zone\.top \+ zone\.height/)
    // 滚轮：轴上直接返回（交给库原生纵轴缩放），不平移
    expect(source).toMatch(/if \(isOverPriceAxis\(event\.clientX, event\.clientY\)\) return[\s\S]{0,160}scrollByDistance/s)
    // 按下：轴上不进入框选；空白按下先解除持久选中，多选模式分支在框选启动之前（框选缩放被多选模式接管）
    expect(source).toMatch(/if \(isOverPriceAxis\(event\.clientX, event\.clientY\)\) return[\s\S]{0,240}if \(props\.multiSelect\) \{[\s\S]{0,460}selecting = true/s)
  })

  it('restores y-axis auto-fit before programmatic zooms so box select never drifts the chart out of view', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function restoreYAxisAutoFit\(\): void/)
    expect(source).toMatch(/getYAxes\(\{\}\)/)
    expect(source).toMatch(/setAutoCalcTickFlag\?\.\(true\)/)
    // 框选右滑/左滑、键盘缩放、Home 复位四条路径都要先恢复自动适配
    expect(source).toMatch(/restoreYAxisAutoFit\(\)[\s\S]{0,300}setBarSpace/s)
    const zoom = await exerciseChartZoom(1 / 1.3)
    expect(zoom.actions).toEqual(['auto-fit', 'spacing', 'anchor:0', 'visible-count', 'viewport'])
    expect(zoom.barSpace).toBeGreaterThan(6)
    expect(source).toMatch(/resetView\(userInitiated = true\): void \{[\s\S]{0,160}restoreYAxisAutoFit\(\)/s)
  }
  )

  it('shows a lean title and duration meta, and a lean OHLC-only candle legend', async () => {
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/`\$\{training\.name \?\? ''\} · \$\{training\.code \?\? ''\}`/)
    expect(trainingSource).toMatch(/时长 \{\{ tierLabel \}\}/)
    expect(trainingSource).not.toMatch(/档<\//)
    expect(trainingSource).toMatch(/'2Y': '2年'/)
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/title: \{ show: false, color: tooltipText \}/)
    // M6-03：左上角 candle legend 只留均线——模板返回空（OHLC 并入悬浮信息卡），
    // MA 数值由库内 indicator legend 渲染（默认模板），此处锁定模板不再产出开/高/低/收
    const legendBlock = themeSource.match(/candleLegendTemplate[\s\S]{0,400}/)?.[0] ?? ''
    expect(legendBlock).toMatch(/\(\) => \[\]/)
    expect(legendBlock).not.toMatch(/开 |高 |低 |收 |成交量|时间/)
  })

  it('supports zooming below 10 visible bars and dynamically loads earlier history', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/const MIN_COUNT = 1/)
    expect(source).toMatch(/const BAR_SPACE_MAX = 300/)
    expect(source).toMatch(/barSpaceLimit\.max = BAR_SPACE_MAX/)
    expect(source).toMatch(/clampBarSpace\(/)
    expect(source).toMatch(/type === 'forward'/)
    expect(source).toMatch(/async function loadEarlierBars\(/)
    expect(source).toMatch(/fetchEarlier\?: \(before: string, count: number\) =>/)
    expect(source).toMatch(/loadedData = \[\.\.\.older, \.\.\.loadedData\]/)
    // date 必须随 KLineData 保留，否则 before 参数丢失导致重复加载整个窗口
    expect(source).toMatch(/volume: bar\.volume, date: bar\.date \}/)
    expect(source).toMatch(/!first\?\.date \|\| loadingForward/)
    // 前插后不得做锚定/补偿滚动：库的 forward 前插自锚定，额外滚动会引发视图塌缩与加载风暴
    expect(source).not.toMatch(/scrollToDataIndex\(newIndex \+ 1\)|scrollToDataIndex\(prevTo \+ older\.length\)/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/async function fetchEarlier\(/)
    expect(trainingSource).toMatch(/:has-more-bars="hasMoreBars" :fetch-earlier="fetchEarlier"/)
    expect(trainingSource).toMatch(/MAX_VISIBLE_BARS/)
  })
})

describe('M4 history/report interaction contract', () => {
  it('opens the shared report inside a fixed modal and keeps the close action accessible', async () => {
    const history = await readFile(historyPath, 'utf8')
    const report = await readFile(reportPath, 'utf8')
    expect(history).toMatch(/class="report-modal-mask"/)
    expect(report).toMatch(/aria-modal="true"/)
    expect(report).toMatch(/class="report-modal-close"/)
    expect(report).toMatch(/aria-label="关闭成绩单"/)
  })

  it('exposes single and batch history deletion with confirmation and removes the standalone drawing list', async () => {
    const history = await readFile(historyPath, 'utf8')
    const api = await readFile(new URL('../../web/src/api.ts', import.meta.url), 'utf8')
    const report = await readFile(reportPath, 'utf8')
    expect(history).toMatch(/selectedIds/)
    expect(history).toMatch(/deleteTrainingHistory/)
    expect(history).toMatch(/window\.confirm\(/)
    expect(api).toMatch(/export function deleteTrainingHistory\(/)
    expect(report).not.toMatch(/class="report-drawings"/)
  })

  it('keeps phase price lines on the CN red/green palette, shows one active price line, and protects order markers', async () => {
    const chart = await readFile(chartPath, 'utf8')
    const overlays = await readFile(new URL('../../web/src/overlays.ts', import.meta.url), 'utf8')
    const training = await readFile(trainingPath, 'utf8')
    expect(chart).toMatch(/currentPriceColor\(\)/)
    expect(overlays).toMatch(/phasePriceLine/)
    expect(overlays).toMatch(/const color = typeof data === 'number' \? '#94a3b8' : data\?\.color/)
    // 有效阶段价在开盘/收盘都走唯一 overlay；轴标签交给公开回调，plot 内不重复写价格。
    expect(chart).toMatch(/showLastMark/)
    expect(chart).toMatch(/const showLastMark = !hasPhasePrice\(props\.currentPrice\)/)
    expect(overlays).toMatch(/createYAxisFigures:/)
    expect(chart).toMatch(/applyLastPriceStyle\(\)\s*\n\s*updateMarkerRail\(\)/)
    // 条件单标记悬浮信息：悬停驱动（无按键移动命中显示、离开隐藏），纯信息层不拦截指针
    expect(chart).toMatch(/hitPendingOrders\(/)
    expect(chart).toMatch(/showOrderTooltip\(/)
    expect(chart).toMatch(/event\.buttons === 0[\s\S]{0,200}hitPendingOrders\(/)
    expect(chart).toMatch(/\.order-tooltip \{[^}]*pointer-events: none/)
    expect(training).toMatch(/推进至 \$\{snapshot\.value\.training\.currentDate \?\? '今日'\}，\$\{priceText\}/)
  })

  it('unifies order entry in a tabbed panel with shared sizing and a multi pending-order list', async () => {
    const training = await readFile(trainingPath, 'utf8')
    const styles = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8')
    // 标签页结构：普通下单/条件单两个 tab，共享百分比仓位与按股数买卖输入
    expect(training).toMatch(/role="tablist" aria-label="下单方式"/)
    expect(training).toMatch(/普通下单/)
    expect(training).toMatch(/条件单/)
    expect(training).toMatch(/orderTab = ref<'normal' \| 'conditional'>/)
    expect(training).toMatch(/customShares/)
    expect(training).toMatch(/placeholder="按股数买卖（选填）"/)
    expect(training).not.toMatch(/orderWeight/)
    // 条件单表单：买卖/限价止损下拉＋触发价＋理由＋提交；多挂单列表＋撤单
    expect(training).toMatch(/aria-label="条件单方向"/)
    expect(training).toMatch(/aria-label="条件单类型"/)
    expect(training).toMatch(/aria-label="条件单触发价"/)
    expect(training).toMatch(/aria-label="挂单理由"/)
    expect(training).toMatch(/提交条件单/)
    expect(training).toMatch(/pendingOrders/)
    expect(training).toMatch(/recentFinishedOrders/)
    expect(training).toMatch(/orderStatusLabel/)
    // 面板样式只引用已定义的设计令牌（幽灵令牌审计：--surface-raised/--accent 全项目未定义，
    // var() 引用它们会在深色主题回落浅色——1.2.3 悬浮框主题错配的根因；审计只认实际引用）
    for (const source of await Promise.all([training, styles, await readFile(chartPath, 'utf8'), await readFile(rankingsPath, 'utf8')])) {
      expect(source).not.toMatch(/var\(--surface-raised|var\(--accent/)
    }
  })

  it('uses one close exit, compact rule tags, themed report surface, and one shared comparison chart', async () => {
    const report = await readFile(reportPath, 'utf8')
    const styles = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8')
    expect(report).not.toContain('report-modal-back')
    expect(report).not.toMatch(/第 \{\{ report\.training\.id \}\} 局/)
    expect(report).toMatch(/report-rule-tags/)
    expect(report).toMatch(/report-curve-tooltip/)
    expect(report).toMatch(/curve-axis-label/)
    expect(report).toMatch(/comparisonBenchmarks\.length/)
    expect(styles).toMatch(/\.report-modal-mask > \.report-page[^}]*var\(--surface-background/)
    expect(styles).not.toMatch(/body\.dark \.report-curve \{ color: #52b394/)
  })

  it('keeps the comparison chart mounted while a benchmark request is pending and pauses report K-line replay', async () => {
    const report = await readFile(reportPath, 'utf8')
    expect(report).toMatch(/v-if="chartModel" class="report-curve"/)
    expect(report).not.toMatch(/v-else-if="comparisonLoading"/)
    expect(report).toMatch(/comparisonLoading/)
    expect(report).toContain('更新同期指数')
    expect(report).not.toContain('K线复盘')
    expect(report).not.toContain('report-review')
    expect(report).not.toContain('fetchTrainingBars')
    expect(report).not.toContain('KlineChart')
  })

  it('blocks exit while the native directory picker is pending', async () => {
    const app = await readFile(new URL('../../web/src/App.vue', import.meta.url), 'utf8')
    expect(app).toMatch(/wizardBusy \|\| wizardApplying \|\| exitFlow !== 'closed'/)
    expect(app).toMatch(/class="picker-blocker"/)
  })

  it('gives the native directory picker the captured foreground window as its owner', async () => {
    const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
    expect(api).toMatch(/class HwndOwner : IWin32Window/)
    expect(api).toMatch(/-ReferencedAssemblies \$formsAssembly/)
    expect(api).toMatch(/ShowDialog\(\[HwndOwner\]::new\(\$owner\)\)/)
    expect(api).toMatch(/cancelActiveDirectoryPicker/)
  })
})
