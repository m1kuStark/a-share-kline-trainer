# REC v2模块联合验收

2026-09-19。codec、validator与增量storage已进入REC-01功能分支；gzip文件模块暂未通过。该阶段仍未将页面切换到v2，不是用户最终验收。

## 校验与存储返修通过

validator c1504ee：根重跑90/90（32compact＋58v1）及types通过；上轮4独立探针全部正确拒绝未来base.firstCheckpoint、周期不一致、501个还原图形、20001根还原行情。storage b157dfb：根重跑30/30及types通过；真实Edge隔离上下文IndexedDB的roundtrip、追加、等长不同事件冲突和header分叉冲突全部正确，磁盘保留先写入的left版本。

分别合入bdece1d、7edbed9后，codec＋两个validator＋storage合计145/145通过，Vue类型检查通过。未降预算/跳测试来消除错误；四个非法拒绝与真实存储探针仍在全局Headroom保留，可复跑。

## 真实录制迁移

读取既有Journey run-5e66e772-772f-40e7-aabe-e8bb5a44347e的四份真实录制：首笔交易、混合买卖拒单/画线/周期、初始暂停、存储失败恢复。v1校验→compactRecording→v2校验→Node标准gzip解压→v2校验→CompactReader逐检查点深等；事件与gaps完全一致，41个检查点全部通过。详细字节数见[result.json](result.json)。

混合操作样本原3,158,784字节，compact JSON 410,849字节，标准gzip 94,394字节。此处明确使用Node标准gzip验证逻辑数据，不能等同仍待修复的recordingFile.ts产品封装已通过。命令`node node_modules/tsx/dist/cli.mjs <Headroom>/verify-compact-real-recordings.ts`退出0，不写个人库或TDX。

## 文件模块暂不通过

recordingFile首版16/16及types通过，但独立probe证实：仅65字节压缩输入（原文32768个A），调用`inflateGzipWithBudget(stream,64)`750ms后不settle。输出draining越界退出不再读，输入writer.write受背压等待读取；取消动作位于write之后无法到达。1MiB高压缩率亦复现，随机不可压缩多块测试漏掉此情形。1MiB正常文件按1/16/16384/65536/1048576输入分块往返正常。

5fd5e59只作为隔离审查基线，未合入REC-01。已给GLM精确返修任务：越界在输出端立即取消源和解压读写端，让挂起write退出，并补高压缩率多输出块回归。未通过前不将产品gzip标为完成。

## 第三批后续

同时派发独立CompactRecorder和SessionReplay v2按需适配：前者只状态机/测试，后者只回放/事件窗口/测试；接口基于7edbed9，文件修复在REC-FILE-V2。根最后统一useRecording/App接线、迁移和多标签处理，再跑已建立RED的两年Journey、全部候选门禁与深浅视觉。主干保持原基线，用户最终版本尚待完成。
