# REC v2并行派发与合并次序

2026-09-19用户要求提高GLM并行度。接口以[v2合同](recording-v2-contract.md)和compactTypes.ts固定版本为准，集成人唯一负责跨模块改动。工作树、进程、日志、配置、测试输出各自独立，依赖必须明确。

| 批次/任务 | 工作树 | 独占修改范围 | 依赖与合并 |
|---|---|---|---|
| codec审查修正已合入 | REC-CODEC | compactCodec.ts、对应测试/说明 | 2f2f95b通过25测试/真实行情往返；已合入REC-01 |
| 第二批：validator返修 | REC-VALIDATE-V2 | compactValidation.ts、对应测试/说明 | e4858c6为待修审查基线；修未来基础/周期/还原预算，未合入 |
| 第二批：压缩文件 | REC-FILE-V2 | recordingFile.ts、对应测试/说明 | 固定codec+validator API独立开发；继承e4858c6待修实现，最终合并validator修复后联合验证 |
| 第二批：存储返修 | REC-STORAGE-V2 | compactStorage.ts、对应测试/说明及必要stub | de3f4e2为待修审查基线；真实IDB发现header冲突误采纳，修正后再合入 |
| 后续：紧凑Recorder | 待创建 | compactRecorder.ts、对应测试/说明 | 固定codec/validation/storage端口后可用内存实现开发 |
| 最后：页面与验收 | REC-01（集成人） | useRecording/App/SessionReplay/E2E与全局状态 | 各模块审查后统一接线、完整候选验收 |

第一批从两个GLM开始，启动核验双方已有9/8次成功模型请求且无错误后，加入第3个独立存储任务。不能把共享文件写入分给两个活动任务。所有GLM最高思考档，测试建议maxWorkers=2减少本地争用。后三项完整任务仍未验收，不能把请求成功当交付。

开发完成仅生成待复核状态。逐分支检查范围、类型、有效测试、真实数据往返和异常路径，再按表序合入；worker不Git提交/合并/推送，集成人掌握提交SHA与证据。2f773c9是审查基线，包含已知恢复缺陷，不能因被validator分支引用就视为已验收。

第二批已开始；每个审查基线的提交只便于隔离开发和复现，不等于过门禁。验收细节见[并行批次审查](../verification/2026-09/REC-01-v2-batch-review/report.md)。

派发器以工作树锁/批次锁/槽位锁保互斥，group索引与各任务状态避免完成消息相互覆盖。运行器测试15项通过（含两个真实进程并行、第三槽位拒绝、同worktree拒绝）；旧单队列协议已更新。线程heartbeat逐个检查本批完成结果，主代理不持续轮询模型进度。
