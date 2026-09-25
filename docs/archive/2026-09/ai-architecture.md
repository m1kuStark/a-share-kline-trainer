> 历史快照：2026-09-17 文档迁移前内容。可能含当时的过期表述，不作当前指令；现行入口：[文档索引](../../README.md)。

# 架构（Architecture）

> 面向 AI 与维护者的技术架构单页。改架构先改本文件，再改代码。

> 2026-09-17 源码复核：下文描述当前实现。已确认的数据发布、结算及读取合约缺口见 [状态页](../../status.md)；目标结构另见 [改进提案](../../ai/architecture-parallel-proposal.md)，不得当作已实现。

## 技术栈与版本钉定

| 组件 | 版本 | 说明 |
|---|---|---|
| Node | >=24 | node:sqlite 内置依赖 |
| TypeScript | ^5.9 | 严格模式 |
| Fastify | ^5.6 | API＋@fastify/static 托管 web/dist |
| Vue | ^3.5 | script setup 组合式 |
| Vite | ^7.1 | root=web，outDir=web/dist |
| klinecharts | **10.0.3 钉定** | 升级必须复查 architecture.md 内部 API 登记表 |
| vitest | ^3.2 | server/test 进程内测试 |

## 数据流

```
通达信本地目录（TDX_ROOT，自动发现结果不写入源码）
  ├─ vipdoc/{sh,sz,bj}/lday/*.day   32 字节小端日线（dayfile.ts 解析）
  └─ T0002/hq_cache/gbbq            29 字节/条 Feistel 加密权息（gbbq.ts 解密）
        ↓ server/src/tdx/*
训练引擎 train/engine.ts：可见历史=先按推进日截断→前复权(基准=推进日, gbbq 因子)→聚合(日/周/月)→ slice(-1040)
        ↓ REST API（api.ts，HttpError→全局 setErrorHandler 透传中文 message）
前端 web/src：api.ts(fetch 封装) → views/Training.vue(四区域布局/模式状态/热键)
        → components/KlineChart.vue(klinecharts 实例＋交互模式机＋多选/画线/框选/轴缩放)
画线 → DrawingHistory（创建/编辑/拖拽/删除快照）→ DrawingOutbox（同步本地副本）→ SerialDrawingSaver（串行 PUT）→ drawings 表。
载入训练先 GET drawings，并恢复同一训练的未保存本地副本；失败时禁用画线，避免空集合覆盖历史。B/S历史成交价使用chartPrice换算；当前成本线来自含position_events的账户成本（当前前复权基准价与原价相同），二者排除于画线历史及持久化。
```

## 交互模式机（KlineChart.vue 事件入口守卫链）

所有指针/键盘交互经 `onHostMouseDown`（host capture）与 `onPointerDown`（host capture）进入，守卫顺序即互斥关系：

```
合成事件标记(__klineSynthetic) → 放行（中键平移的内部合成，防自拦截）
分隔条原生命中带或已开始分隔拖拽 → 放行原生resize，整次手势不进入框选/多选/轴缩放/画线补齐
Ctrl+左键或多选模式普通左键 → 画线多选 toggle（命中→加入/移出集合；空白→清空），拦截库事件
中键(button=1) → 合成左键 mousedown 交给库原生滚动管线（横向平移＋手动纵轴纵向平移），
                  释放时补发合成左键 mouseup 清理（库 mouseup 只认左键）
左键 + 画线模式(drawTool) → 放行给库 overlay 取点；Space/B/S 热键禁用；右键取消取点
左键 + 命中用户画线(hitTestUserOverlay, 7px/锚点8px) → 放行给库（选中/拖拽/右键菜单）
左键 + 价格轴(isOverPriceAxis) → axisScaleDrag：指针位置重路由为轴区域合成 mousemove，
                                   库原生缩放持续到松手（多选模式同样生效）
左键 + 绘图区空白 → 主动解除库持久选中；多选模式在主副图均可橡皮筋框选（不缩放），
                     默认模式主副图均可触发时间范围缩放（stopPropagation 防手动轴纵向叠加）
```

