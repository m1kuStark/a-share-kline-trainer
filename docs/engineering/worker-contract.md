# Worker Contract v1

目标、验收和边界先于实现步骤。worker在合同内使用判断；首次执行不要求照抄实现，失败后补真实反例和约束。入口：[模型协作](model-delegation.md)与[影子路由](../../scripts/agent-routing/README.md)。

## 对象与所有权

| 对象 | 维护者 | 内容 |
|---|---|---|
| contract | 控制层，需要取舍时GPT | goal、验收、上下文、invariants、scope、禁止变化、oracle、预算 |
| report | 执行者 | 带位置和散列的观察、测试声明、未检查项、假设、异常和重规划请求 |
| history / decision | 控制层 `.control/trainer-state.json` | 跨job任务身份、失败指纹、repair次数、路由原因、输入散列、commit/tree/run/artifact 和验收状态 |

事实引用只证明来源字节，不能证明解释正确；测试声明不是独立验证结果。原始日志/diff/工件按引用留在外部缓存；不传思考全文、凭据、个人库或无关对话。简短决策记录须保留排除过的方案及可推翻结论的证据。

## contract字段

schema_version=1；task_id跨attempt稳定，contract_revision为正整数；base_commit是完整SHA。goal为非空文本；acceptance_criteria、invariants、allowed_paths是非空数组；context_refs、known_risks、forbidden_changes、forbidden_paths、semantic_scopes、approved_changes必须显式给出，可为空。

task_shape取mechanical/uncertain/requires_design/designed/continuous_judgment。requires_design尚待决策；designed表示决定已冻结，可直接GLM执行。oracle取reliable/unknown/missing；可靠oracle要给verification_profile名称，但名称本身不证明检查已运行。

approved_changes取public_api/database_schema/concurrency/security/core_abstraction/verification_policy。具体字段和兼容语义仍在invariants/context_refs里；获准Schema迁移不反复升级，超出合同才升级。semantic_scopes表示写入行为领域，不能只列文件名。

budgets包含scout_rounds、same_failure_repairs、total_attempts、environment_retries，均为正整数，同因repair最多2次。总attempt耗尽只建议控制层接管评估，不自动再执行。模型思考档沿用max，精简交接不等于降低思考档。

## report字段

schema_version=1；task_id、contract_revision、base_commit与合同一致，observed_commit与HEAD一致。status取completed/partial/failed/needs_replan；assessment取local_execution/needs_design/continuous_judgment/unknown。

facts每条含statement、仓库相对path、正整数line及文件sha256。CLI核对真实文件、行号和散列，缺失或变化后按stale处理。tests每条含command、exit_code（未知null）、artifact引用，只作声明；artifacts为其他工件引用数组。

assumptions、uninspected_areas、unexpected_findings、requested_scope、reported_changes显式给出；needs_replan必须为布尔值。关键处未检查或新假设出现会撤销旧的机械分类。首版不使用脏工作树报告降低路由级别；待内容快照绑定完善后再支持。

## history与验证

history为控制层事件数组：event_id、task_id、kind；失败另含failure_fingerprint，job_id可供追溯。kind取failure/repair_failed/environment_failure/replan/scout_completed/execution_started/verification_passed。同ID同内容去重、异内容拒绝；初次failure不算repair，连续同因repair跨job累计，验证通过结束旧失败链。环境失败单独预算，不被低风险报告覆盖。

[ORCH-02独立verifier](verifier-usage.md)绑定contract/policy/profile版本、commit/tree、实际源码/测试/夹具字节、命令/退出码/日志；报告由候选仓库外控制key认证。worker可以补回归，既有受保护文件修改需按字节散列批准。路由未提供收据时verification_status=not_evaluated；提供收据时先认证和复核，再给出passed/failed/blocked。can_dispatch/can_promote仍恒为false。

## 兼容和信任

v1校验关键字段，额外字段不参与决策，未知版本拒绝。JSON最多1MiB，拒绝重复键和非有限数；事实单文件最多2MiB。完整工件独立保存，不因简报预算丢弃错误原件。

当前合同由显式文件传入；`.control/trainer-state.json` 是唯一当前状态文件，使用文件锁、`state_revision` 和原子替换，尚无跨用户身份认证。影子 JSON、GLM job 和 DWF report 不能作授权证据。ORCH-03 的完整合同、日志和认证收据仍由控制器外部缓存持有，项目状态只保存可读摘要和证据引用。产品任务卡保存静态 scope/deps/acceptance，运行轨迹不再塞进任务卡或 `current-feature.json`。
