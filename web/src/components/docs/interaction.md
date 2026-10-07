# 图表事件仲裁与生命周期

本页记录 [KlineChart.vue](../KlineChart.vue) 的当前入口链。行为要求见 [交互规格](../../../../docs/specs/chart/interaction.md)（`CHART-GESTURE-PRIORITY`），显示与范围要求见 [显示规格](../../../../docs/specs/chart/display.md)（`CHART-VIEWPORT`）。

## 指针入口

MA-01：主图顶部“MA 设置”按钮打开原生模态dialog，绘图取点期间禁用。面板只编辑草稿，应用原位更新指标；panelChange隔离训练快捷键，dialog接管焦点、Esc和输入，modal阻止画布手势。取消及关闭回到入口，不改变画线/视窗。组件新增配置watch由Vue卸载，不新增全局监听器。

`pointerdown` 与 `mousedown` 均在 host capture 处理，后者另有 bubble 修补。不能把它们理解成互不相关的操作；一次原生手势会依次经过两条链。

1. `__klineSynthetic` 标记的中键内部合成事件直接放行，避免拦截自己。
2. 左键命中原生分隔条或 `paneResizePointerId` 已存在时，让库处理相邻 pane 调高。`beginPaneResize` 清理框选、多选矩形、轴缩放状态；整次手势直到 `pointerup` 或 `pointercancel` 都不参与其他模式。真实命中带由库容器计算，包含 7px 带和右轴侧；隐藏分隔条高度为 0 时忽略。
3. Ctrl+左键或多选模式左键，在没有绘图工具时切换用户图形选中；空白清空。此分支拦截库的单选与平移。
4. 中键先把主图轴置手动模式，临时锁住用户图形，合成左键 `mousedown` 交给库滚动。松中键须补左键 `mouseup`，否则库的 `_startScrollCoordinate` 会残留，松手后仍跟随鼠标平移。
5. 绘图模式左键先重置库双击计时，再放行 overlay 取点；已绘图形的命中交给库选择与拖动。自定义命中线体 7px、锚点 8px，比库宽，因此 bubble 阶段补齐 pressed/click 状态。
6. 普通模式的价格轴左键设 `axisScaleDrag`，持续移动被重路由成轴内合成 `mousemove`，直到释放。绘图区空白先主动解除库持久选中：多选模式启动矩形选图，普通模式启动时间范围缩放，并拦截库原生平移，避免手动轴叠加纵向移动。

主图、VOL、MACD 的绘图区同权，时间轴排除。多选框选不缩放；关闭多选会清空集合和自绘锚点。选中层为 18px 黄芯白圈，随选中、可见范围和拖动重算，线体保留原色。hover 只改变指针。

源码复核待验证：当前 `onHostMouseDown` 的 Ctrl/多选分支位于价格轴判断之前，`paneIdAt` 只按 y 判 pane，分支内没有排除价格轴；不能据旧说明声称“多选下轴拖拽已保证可用”。应以真实事件核对该组合，再决定是否调整守卫顺序。

## 视窗、日期和标记

`zoomBy`、`resetView`、框选向左/向右四条程序化缩放路径调用 `restoreYAxisAutoFit()`；手动轴冻结不能带入新范围。`chartNavigation.ts` 提供840上限，图表按主画布宽度钳柱宽，并在范围变化微任务和ResizeObserver后再次校正。MA-01训练页按启用的最大MA周期预热，至少200根，默认首批1040根；修改成长周期时按缺口主动forward前插，失败可重试。普通向左浏览仍按300根加载，加载量不等于同屏量。库forward前插自锚定，禁止再补偿滚动。

`Training.loadVersion` 防过期周期请求，图表 `dataVersion` 防旧动态历史响应写回；`chart.setPeriod` 跟随日/周/月，形成中周期按当前周期归属锚点。`updateMarkerRail` 等布局后上报 `viewportDates`：实际可见末根、已载入末根和是否在最新端。页面据此区分日期与周/月周期，不能把横轴外推刻度或周一起点当截止日。

历史成交使用服务端 `chartPrice`。B/S 由独立标记条按周期与像素列聚合，不再画在蜡烛或轴上；成本线使用账户同源成本。刷新行情走原训练读取边界，回到最新只调用 `resetView`，不推进日期。

## 监听与卸载

| 持有者 | 注册项 | 释放 |
|---|---|---|
| 图表 host | wheel（非 passive）；pointerdown capture；mousedown capture/bubble；dblclick；contextmenu | `onUnmounted` 对应移除 |
| 图表 window | pointermove；pointerup 手势处理；pointerup 历史记录；pointercancel 分隔取消；keydown capture；pointerdown capture 全局关闭 | 两处 `onUnmounted` 成对移除 |
| 图表实例与尺寸 | visible-range 订阅；ResizeObserver；待执行微任务 | 库公开 `dispose(host)`；observer disconnect；微任务检查 `disposed` |
| 图表录制与回放 | 150ms尾沿捕获/用户视窗操作计时器；回放恢复requestAnimationFrame | `cancelChartCapture()`、`cancelViewportOperation()`、`cancelReplayRestore()`；只读/卸载/程序恢复时不发捕获反馈 |
| Training | keydown；pagehide；document visibilitychange；保存/短提示计时器 | 卸载移除、清计时器并尝试 flush |
| App / dataStatus | window focus；document visibilitychange；状态轮询；提醒动画计时器 | 卸载移除并 `cancelDataWatchers()`、清动画计时器 |

新增监听同步登记本表。App 按训练 id 重建 Training，已结算训练可通过 URL 查询参数重开，返回首页清理参数；组件卸载不能仅移除 DOM 而留下图库实例。

相关回归：[journey](../../../../e2e/journey.spec.ts)、[pane-resize](../../../../e2e/pane-resize.spec.ts)、[m3-round3](../../../../e2e/m3-round3.spec.ts)、[compact-chart](../../../../e2e/compact-chart.spec.ts)。