配套状态与清理：
- `paneResizePointerId`／`axisScaleDrag`／`multiDragStart`／`selecting` 互斥；分隔拖拽在pointerup/pointercancel收尾，库负责相邻pane最小高度及dragEnabled。
- 库 mouseup 只认左键：中键释放必须补发合成左键 mouseup，否则残留 `_startScrollCoordinate` 导致自由移动鼠标持续平移。
- 多选模式关闭（watch props.multiSelect）自动清空多选集合与自绘锚点层；选中不改变线体颜色。
- 多选锚点由 `.anchor-dot` 绘制（黄芯白圈，18px）；随选中集合、可见范围及指针拖动重算，主副图同权。
- `restoreYAxisAutoFit()`：框选缩放/zoomBy/resetView 四条程序化缩放路径前必须调用（手动轴冻结范围）。

## 内部 API 钉定登记表（升级 klinecharts 必须逐项复查）

| 依赖 | 用途 | 位置 |
|---|---|---|
| `_chartStore.getLayoutOptions().barSpaceLimit.min/max` | min=0.1允许窄屏840根、max=300支持少根放大；clampBarSpace另按主画布宽度保证实际可见上限，范围改变后微任务再次校正 | KlineChart onMounted / enforceVisibleLimit |
| `yAxis.setAutoCalcTickFlag(false/true)` | 纵轴手动/自动模式（restoreYAxisAutoFit、中键平移前强制手动） | KlineChart |
| `yAxis.getRange()/setRange()/valueToRealValue()/realValueToDisplayValue()` | 纵轴值域读写（备用） | 已知可用 |
| `_event._handler`（Event 门面） | `_startScrollCoordinate` 等拖拽状态（中键清理备用） | 已知可用 |
| `getChartStore().getClickOverlayInfo()/setClickOverlayInfo()` | 空白点击主动解除库持久选中、扩大命中区域后的选中补齐；解除时必须提供 onDeselected 回调，库不判空 | KlineChart deselectLibrarySelected / onHostMouseDownBubble |
| `_chartEvent._event._resetClickTimeout()` | 新工具及每次取点前重置库双击累计，防止 500ms 内第二击被吞掉或提前完成图形 | KlineChart resetLibraryClick |
| `getSeparatorPanes()`→`getBounding()/getWidget().getContainer()` | 获取原生分隔条真实7px命中带及宽度，按round((容器高-separator.size)/2)偏移；隐藏height0分隔条忽略，避免框选抢占 | KlineChart isOverPaneSeparator / beginPaneResize |
| overlay `forceComplete()` / store `progressOverlayComplete()` | 折线右键结束，移除预览点后迁移到已完成集合；恢复折线同样走此路径 | KlineChart finishPolyline / restoreDrawings |
| figure 命中 `DEVIATION=2`（line/rect 等 checkEventOn） | 决定库内画线命中容差，与我们 7px 门限的落差由 onHostMouseDownBubble 补齐 | KlineChart |
| overlay figure `createPointFigures` 钩子名 | 写成 createFigures 静默不渲染 | overlays.ts |
| overlay figure attrs.width 可覆盖柱宽 | MACD 柱 2/5 | indicators.ts |
| forward 前插自锚定 | 动态历史加载禁止补偿滚动 | KlineChart loadEarlierBars |
| drawText 强制左上对齐 | B/S 字母偏移手工补偿 | overlays.ts |
| getSize bounding right/bottom 恒 0 | 只能 left+width/top+height | KlineChart isOverPriceAxis |
| `convertToPixel/convertFromPixel` 默认 pane 相对 y（absolute=false 不加/不减 bounding.top） | 副图 pane top≠0，命中几何/按点换算必须 `absolute: true` 才是 host 坐标（主图 top=0 掩盖差异）；取点第一击所在 pane 即 overlay 落点（库同步 overlay.paneId） | KlineChart overlayHitGeometry / onHostMouseDownBubble |

