# REC-01迁移前录制基线

2026-09-19。本记录为v2实施前的功能分支基线，不是最终交付或用户验收。用户已授权紧凑方案，最终版本仍需完整候选门禁、两年训练和压缩回放验证。

## 已合入与验证

- e33e73f：IndexedDB失败后重开、close/versionchange清缓存、blocked迟到连接关闭、restore真实原因；主代理25/25测试及类型检查。
- d58fad9：图表真实画线/视窗操作、只读模式、完整已见行情捕获；主代理63/63相关测试。
- b273cdb：离线回放；暂停与恢复seq连续时正确标注未录区间，常驻历史缺口摘要。主代理在集成树重跑recorder/storage/replay合计49/49，Vue类型检查通过。
- 主代理接线：默认开启、首页/训练内开关、状态、录制故障重试、JSON导入导出、个人训练与只读回放隔离。

## 真实浏览器回归

命令`npm run journey -- e2e/recording.spec.ts --retries=0`，独立冻结TDX样本/SQLite/动态端口。首次run-da8e7c4f-c71c-4624-9e90-0da0704dff65通过4/4，主代理看截图/录制后发现正常开局多了暂停/恢复缺口，旧用例漏检。

补断言后run-847fe911-b66c-4ed0-b6b2-535add9a334e按预期失败：正常开局期望gaps=[]，却收到{afterSeq:2,resumedAtSeq:3}。根因是创建参数来自Vue响应式props，直接传Recorder.begin导致structuredClone失败；恢复逻辑随后伪造初始化缺口。改为先recordingPlain DTO复制。

修复后run-a708c8ea-c89c-4774-b167-6d9a136ea399，退出码0、4/4通过（58.7s）。初始默认开启导出gaps=0且training.create started/finished完整；人为暂停恢复的导出恰好1段gap。

四条路径覆盖：延迟上下文初始化防漏首笔；买入/T+1拒单、推进、日周月、真实鼠标画线、暂停恢复、JSON导出及屏蔽API后的只读回放；注入IndexedDB打开失败后恢复；首页初始关闭、刷新保留暂停、本场结束后下场默认开。运行日志、实际导出和截图在对应run artifacts，未访问个人训练库。

主代理已查看首次run的训练/回放深色1440×900截图；这不是新v2深浅主题完整视觉验收。最终v2必须重新检查。

## 尚未通过的整体验证

全量`npm test`首次在测试执行进程通信层中断，`ERR_IPC_CHANNEL_CLOSED`（退出1，日志rec-v1-integrated-unit.log）。相同测试集合使用`--maxWorkers=4`重跑，退出0、45文件476/476通过（213.21s，rec-v1-unit-workers4.log）；首次异常保留，不据此断言根因已经确证。主代理核对改动源码/测试SHA256与55c2842一致，映射见result.json。看板11项标准库测试也通过。

正式候选仍须执行全量单测、生产构建、样本M2和完整Journey，不能用本页4条定向路径替代。新格式实施后必须重新验证，这些结果只描述迁移前基线。
