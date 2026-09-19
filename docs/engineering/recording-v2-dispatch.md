# REC v2并行派发与合并次序

2026-09-19用户要求提高GLM并行度。接口以[v2合同](recording-v2-contract.md)和compactTypes.ts固定版本为准，集成人唯一负责跨模块改动。工作树、进程、日志、配置、测试输出各自独立，依赖必须明确。

| 批次/任务 | 工作树 | 独占修改范围 | 依赖与合并 |
|---|---|---|---|
| 第一批：codec审查修正 | REC-CODEC | compactCodec.ts、对应测试/说明 | 基线2f773c9；修复通过才合入REC-01 |
| 第一批：validator | REC-VALIDATE-V2 | compactValidation.ts、validation.ts迁移预算、对应测试/说明 | 同一类型基线2f773c9，不改codec/types；codec修复先合，再重跑联合测试 |
| 后续：压缩文件 | 待创建 | recordingFile.ts、对应测试/说明 | 已验收codec+validator，可与存储开发并行 |
| 第一批新增：增量存储 | REC-STORAGE-V2 | compactStorage.ts、对应测试/说明及可选IDB测试stub | 同一类型基线2f773c9，端口另在Prompt明确；不依赖未完成validator、不改Recorder/UI |
| 后续：紧凑Recorder | 待创建 | compactRecorder.ts、对应测试/说明 | 固定codec/validation/storage端口后可用内存实现开发 |
| 最后：页面与验收 | REC-01（集成人） | useRecording/App/SessionReplay/E2E与全局状态 | 各模块审查后统一接线、完整候选验收 |

第一批从两个GLM开始，启动核验双方已有9/8次成功模型请求且无错误后，加入第3个独立存储任务。不能把共享文件写入分给两个活动任务。所有GLM最高思考档，测试建议maxWorkers=2减少本地争用。后三项完整任务仍未验收，不能把请求成功当交付。

开发完成仅生成待复核状态。逐分支检查范围、类型、有效测试、真实数据往返和异常路径，再按表序合入；worker不Git提交/合并/推送，集成人掌握提交SHA与证据。2f773c9是审查基线，包含已知恢复缺陷，不能因被validator分支引用就视为已验收。

派发器以工作树锁/批次锁/槽位锁保互斥，group索引与各任务状态避免完成消息相互覆盖。运行器测试15项通过（含两个真实进程并行、第三槽位拒绝、同worktree拒绝）；旧单队列协议已更新。线程heartbeat逐个检查本批完成结果，主代理不持续轮询模型进度。