## 测试钩子

`window.__trainerChart`（仅 `--mode journey` 构建注入，生产构建零钩子）：overlayCount/selectedCount/mode/yRange 只读计数器，供 e2e/journey 状态断言。

M3 扩展只读 hooks：drawings/geometry/panes/visibleRange/bars/pointToPixel，供真实指针操作之后核验数据、几何与窗口状态。测试不能通过 hooks 创建或移动画线。

## M3 模块边界

- 2026-09-11 调整：成交 B/S 不再绘制在蜡烛附近，由 `TradeMarkerRail.vue` 在独立窄条显示；`tradeMarkerLayout.ts` 用当前周期和像素列聚合，KlineChart 通过只读横坐标投影及可视范围修订触发更新。bsMark 引擎对象保留但不出图，成本线不变。
- `drawingGeometry.ts` 与 `builtInGeometry.ts`：显示与命中几何，曲线采样、有限范围、窗格裁剪和多边形内部命中。
- `drawingOverlays.ts`：九类自定义图形及折线注册，读取当前 overlay 样式。
- `drawingState.ts`：只序列化用户对象，丢弃 dataIndex；按 id 固定顺序，不把 hover 引起的库排序记为编辑。
- `drawingOutbox.ts`：训练 id＋创建时间隔离；旧确认不能删除新副本。浏览器关页的 keepalive 配额之外仍可在重开后恢复。
- `Training.vue`：递增请求版本阻止过期周期响应覆盖；`KlineChart` 对动态历史载入使用数据版本。chart.setPeriod 与当前日/周/月一致，保证形成中周期锚点归属正确。
- `App.vue`：训练组件按 id 重建，已结算训练通过查询参数重开，离开清理参数。图表卸载调用库公开 `dispose`。
- `toolFavorites.ts`：工具名校验/去重、常用排序和浏览器偏好；Training 自定义模式管理拖放，独立固定保存栏避免状态变化挤动布局。
- `db.ts`：存量 drawings 表通过 addColumnIfMissing 补 updated_at，未知旧保存时间使用空串，后续实际 PUT 更新；不重建旧表、不清理旧画线。
- Fibonacci 覆盖内置同名 overlay，与百分比线共用测量标签格式和透明样式；曲线比率、价格和线体覆盖范围保留。
- `curseLine` 两点注册，保存高低原始锚点；几何和渲染共用第二点时间/两点均价，价位线、诅咒线都复用透明测量标签。
- `chartNavigation.ts` 定义840上限与中括号循环；Training沿用tf请求版本守卫。图表中性灰主题token用于主页面及弹出编辑面板。
- `position_events.cost_delta`持久化配股缴款取得成本（新事件无缴款显式0，旧行NULL）；重放顺序日期→事件先于交易→各自seq。旧NULL只在权息缓存与实际新增股数/现金同时匹配时恢复缴款成本，不改写旧流水。
- `buildChartSpace`只转换历史成交chartPrice，当前costPrice复用event-aware账户重放；Training在买卖/推进成功时立即同步costPrice，防行情GET失败留下旧线。
- KlineChart布局完成后通过viewportDates上报visibleDate/latestDate；Training紧凑状态栏显示真实末根日期。刷新按钮走原load请求边界，回到最新仅调用resetView。App全局标题压缩为28px，训练详情为不参与排版的浮层。

## 事件监听器配对清单（onMounted ↔ onUnmounted）

host：wheel / pointerdown(capture) / mousedown(capture) / mousedown(bubble 修补) / dblclick / contextmenu；
window：pointermove / pointerup（手势与历史）/ pointercancel（分隔拖拽取消）/ keydown(capture 面板) / pointerdown(capture 全局关闭)；Training 另有 pagehide 与 document visibilitychange 保存处理，卸载成对移除。App 另有 window focus 与 document visibilitychange（数据状态检查，60s 节流）及 dataStatus 轮询定时器，onUnmounted 成对移除。
新增监听必须在本清单与 onUnmounted 同步登记。

