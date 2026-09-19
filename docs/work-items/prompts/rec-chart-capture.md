极小任务REC-CHART-B：组件readOnly已完成后，仅改KlineChart.vue、recording/chartCapture.ts、server/test/recording-chart-capture.test.ts。不要做操作action标签，不改页面/types，不git提交。
新增emit chartCapture:[ChartCapture]、expose captureState()。纯helper已有但需修toIndex为排他上界时取to-1并floor/clamp、amount不能凭空补0；toK必须保存传入bar.amount，loadedData完整历史一起捕获。captureState返回types.ts合同的chart对象，view左右真实timestamp、barSpace、各语义pane正高度；costPrice优先chartCostPrice。数据/历史加载和视窗变更后150ms尾沿emit，恢复/卸载不递归发，非finite数据抛错让调用方显示录制失败。
新增可选replayView?:ChartCaptureView，数据feed完成布局后按barSpace和右时间锚点恢复（不拿旧dataIndex硬套），设置pane高度。有相同view避免循环。初始空数据时bars[]、timestampnull、barSpace有效正数，不emit过早undefined。
测试helper amount保留、完整历史、to排他边界、深拷贝；npm test -- server/test/recording-chart-capture.test.ts和typecheck。完成即停止，不做后续动作标签。
