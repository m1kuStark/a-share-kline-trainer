# GLM任务 REC-PLAYER

在当前独立worktree新增只读录制查看器。先读根AGENTS、web/AGENTS、docs/engineering/recording-contract.md，以及web/src/recording/types.ts/validation.ts真实接口。只改web/src/views/SessionReplay.vue、web/src/recording/replay.ts、server/test/recording-replay.test.ts、web/src/views/recording-replay.md。不要改App/Training/KlineChart、共享types/recorder、package、全局styles或任务卡。禁止git提交/合并/推送、浏览器/外网、个人DB与TDX。

SessionReplay props recording:RecordingFile，emit close。它完全离线，仅消费JSON中的checkpoints；不能调用任何训练/交易/画线API，不挂outbox、不注册交易快捷键。复用KlineChart（另一Agent正实现readOnly/replayView），传:read-only=true、:bars/checkpoint.chart.bars、:trades/checkpoint.training.trades、:cost-price/chartCostPrice、:timeframe、:saved-drawings、:replay-view，不用任何hook写状态。按checkpoint ID key重建或适当更新确保显示正确。

页面包含录制标题/版本、当前事件说明、开始/上一/播放暂停/下一/最后、播放速度、range定位、操作列表、账户摘要、暂停记录缺口提示及关闭按钮。选择事件使用最近afterSeq<=当前seq的checkpoint，不能显示未来checkpoint；没有checkpoint时明确显示暂无可展示状态。每次播放以相邻elapsedMs缩放并限制最长等待，组件卸载清计时器，导入只读且不会改变其他训练。

界面中文、深浅主题、紧凑布局，控件role/label稳定，例如'播放录制'、'暂停回放'、'下一步'、'关闭回放'、'回放步骤'。将本组件样式scoped，使用已有色变量，横向不溢出；图表尽量充分空间。文本插值而非v-html。

replay.ts放纯选择/时间间隔/事件说明helper；测试乱序输入应由validator拒绝，但helper边界不能前窥。测试暂停区间、首步无checkpoint、最后步、播放等待上限。不写只断言源码字样的镜像测试。npm test -- server/test/recording-replay.test.ts；typecheck可能在KlineChart新props还未合入前报错，明确记录接口依赖，不自行改图表。

返回文件、真实测试退出码、缺口。不加工具平台，不扩大范围。
