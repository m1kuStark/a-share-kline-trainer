# 按判断需求进行模型协作

用户2026-09-24认可原则：strong models decide，cheap models discover and execute，deterministic systems verify。按判断密度、oracle可靠性与失败代价选路，不按文件数量固定GPT→GLM→GPT。设计及实施状态见[自适应路由](../proposals/adaptive-model-routing.md)、[ORCH阶段](../work-items/milestones/ORCH.md)。

## 当前能力与过渡

route.py仍生成四路影子建议；controller CLI可对显式登记的GLM Direct和已设计合同执行任务，真实试点已完成（含人工接管），旧候选证明继续兼容原门禁。[独立verifier](verifier-usage.md)已接入固定配置、提交/字节绑定、日志校验和认证收据；run_glm的completed仍只表示执行完成。路由可消费有效收据决定修复或风险审查。ORCH-03提供显式执行闭环，ORCH-04增加受控分类门禁；具体行为见[测试门禁](testing.md)。

ORCH-03控制器、恢复入口及真实试点已完成本地验收，见[最终记录](../verification/2026-09/ORCH-03/final-report.md)。试点经历人工GPT Direct收尾，不能据此声称零干预；GPT自动adapter和Scout的OS只读隔离仍未实现，需要这些能力时保守交接。

## 路由与职责

| 路由 | 条件 | 职责 |
|---|---|---|
| GLM Direct | 机械且oracle可靠，约束已经确定 | GLM执行，机器验证，按风险抽查 |
| GLM Scout then decide | 难点与影响未知 | 限预算侦查；规则能决定就继续，不能决定才调用GPT |
| GPT Plan / GLM Execute | 需要设计取舍，之后可独立执行 | GPT冻结必要决定，GLM完成含API/页面接线的行为切片 |
| GPT Direct | 持续判断或计划反复失效 | GPT保持循环，机械工作可委派 |

共享文件要明确owner和串行写入，不等于只能由强模型编写。已批准Schema/API变更不重复升级；新约束、越界、语义冲突、缺oracle、两次同因repair失败及反复重规划触发控制层。环境故障单独预算。升级GPT不等于重新询问用户已授权事项。

## Worker Contract与证据

ORCH-04的候选门禁和离线效果对照已通过[本地验收](../verification/2026-09/ORCH-04/final-report.md)，实现边界见[分类审查计划](classified-review.md)。旧candidate-proof仍保留原门禁；新文档豁免须由控制代码根据实际Git变化决定。对照记录区分系统放行与独立质量真值，未知强模型计量不进入“节省”计算。

采用[版本化合同](worker-contract.md)：goal、验收、相关上下文、invariants、允许范围、禁止变化、验证和已知风险。首次worker自主实施，修复时补已证实的反例和约束，不把猜测写成逐行实现指令。

报告给出事实位置、实际改动、测试声明、未知项和重规划请求；原始日志/diff/工件按引用保存，不转发整段对话或思考。任务卡保存产品事实，运行历史按task_id跨job累计。强模型审查从diff和风险出发，再读精确代码。

机器先验证，再按风险做语义/UI检查；只有控制层认证并与当前候选匹配的报告才是独立验证证据，worker自报不替代它。产品验收、工程验证、合入和发布分别记录。新增产品限制先测真实规模和失败条件，不能仅见常量就扩展需求。

## 执行与配置边界

2026-09-25用户明确授权关闭Z code的Mimosa插件，已通过用户配置开关停用并留存备份。该授权不改变独立verifier、任务范围及预算；外部问题解除后的继续使用显式resume检查点，保留历史。处置证据见[Mimosa关闭与恢复](../verification/2026-09/ORCH-03/mimosa-resolution.md)。

- 保留独立worktree、基础SHA、allowed_paths、独立TRAINER_DB和端口；通达信只读。worker不push主干、不改个人库、不降低门禁。
- 从实际Git根启动Z code，Mimosa基线与任务根一致。同一拦截只交接一次，不使用--no-verify或其他绕过方式；集成人按已有授权审查。
- 保留GLM-5.3-Flash最高支持思考档和1M配置目标；配置不等于已实测容量，也不要求填满上下文。接口、输出额度及版本按[CLI经验](zcode-cli.md)核验，不编造参数。
- 并发按独立行为/文件所有权与账号额度管理，沿用已验证2～3路经验及runner最多4槽位。真实429/1302有限退避并下调并发，不自行降低思考档。
- 用[登记后台入口](../../scripts/agent-monitor/README.md)，看板显示Prompt、活动和结果；凭据由Z code登录存储使用，日志/provider副本在工程外。
- 长调用后台执行，按完成事件更新job；沿用已授权25分钟heartbeat续接，无独立工作不反复轮询。多任务用group索引，不共用wake-state；全部处理后停止续接自动化。
- 未验证强模型自动调用入口时明确waiting_control，不能把写交接文件说成GPT已接管。工程授权不包含发送无关个人文件到模型。

历史参数和故障事实保留在CLI经验和验证记录；其中主代理固定承担全部实现/复跑的旧职责表述以本页为准，实际工具闸门按已实现版本执行。
