# REC-V2-REPLAY：按需还原与有界操作列表

GLM5.3Flash最高档。工作树D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-REPLAY-V2，基线7edbed9，依赖已准备。读根/web/组件约束及v2合同、现SessionReplay.vue、compactCodec接口、replay.ts。只改SessionReplay.vue、recording-replay.md，并新增web/src/recording/compactReplay.ts及server/test/recording-compact-replay.test.ts。不改App/useRecording/Training/旧replay.ts/codec/types/validator/storage/包/Git/其他工作树，不个人数据或浏览器/子agent。根统一集成另两个Agent。

当前SessionReplay props.recording为RecordingFile v1。改兼容RecordingFile|CompactRecordingFile，入口对已校验v1 compactRecording一次；v2不转回完整v1。computed单个CompactReader稳定复用，seq二分选最近afterSeq<=当前的轻量checkpoint索引，reader只解一个当前cp；同afterSeq多个取最后，没早期cp显示暂无。禁止map全部checkpoints展开，保持图表readOnly/replayView/key/账户/trades/图形精度与原逻辑、完全离线无API/outbox/交易热键。

列表不能v-for全部50000事件。新增纯helper计算以当前seq为中心的最多100项窗口（稳定边界）；界面支持上一组/下一组查看事件，能选中并播放任一步，range/首尾/上下/速度原aria不改（最后一步等）。序号文本是真实event.seq，选步不丢暂停历史摘要；当前seq不在手动浏览窗口时播放推进应回到当前窗口。避免嵌套卡片，沿现样式紧凑，控件用已有lucide图标+title/aria清楚，不添加说明教程。gaps闭合/开放/初始0和尾段文案保持此前修复，play timer卸载和倍速调整正确。

compactReplay.ts只放二分索引/有界窗口纯逻辑，测试旧v1和新v2同seq还原正确/不前窥、0/尾步、10000cp与50000event仍只返回窗口、手动上一下一窗口、同afterSeq、null chart/training与gap原helper兼容。不写纯源码镜像检查。UI真实测试由根跑。npm test -- server/test/recording-compact-replay.test.ts server/test/recording-replay.test.ts --maxWorkers=2；typecheck:web。短报停止。
