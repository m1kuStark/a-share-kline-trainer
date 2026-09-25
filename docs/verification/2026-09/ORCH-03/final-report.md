# ORCH-03 最终本地验收

2026-09-25。控制器工程与真实试点已完成本地验收，试点最终状态verified，can_promote=false。真实路径包含用户关闭Mimosa和主代理接管，未证明零干预的GLM完整成功路径；无自动GPT adapter、Scout OS只读隔离或自动合入/推送。

## 交付与机器验证

- 状态模块3146524；执行闭环1f4d779；显式恢复3e2b2141752fdbaeb65902de6ab3454d9b7d79d0。代码已同步当前工作区，未覆盖其他改动。
- 完整Python回归206项，203通过、3平台/权限跳过，退出0。命令、耗时及原始输出见[恢复入口验收](resume-acceptance.md)和[resume-tests.txt](resume-tests.txt)。没有以跳过项冒充通过。
- 真实试点最终提交f56c9ef95bcfc618b9c1101582271120794d7a7a，保留在task/ORCH-03-pilot。当前工作区经基线字节比较同步了示例配置_readme修正；其余字段/defaults不变。
- 原固定contract/policy未改动，独立config-help检查退出0、进程清理确认；收据复核通过，verification_run_id为verify-d957804fb9174558a622b2f1b5df611f。完整认证原件及key留控制store，可分享投影见[pilot-proof.json](pilot-proof.json)，投影不冒充可转移收据。
- 第二次CLI run仍verified；事件、attempt目录、GLM job及收据集合逐项相同，证明没有重复派发/计数/验收执行。

## 真实路径

| 尝试 | 执行方与产物 | 结果 |
|---|---|---|
| 1 | GLM job-f7eedb6481ad4e4dba4e75a287812efc，未提交_readme修改 | Mimosa在工具调用前拒绝提交，控制器交接；原差异与报告留存 |
| 2 | 用户授权关闭Mimosa后显式resume；GLM job-f38247d5f65a4c569c7fc88bf9f5b463，正常提交7afaae3 | 新会话无Mimosa hook；报告含未确认假设，固定oracle又拒绝“未提供向导”文字，未被误判通过 |
| 3 | 两次replan后规则选择GPT Direct；主代理在同任务内显式接管，修正文案并正常提交f56c9ef | 独立验证和认证复核通过，控制器置verified；没有自动调用GPT适配器的宣称 |

最终计数：execution_started=3、replan=2、failure=1、verification_passed=1；GLM真实调用2次，主代理原生执行1次。首次派发前的混合行尾拦截发生在execution_started之前，记录为控制层预检处置，不伪装成模型调用。全程保持原task_id、合同、policy和预算，没有删除失败历史。

Mimosa按用户明确授权在Z code用户配置中停用，原配置备份保留。新CLI实际启动日志其他插件有hook、Mimosa为0，后续正常git commit成功；未使用--no-verify。详情见[授权处置](mimosa-resolution.md)。首轮worker在拒绝后仍写报告和两份Zcode memory，说明当前仅有任务边界、没有OS写隔离；这些事实未删除，也未扩展为安全隔离保证。

## 协作结论与后续

本轮证实了持久状态、派发、失败交接、显式恢复、规则升级、独立收据和终态幂等可以串联运行。多数实现由GLM完成；控制层在真实反例出现后收紧关键不变量并完成最后文案修正。工具开发中的超时/返工见[loop重规划](loop-replan.md)，不以最终通过掩盖。

本次试点不能量化强模型成本节省。[worker-usage.json](worker-usage.json)只记录provider实际返回的计数，强模型用量没有可靠基线。ORCH-04继续做分类验收/集成；同时应让可分享的机器检查条件更清楚地进入worker合同，校准非阻塞说明与真正未决假设的区分，再扩大GLM Direct试点。未降低当前固定oracle或自行启用自动合入。

本批没有改产品交易逻辑或个人训练库，没有进行无关产品UI/构建测试。用户产品阶段验收仍未记录，工程任务进入review；本批自动续接在文档检查后停止。