## 数据更新服务（2026-09-17 R0/R1 已实现，R2 待接）

- `server/src/data/source.ts`：`DailySource` 合约（kind `tdx|online`、available、scan）＋`registerOnlineSource()`——R2 真实在线源的唯一注册点，本批无内置在线源；`selection.ts` 选择链：TDX 可用→TDX，否则已注册且可用的在线源，否则 none。
- `tdxSource.ts`：市场目录整体不存在=正常跳过；目录在但 lday 不可读=该市场失败。稳定读取：size+mtime 与快照一致则沿用不重读；否则读前/读后 stat＋32 字节倍数校验三点一致，失败重试 1 次，仍失败整体 failed 不发布部分结果。
- `refresh.ts`：协调器实例内同一时刻一个任务，重复 POST 返回 joined；120s 看门狗超时置 failed，任务在内存，重启回 idle。扫描返回后和提交文件快照前检查 `timedOut`，但目录/权息分别调用独立提交的刷新函数，尚无整批事务或统一发布屏障；后续失败不能保证 stocks/adj_factors 全部旧值保留，catalog 返回的 failures 也未检查。文件快照失败保留与整批数据原子发布必须分开描述，见 DATA-01。
- `snapshot.ts`：`data_file_state`（path/size/mtime_ms/max_date/rows）只在扫描完整成功后单事务原子替换；`data_refresh_log` 保留最近 50 次尝试（失败也记）。修订检测 v1：新文件=added、消失=removed、max_date 前移=正常追加、max_date 未前移但 size/mtime 变=revised→`revisionWarning` 中文警示（不阻断、不改写训练数据）；首扫全记基线不告警。历史修订的隔离/恢复未做，属后续批次。
- API：`GET /api/data/status`（state/needsUpdate/reason/source/tdx/online/sourceMaxDate/lastCheckedAt/lastResult/revisionWarning）；`POST /api/data/refresh`（202 新任务 / 200 joined / 409 无可用来源）。needsUpdate 由 status 现算（绝不触发扫描）：sourceMaxDate 早于"今天之前最近的工作日"→true（建议性提示，节假日可能误报由 reason 文案兜底）；无来源→false 并说明。`/api/env` 保持原语义未迁移（每次现扫），与协调器独立。
- R0 守卫：`engine.advanceTraining` 无下一根时，满足三者之一才允许到期结算——该股数据末日≥plannedEnd、(tail, plannedEnd] 全为周末、或全市场缓存尾≥plannedEnd（按停牌处理）；否则 409"等待日线数据…"保持 running 不写入，用户可提前结算；既有 settled 训练不重开。
  此为当前实现；全市场尾不能证明个股停牌，结束日后有记录也不能证明中间无漏数，与日线计划 §3 尚有差距（DATA-02）。
- `catalog.ts`：市场级读取失败不再当空目录——非 ENOENT 重试 1 次；ENOENT＋缓存无该市场记录=absentMarkets（真不存在），否则=failures（保留旧缓存，中文 message）；upsert/删除按市场缓冲后单事务应用，删除只对扫描成功的市场执行。新增字段 `failures`/`absentMarkets`，既有消费者只读 `.stocks`/`.stats` 不受影响。
- 前端 `web/src/dataStatus.ts`：响应式单例 store。启动立即检查；window focus / document visibilitychange 回前台 ≥60s 节流；hidden 不检查不轮询；running 时 1s 轮询上限 120s，`checkSeq` 防竞态。App.vue 顶栏控件状态机：ok（按钮隐藏，绿点＋"数据已最新 · 截止 X"）/ running / failed / attention（琥珀＋shake，入场 3 次＋每 12s 换 key 重触发）/ unavailable / legacy（旧服务端 404 兜底回退 env 文案）；`prefers-reduced-motion` 降级。Launcher 开始训练在 needsUpdate 时弹【先更新数据 / 仍要开始训练】；Training 操作栏固定 48px 小按钮＋终态 2.6s 轻提示，不改栏高。
