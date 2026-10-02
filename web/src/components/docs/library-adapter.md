# klinecharts 适配登记

`CHART-LIBRARY-PIN`：当前钉定 10.0.3，版本见 [package.json](../../../../package.json) 与锁文件。适配代码仍在 [KlineChart.vue](../KlineChart.vue) 及上级 `src/`，本页是依赖登记，不代表存在独立 adapter 模块。

覆盖库行为前先查该版本源码，确认真正生效的属性、回调名和命中逻辑。升级必须逐项复核下表，配合 [前端契约测试](../../../../server/test/frontend-contract.test.ts)、版本哨兵和真实事件回归；公共方法也可能包含本项目依赖的实现细节。

## 内部结构与行为

| 依赖 | 当前用途与复核点 |
|---|---|
| `_chartStore.getLayoutOptions().barSpaceLimit.min/max` | onMounted 改为 0.1/300；允许窄屏多根和少根放大。实际 840 限制另由 `clampBarSpace` / `enforceVisibleLimit` 执行，范围变化后微任务再校正。 |
| `yAxis.setAutoCalcTickFlag(false/true)` | 中键前设手动，`restoreYAxisAutoFit` 恢复自动；检查轴拖拽、框选、键盘缩放和复位组合。 |
| `yAxis.getRange/setRange/valueToRealValue/realValueToDisplayValue` | 已知值域读写接口；getRange 用于只读断言，其余作为历史备用登记，不表示当前主动调用。 |
| `_event._handler` | 历史登记的 Event 门面拖拽状态（含 `_startScrollCoordinate`）备用入口；当前中键释放用合成左键 mouseup 清理，不主动改写该字段。 |
| `getChartStore().getClickOverlayInfo/setClickOverlayInfo` | 空白解选和扩大命中后的持久选中补齐。解选时必须提供 `onDeselected` 回调，库不判空。 |
| `getChartStore().getPressedOverlayInfo/setPressedOverlayInfo` 与 overlay `startPressedMove` | 7px 自定义命中补足库未命中的 2~7px 区间，避免拖线变成整图平移；坐标换算后再写 pressed 状态。 |
| `_chartEvent._event._resetClickTimeout()` | 新工具和每次取点前清双击累计，防 500ms 内第二击被吞或提前完成。 |
| `getSeparatorPanes()` → `getBounding()/getWidget().getContainer()` | 从实际容器获得原生 7px 命中带和宽度；顶部按 `round((容器高 - separator.size)/2)` 偏移，忽略 height=0，保留原生最小高度与 dragEnabled 行为。 |
| overlay `forceComplete()`、store `progressOverlayComplete()` | 折线右键结束时移除预览点并转入完成集合；恢复折线走相同完成路径。 |
| figure `checkEventOn` 的 `DEVIATION=2` | 线/矩形等库命中容差小于本项目 7px，需检查 bubble 选中补齐是否仍必要。 |
| overlay `createPointFigures` | 注册钩子名不可写成 `createFigures`，否则静默不渲染；检查 [overlays.ts](../../overlays.ts) 与 [drawingOverlays.ts](../../drawingOverlays.ts)。 |
| overlay `createYAxisFigures` | 阶段价位线用公开回调单独绘制轴标签；线体和标签样式读取 `candle.priceMark.last.line/text`，不在绘图区重复写价格。有有效 `currentPrice` 时隐藏内置 last mark，避免收盘阶段重合绘制。核查 10.0.3 的 OverlayYAxisView、CandleLastPriceView 和默认 latest 样式（1px、dash[4,4]）；主轴位置由 `yAxis.isFromZero()` 决定标签方向。 |
| `overrideYAxis({createRange})` | 正常主图轴的公开范围回调仅在可视范围包含末根时纳入有效阶段价，随后仍由库添加 gap padding；保证跳空开盘价可见，不伪造 K 线或注入未来 OHLC。10.0.3 的 overrideYAxis 重设自动范围标志，故回调仅在挂载时注册一次，以闭包读取阶段价，主题/订单刷新不重复注册。历史视窗返回原默认范围，手动纵轴和副图范围规则不变；当前仅 normal 单右轴，切换对数轴前须重新评估映射。 |
| figure `attrs.width` | [indicators.ts](../../indicators.ts) 用它覆盖 MACD 柱宽为 2/5；覆盖主题前核对实际绘制键。 |
| 数据 forward 前插自锚定 | `loadEarlierBars` 不作额外滚动补偿；验证补历史后时间锚点不漂移。 |
| `drawText` 强制左上对齐 | 历史 bsMark 绘制自行补字母偏移；对象保留但当前不出图，成交显示由独立标记条负责。 |
| `getSize` 的 bounding | right/bottom 恒为 0；命中只能使用 left+width / top+height，不能拿空字段作边界。 |
| `convertToPixel/convertFromPixel` 默认 `absolute=false` | y 默认相对 pane，不加/减 bounding.top。命中几何、按点换算等 host 坐标必须 `absolute: true`；主图 top=0 会掩盖副图错误。第一击所在 pane 决定 overlay 落点。 |
| `getYAxes({ paneId })[0]` | 当前单右轴。启用双轴前重查可见轴、命中与缩放目标，不得沿用首轴假设。 |
| `setPaneOptions({id,height})` / `scrollToTimestamp` | 回放依赖公开API重排语义窗格并以右缘时间定位；10.0.3 scrollToTimestamp使用最近数据点。恢复必须在默认reset与布局后执行，数据版本变化重新应用。 |
| `getDataList()`保留Bar附加字段 | 录制从完整已加载列表还原真实date/amount（含前插历史）；升级验证字段未被库丢弃。捕获不使用仅含最近批次的props.bars。 |

生命周期与释放登记见 [事件仲裁](./interaction.md)。样式语义、透明测量标签、成交标记和国内配色由 [显示规格](../../../../docs/specs/chart/display.md) 定义，默认虚线参数必须在主题和编辑应用间同源。

## 只读测试接口

`window.__trainerChart` 仅在 `import.meta.env.MODE === 'journey'` 时注入；`DEV` 不能代替这个条件，因为 build 时恒为 false。生产构建必须无钩子。

接口包括数量/模式/轴范围、hitTest/overlayInfo、单选与多选、drawings/geometry/panes、visibleRange/viewportMetrics/bars、costLine 和 pointToPixel。phasePriceMark 只读返回阶段线数量、价格、前收和公开回调生成的线体/轴标签图元，用于检查唯一标记与价位坐标；图元不能代替主代理的实际 Canvas 视觉核查。测试先用真实鼠标/键盘操作，再读结果或投影下一步坐标；禁止借 hook 创建、移动、删除图形。临时矩形、菜单和面板仍须检查 DOM 可见性，状态值不能证明已渲染。运行与产物恢复见 [E2E](../../../../e2e/README.md)。
