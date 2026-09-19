# GLM任务 REC-CHART

在当前独立worktree实现图表录制接缝和只读能力。先读AGENTS、web/AGENTS、web/src/components/AGENTS及docs/engineering/recording-contract.md、现有库适配登记。只改web/src/components/KlineChart.vue、web/src/recording/chartCapture.ts（需要时新增）、server/test/recording-chart.test.ts、web/src/components/docs/recording.md。不要改App/Training、共享types/recorder、package及全局状态。禁止git commit/merge/push/reset，禁止个人DB/TDX、浏览器及全量Journey；主代理验收。

公共类型已在web/src/recording/types.ts实现，以实际类型为准。KlineChart新增readOnly?:boolean=false、replayView?:ChartCapture['view']；emits新增operation: [{action:Action,params?:JsonValue}] 和 chartCapture:[ChartCapture]；expose captureState():ChartCapture。不得破坏旧props/emits/只读测试hooks或现有事件优先级。

captureState保存完整已加载历史行情（loadedData，不只props.bars；amount也需保留），当前timeframe、所有完成用户图形、costPrice、实际左右时间锚点、barSpace、语义pane高度。不可变复制。图表数据变化、历史加载、视窗变化产生chartCapture；高频手势节流约150ms并末次完整捕获，卸载清理。避免props更新→emit→父render递归。

动作在实际create/edit/move/delete/undo/redo/clear/cancel/tool处明确标记，不靠数组差异猜；恢复drawings/feedData期间不记用户操作。图形创建/编辑/文本取消不改变原语义。完整view同步会发chart.viewport，程序化初始加载不刷大量无意义操作。

readOnly必须在UI和暴露方法/事件入口都防止修改；禁drawTool、用户图形拖动/删除/右键编辑/文字编辑/undo等，不能只隐藏按钮。恢复savedDrawings用于只读渲染仍可用，但不能emit drawingsChange。保留纯浏览的缩放、平移、十字线；引擎标记照常。优先给只读图形lock/ignoreEvent并在写入口return；别粗暴屏蔽canvas所有事件。可将replayView应用在feedData完成后的图表布局，设置barSpace/滚动锚点/pane高度，避免复用dataIndex跨周期。

先写必要测试，再实现。至少测试纯capture转换保留历史/amount/锚点以及只读约束，严格类型检查。运行 npm test -- server/test/recording-chart.test.ts server/test/frontend-contract.test.ts 和 npm run typecheck:web。不要为了过测试删旧断言；如旧断言因必要接口变化失效，说明给主代理。

保持组件新增逻辑尽量独立，必要helper在授权chartCapture.ts，避免把更多流程堆成超长行。返回文件、真实测试、接口行为和疑点。
