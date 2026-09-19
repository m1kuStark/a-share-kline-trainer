# REC v2并行派发与合并次序

2026-09-19用户要求提高GLM并行度。接口以[v2合同](recording-v2-contract.md)和compactTypes.ts固定版本为准，集成人唯一负责跨模块改动。工作树、进程、日志、配置、测试输出各自独立，依赖必须明确。

| 批次/任务 | 工作树 | 独占修改范围 | 依赖与合并 |
|---|---|---|---|
| codec审查修正已合入 | REC-CODEC | compactCodec.ts、对应测试/说明 | 2f2f95b通过25测试/真实行情往返；已合入REC-01 |
| validator已合入 | REC-VALIDATE-V2 | compactValidation.ts、对应测试/说明 | c1504ee通过90测试及四非法探针拒绝，已合入 |
| 第三批：文件取消返修 | REC-FILE-V2 | recordingFile.ts、对应测试/说明 | 5fd5e59仅审查基线；高压缩率超预算解压背压死锁未通过，精确返修 |
| 存储已合入 | REC-STORAGE-V2 | compactStorage.ts、对应测试/说明 | b157dfb通过30测试及真实IDB header冲突拒绝，已合入 |
| 第三批：紧凑Recorder | REC-RECORDER-V2 | compactRecorder.ts、对应测试/说明 | 基线7edbed9，已验收codec/validation/storage接口；不改页面 |
| 第三批：按需回放 | REC-REPLAY-V2 | SessionReplay.vue、compactReplay.ts、对应测试/说明 | 基线7edbed9，兼容v1/v2，单检查点还原和100项事件窗口 |
| 最后：页面与验收 | REC-01（集成人） | useRecording/App/SessionReplay/E2E与全局状态 | 各模块审查后统一接线、完整候选验收 |

第一批从两个GLM开始，启动核验双方已有9/8次成功模型请求且无错误后，加入第3个独立存储任务。不能把共享文件写入分给两个活动任务。所有GLM最高思考档，测试建议maxWorkers=2减少本地争用。后三项完整任务仍未验收，不能把请求成功当交付。

开发完成仅生成待复核状态。逐分支检查范围、类型、有效测试、真实数据往返和异常路径，再按表序合入；worker不Git提交/合并/推送，集成人掌握提交SHA与证据。2f773c9是审查基线，包含已知恢复缺陷，不能因被validator分支引用就视为已验收。

第二批已验收，第三批三个独立GLM任务继续。审查基线提交不等于过门禁。第一批细节见[首批审查](../verification/2026-09/REC-01-v2-batch-review/report.md)，后续见[模块联合验收](../verification/2026-09/REC-01-v2-modules/report.md)。

派发器以工作树锁/批次锁/槽位锁保互斥，group索引与各任务状态避免完成消息相互覆盖。运行器测试15项通过（含两个真实进程并行、第三槽位拒绝、同worktree拒绝）；旧单队列协议已更新。线程heartbeat逐个检查本批完成结果，主代理不持续轮询模型进度。
