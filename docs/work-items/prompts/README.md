# REC-01 GLM Prompt索引

这些是实际委派给GLM 5.3 Flash的可审查任务说明，主代理验收后才提交；不因存在Prompt就认定任务已完成。

| 步骤 | Prompt |
|---|---|
| 小请求验证与类型合同 | [类型](rec-types.md) |
| 导入/导出数据校验 | [校验](rec-validation.md) |
| 录制状态和IndexedDB | [录制](rec-recorder.md) |
| 图表分拆 | [只读](rec-chart-readonly.md)、[采集](rec-chart-capture.md)、[动作](rec-chart-actions.md)；[原任务](rec-chart.md)保留拆分背景 |
| 离线回放页 | [回放](rec-player.md) |
| 已确认问题的修复 | [存储重试](rec-harden-storage.md)、[真实暂停缺口](rec-player-gap-fix.md) |
| v2第一单元 | [紧凑编解码](rec-v2-codec.md)，只开发纯codec与类型，验收后进入下一单元 |
| v2并行批次 | [codec修正](rec-v2-codec-review-fix.md)、[校验器](rec-v2-validator-parallel.md)、[增量存储](rec-v2-storage-parallel.md)，独立工作树和修改范围 |
| v2第二批 | [校验返修](rec-v2-validator-review-fix.md)、[存储返修](rec-v2-storage-review-fix.md)、[gzip文件](rec-v2-file-parallel.md)，codec已验收后继续 |
| v2第三批 | [解压取消返修](rec-v2-file-cancel-fix.md)、[紧凑录制器](rec-v2-recorder.md)、[按需回放](rec-v2-replay.md)，独立模块并行 |
| 集成审查修复 | [Recorder输入原子性](rec-v2-recorder-atomic-fix.md)，异常输入拒绝后仍可继续正常记录 |
| 只读规则/权息上下文 | [上下文](rec-context.md)、[审查修正](rec-context-fix.md) |

子分支在REC-01功能集成分支顺序合并，完整功能再经候选门禁进入main。账户实际限流后模型请求改为串行，Git隔离与本地审查/测试仍保留并行能力。
