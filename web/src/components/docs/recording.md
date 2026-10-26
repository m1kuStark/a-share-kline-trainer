# 图表录制：语义操作与视窗上报

本页记录 [KlineChart.vue](../KlineChart.vue) 面向录制层（`web/src/recording/`，合同见 [recording-contract](../../../../docs/engineering/recording-contract.md)）的输出契约。事件仲裁与生命周期主表在 [interaction](./interaction.md)；此处只记录录制相关的入口映射与抑制规则。

## operation 上报

新增 emit `operation`，载荷 `{ action: Action; params?: JsonValue }`，类型取自 `web/src/recording/types.ts`。每次真实且成功的语义操作恰好一条；`readOnly`、`restoringDrawings`（恢复图形期间）与卸载后由 `emitOperation` 总闸静默，绝不外发写动作。params 只携带语义图形（id/name/paneId/points）的有限 JSON，不透出 klinecharts 实例。

| 动作 | 上报点 | params |
|---|---|---|
| chart.drawing.create | onDrawEnd（仅已完成非文本图形）、finishPolyline 成功、confirmTextPanel（isNew） | 单个图形 |
| chart.drawing.move | onPressedMoveEnd 且"overlayID＋最近已上报快照"确实变化 | 单个图形 |
| chart.drawing.edit | applyEdit 实际应用≥1个（一次确定一条，汇总全部）、confirmTextPanel（非新建） | 图形数组 / 单个图形 |
| chart.drawing.delete | removeViaMenu / deleteSelected，ids 先经 findDrawing 验真 | ids＋图形数组 |
| chart.drawing.undo / redo | DrawingHistory undo/redo 成功 | 无 |
| chart.drawing.cancel | cancelDrawing 确实移除半成品（工具切换、右键取消、画笔点数不足）；cancelTextPanel 仅新建放弃 | id/name（含已知 points） |
| chart.drawing.clear | 确认且非空 | `{ count }` |
| chart.tool | props.drawTool 真正激活用户工具；取点完成自动退回 null 不冒充选择 | `{ name }` |

文本标注 onDrawEnd 只开面板不记 create；已存在标注取消面板不改数据、不上报。`window pointerup` 兜底（completePointerAction）只写历史不发动作：它先于库的 mouseup/onPressedMoveEnd 执行，history.record 的布尔会被竞争消费，因此 move 依据"overlayID＋终态快照"指纹比较（`lastReportedDrawing`，纯助手见 [`recording/drawingOperations.ts`](../../recording/drawingOperations.ts)），保证来源事件不丢、不重。基线表必须与当前图形集合精确同步：`restoreDrawings`（加载、撤销、重做、清空）结尾整体重播种并清除陈旧 id——否则已加载/已撤销图形的首次按压被误报 move，撤销后移回旧端点的真实 move 被旧指纹吞掉；删除路径（右键菜单、Delete 键）逐 id 清除基线。params 经 `drawingOperationParams` 序列化，只带有限 JSON 并按有限性兜底过滤不完整点位。

## chart.viewport 上报

只在真实用户导航后 150ms 尾沿上报一次（复用 `VIEWPORT_CAPTURE_THROTTLE_MS`），params 为当前视窗（fromTimestamp/toTimestamp/barSpace/paneHeights）。入口：wheel 平移、框选缩放两条路径结束、轴缩放拖拽松手、窗格分隔松手、中键平移松手、zoomBy 实际改变、`resetView(userInitiated = true)` 的用户复位（Home 键、回到最新）。复位显式区分用户与程序：**父层程序化调用（timeframe/数据加载后的复位）必须传 `resetView(false)`**，挂载初始化即 `feedData(); resetView(false)`，`false` 绝不发 operation。补历史、布局 resize、replayView 程序恢复均不经这些入口；数据替换（feedData）会作废挂起的上报——旧数据上的用户手势不得在新 timeframe 数据上落账；恢复视窗与卸载同样撤销挂起的定时器。只读回放不下发也不上报 operation。

## 监听与清理

新增持有一项：`viewportOpTimer`（setTimeout 尾沿），在 `applyReplayView`、`feedData`（数据替换作废挂起上报）与 `onUnmounted` 中经 `cancelViewportOperation()` 成对撤销；window 监听无新增。interaction.md 生命周期表的本项登记由集成人合并（REC-CHART-C 任务范围仅允许写本页）。

回归：`server/test/recording-chart-actions.test.ts`（动作入口、只读与程序 restore 抑制、viewport 入口与抑制、基线表同步接线）与 `server/test/recording-drawing-operations.test.ts`（基线表重播种/清除与 params 有限性兜底的行为回归）。

## 录像库收藏与自定义目录（REC-COLLECT-01，用户交互说明）

[RecordingLibrary.vue](../RecordingLibrary.vue) 在两列清单之上提供「目录」条：内置「收藏」（星形图标恒置顶，**不可删除、不可重命名**）＋用户自建目录＋「新建目录」。收藏索引与录像库同 namespace 存于 IndexedDB 独立库（`<录像库>.collections`），录像本体存储与自动归档命名零改动。

- **星标**：每条录像（本机/导入两列一致）最左侧星形按钮，点击即在「收藏」目录加入/移出（QQ 邮箱式），按钮状态（实心/空心）如实反映当前归属。
- **归档**：条目「归档到目录」按钮展开目录勾选面板；勾选即加入、取消勾选即移出（幂等），内置「收藏」也在面板内（与星标等价）。同一录像可属多个目录。
- **目录管理**：用户目录可重命名（重名/空白名拒绝并提示）、可删除（确认后仅清除成员关系，录像本体不动）。新建目录名称去首尾空格，空白与重名（含「收藏」）拒绝。
- **按目录过滤**：点击目录条即在两列中只显示该目录成员（跨本机/导入），计数实时；「全部」恢复完整清单。
- **导出携带收藏结构**：「全部导出」的合并包在 items 之外携带可选 `collections` 收藏清单（目录名+成员，含内置收藏）；旧版训练器（v1.3.3 及以前）解析器只认必需字段，可正常导入不带结构损失的录像条目。
- **导入合并**：合并包携带 `collections` 时，批量导入完成后按**目录名合并**——重名目录成员取并集不丢既有成员，内置收藏映射到本机「收藏」；清单成员经 sessionId 与导入项 originalSessionId 双通道解析，解析不到的跳过并如实计数（「跳过无法解析成员 N 条」）。
- **级联清理**：删除单条录像或清空某列时，该录像在所有目录的成员关系一并清除（失败不阻塞删除，仅记录诊断日志）。

回归：`server/test/recording-collections.test.ts`（核心语义＋recordingRepository 接线/级联/守卫）＋`server/test/recording-bundle.test.ts`（合并包 collections 字段契约与兼容）＋`e2e/recording-collections.spec.ts`（星标/目录/过滤/导出导入合并/级联，真实浏览器 IndexedDB）。
