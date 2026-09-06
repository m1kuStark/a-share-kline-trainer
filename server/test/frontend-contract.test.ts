import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const chartPath = new URL('../../web/src/components/KlineChart.vue', import.meta.url)
const trainingPath = new URL('../../web/src/views/Training.vue', import.meta.url)

describe('M2 chart interaction contract', () => {
  it('starts box select only on the main-pane layer and supports right-drag zoom-in / left-drag zoom-out', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/paneIdAt\(event\.clientY\) !== 'candle_pane'/)
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
    expect(source).toMatch(/last\.close > prev\.close/)
    expect(source).toMatch(/last\.close < prev\.close/)
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
    expect(source).toMatch(/onDrawEnd: \(\) => emit\('toolChange', null\)/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    // 工具条停靠训练控制台底部（用户 D1 验收反馈改定：不遮挡图表），内容区滚动观察
    expect(trainingSource).toMatch(/class="console-scroll"/)
    expect(trainingSource).toMatch(/class="draw-toolbar"/)
    expect(trainingSource).toMatch(/DRAW_TOOLS/)
    expect(trainingSource).toMatch(/drawTool = drawTool === tool\.name \? null : tool\.name/)
    // 画线模式下 Space/B/S 禁用（防误推进/误交易）、Esc 退出、状态条提示
    expect(trainingSource).toMatch(/if \(drawTool\.value\) \{/)
    expect(trainingSource).toMatch(/event\.key === 'Escape'/)
    expect(trainingSource).toMatch(/\['b', 'B', 's', 'S'\]\.includes\(event\.key\)/)
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
    expect(source).toMatch(/if \(event\.overlay\.isDrawing\(\)\) \{ cancelDrawing\(\); emit\('toolChange', null\); return \}/)
    expect(source).toMatch(/编辑划线/)
    expect(source).toMatch(/删除画线/)
    // 编辑面板四类参数：颜色/粗细/样式/端点价位（不编辑横坐标），确定走 overrideOverlay
    expect(source).toMatch(/type: 'color'|type="color"/)
    expect(source).toMatch(/端点\{\{ i \+ 1 \}\}价位/)
    expect(source).toMatch(/value="solid">实线/)
    expect(source).toMatch(/overrideOverlay\(\{ id, styles: \{ line \}, points \}\)/)
    // Delete 删除选中画线（选中态由 onSelected/onDeselected 跟踪）
    expect(source).toMatch(/function deleteSelected\(\): boolean/)
    expect(source).toMatch(/onSelected: event => \{ selectedOverlayId\.value = event\.overlay\.id \}/)
    // 菜单/面板锚定图表宿主层内（口径修订七），打开期间拦截训练热键
    expect(source).toMatch(/function onGlobalPointerDown\(event: PointerEvent\): void/)
    expect(source).toMatch(/function onPanelKeydown\(event: KeyboardEvent\): void/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/event\.key === 'Delete'/)
    expect(trainingSource).toMatch(/deleteSelected\(\)/)
    // 默认样式（用户 D2 验收反馈）：1px 虚线；端点价位回读按价格两位小数取整
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/line: \{ color: DRAW_DEFAULT_COLOR, size: 1, style: 'dashed', dashedValue: \[4, 4\] \}/)
    expect(source).toMatch(/editForm = ref\(\{ color: DRAW_DEFAULT_COLOR, size: 1, style: 'dashed' as 'solid' \| 'dashed' \| 'dotted', values: \[\] as number\[\] \}\)/)
    expect(source).toMatch(/Number\(\(point\.value \?\? 0\)\.toFixed\(2\)\)/)
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
    expect(source).toMatch(/store\.setPressedOverlayInfo\(\{ paneId: 'candle_pane', overlay: hit, figureType: 'other', figureIndex: -1, figure: null \}\)/)
    expect(source).toMatch(/if \(event\.button === 1\) \{/)
    expect(source).toMatch(/function hitTestUserOverlay\(clientX: number, clientY: number\)/)
    // 虚线段长统一为库默认 [4,4]（编辑前后渲染一致）；字段改无关联 div 结构（label 点击区溢出修复）
    expect(themeSource).toMatch(/dashedValue: \[4, 4\]/)
    expect(source).toMatch(/dashedValue: editForm\.value\.style === 'dotted' \? \[2, 4\] : \[4, 4\]/)
    expect(source).toMatch(/class="field-row"/)
    expect(source).not.toMatch(/<label/)
  })

  it('registers the ray tool in the drawing registry (D3)', async () => {
    // D3：射线工具入注册表（第一锚点固定、过第二点无限延伸，库内置 rayLine）
    const drawToolsSource = await readFile(new URL('../../web/src/drawTools.ts', import.meta.url), 'utf8')
    expect(drawToolsSource).toMatch(/\{ name: 'rayLine', label: '射线' \}/)
  })

  it('maps ArrowUp to zoom-in and ArrowDown to zoom-out', async () => {
    const source = await readFile(trainingPath, 'utf8')
    expect(source).toMatch(/ArrowUp[\s\S]{0,120}?zoomBy\(1 \/ 1\.3\)/)
    expect(source).toMatch(/ArrowDown[\s\S]{0,120}?zoomBy\(1\.3\)/)
  })

  it('slims MACD histogram bars to 2/5 of the default width', async () => {
    const source = await readFile(new URL('../../web/src/indicators.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/barSpace\.halfGapBar \* 2 \* 0\.4/)
  })

  it('keeps the blind toggle out of the creation form (V1 shows stock info openly)', async () => {
    const source = await readFile(new URL('../../web/src/views/Launcher.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/const blind|blind: blind\.value|双盲模式/)
  })

  it('keeps price-axis wheel scaling separate from chart panning and out of box select', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function isOverPriceAxis\(/)
    expect(source).toMatch(/getSize\('candle_pane', 'yAxis'\)/)
    expect(source).toMatch(/zone\.left \+ zone\.width && y >= zone\.top && y <= zone\.top \+ zone\.height/)
    // 滚轮：轴上直接返回（交给库原生纵轴缩放），不平移
    expect(source).toMatch(/if \(isOverPriceAxis\(event\.clientX, event\.clientY\)\) return[\s\S]{0,160}scrollByDistance/s)
    // 按下：轴上不进入框选
    expect(source).toMatch(/if \(isOverPriceAxis\(event\.clientX, event\.clientY\)\) return[\s\S]{0,40}selecting = true/s)
  })

  it('restores y-axis auto-fit before programmatic zooms so box select never drifts the chart out of view', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function restoreYAxisAutoFit\(\): void/)
    expect(source).toMatch(/getYAxes\(\{\}\)/)
    expect(source).toMatch(/setAutoCalcTickFlag\?\.\(true\)/)
    // 框选右滑/左滑、键盘缩放、Home 复位四条路径都要先恢复自动适配
    expect(source).toMatch(/restoreYAxisAutoFit\(\)[\s\S]{0,300}setBarSpace/s)
    expect(source).toMatch(/zoomBy\(factor: number\): void \{[\s\S]{0,220}restoreYAxisAutoFit\(\)/s)
    expect(source).toMatch(/resetView\(\): void \{[\s\S]{0,160}restoreYAxisAutoFit\(\)/s)
  }
  )

  it('shows a lean title and duration meta, and a lean OHLC-only candle legend', async () => {
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/`\$\{training\.name \?\? ''\} · \$\{training\.code \?\? ''\}`/)
    expect(trainingSource).toMatch(/时长 \{\{ tierLabel \}\}/)
    expect(trainingSource).not.toMatch(/档<\//)
    expect(trainingSource).toMatch(/'2Y': '2年'/)
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/title: \{ show: false \}/)
    const legendBlock = themeSource.match(/candleLegendTemplate[\s\S]{0,400}/)?.[0] ?? ''
    expect(legendBlock).toMatch(/开 |高 |低 |收 /)
    expect(legendBlock).not.toMatch(/成交量|时间/)
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
    expect(trainingSource).toMatch(/缩放 1~420/)
  })
})
