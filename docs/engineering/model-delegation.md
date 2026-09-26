# 按判断需求进行模型协作

用户2026-09-24认可原则：strong models decide，cheap models discover and execute，deterministic systems verify。按判断密度、oracle可靠性与失败代价选路，不按文件数量固定GPT→GLM→GPT。设计及实施状态见[自适应路由](../proposals/adaptive-model-routing.md)、[ORCH阶段](../work-items/milestones/ORCH.md)。

## 当前能力与过渡

route.py仍生成四路影子建议；controller CLI可对显式登记的GLM Direct和已设计合同执行任务，真实试点已完成（含人工接管），旧候选证明继续兼容原门禁。[独立verifier](verifier-usage.md)已接入固定配置、提交/字节绑定、日志校验和认证收据；run_glm的completed仍只表示执行完成。路由可消费有效收据决定修复或风险审查。ORCH-03提供显式执行闭环，ORCH-04增加受控分类门禁；具体行为见[测试门禁](testing.md)。

ORCH-03控制器、恢复入口及真实试点已完成本地验收，见[最终记录](../verification/2026-09/ORCH-03/final-report.md)。试点经历人工GPT Direct收尾，不能据此声称零干预。2026-09-25新增[会话中枢桥](codex-cli.md)：run_codex.py可程序化唤醒pinned的Codex会话续接同一对话（续接与缓存命中已实测，Desktop打开会话的写入者锁为硬约束），交互式强模型决策不再依赖人工搬运；GPT-WAKE-02后控制器在policy `gpt_dispatch=true`＋runner config gpt段双旗标齐备时自动派发gpt_direct/take_over到该会话，其余升级（plan_contract、缺oracle、scope扩大、保护测试变化）仍waiting_control；Scout的OS只读隔离仍未实现，需要该能力时保守交接。

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

## 回调驱动的GPT-GLM闭环

GLM完成、失败或需要重规划的回调是控制层事件，不是普通聊天答复。GPT每次收到回调时，必须重新阅读本文件、[控制循环](controller-loop.md)、当前任务卡、合同引用和[GLM失败模式账本](glm-failure-patterns.md)，再决定验收、限定返修或下一片派发。上下文压缩后也按同一顺序恢复，不能依赖上一轮对话记忆。

交接成功后，GPT立即结束本轮，不轮询GLM任务看板、不等待后台进程、不持续读取日志。Zcode原协调会话负责在完成、失败或需要裁决时回调。GPT只在收到新事件后独立核对真实diff、提交、测试、语义/UI证据和残余风险。

每次验收或返修都要把可复用的失败模式写入账本：`event_id`、任务/attempt、真实复现、失败指纹、根因、修复与验证、残余风险、下一次GLM应遵守的规则。保留首次失败和原始证据；不得用后续绿色结果覆盖历史。下一份GLM合同必须引用相关模式，并要求先复现已知RED，再实现GREEN。

GPT在这里承担教师职责：把反复出现的问题转成合同字段、回归测试、范围门禁和短提示，避免只在回调里口头提醒。相同失败指纹累计达到合同预算后，转GPT重新规划；不得靠延长等待、重复派发或扩大范围掩盖失败。GLM自报完成始终不是验收证据。

## 执行与配置边界

2026-09-25用户明确授权关闭Z code的Mimosa插件，已通过用户配置开关停用并留存备份。该授权不改变独立verifier、任务范围及预算；外部问题解除后的继续使用显式resume检查点，保留历史。处置证据见[Mimosa关闭与恢复](../verification/2026-09/ORCH-03/mimosa-resolution.md)。

- 保留独立worktree、基础SHA、allowed_paths、独立TRAINER_DB和端口；通达信只读。worker不push主干、不改个人库、不降低门禁。
- 从实际Git根启动Z code，Mimosa基线与任务根一致。同一拦截只交接一次，不使用--no-verify或其他绕过方式；集成人按已有授权审查。
- 保留GLM-5.3-Flash最高支持思考档和1M配置目标；配置不等于已实测容量，也不要求填满上下文。非图像理解的重活可显式`--model GLM-5.3`（同思考档与输出预算，白名单见run_glm.py，provider配置须匹配同一模型）；图像任务仍用Flash或人工。接口、输出额度及版本按[CLI经验](zcode-cli.md)核验，不编造参数。
- 并发按独立行为/文件所有权与账号额度管理，沿用已验证2～3路经验及runner最多4槽位。真实429/1302有限退避并下调并发，不自行降低思考档。
- 用[登记后台入口](../../scripts/agent-monitor/README.md)，看板显示Prompt、活动和结果；凭据由Z code登录存储使用，日志/provider副本在工程外。
- 长调用后台执行，按完成事件更新job；沿用已授权25分钟heartbeat续接，无独立工作不反复轮询。多任务用group索引，不共用wake-state；全部处理后停止续接自动化。
- 未验证强模型自动调用入口时明确waiting_control，不能把写交接文件说成GPT已接管。工程授权不包含发送无关个人文件到模型。
- 每次交接只发送一次合同；交接成功后结束GPT回合。不要用GLM任务看板作为等待机制。完成或失败回调到达后，按本页“回调驱动的GPT-GLM闭环”重读规则和失败账本。

历史参数和故障事实保留在CLI经验和验证记录；其中主代理固定承担全部实现/复跑的旧职责表述以本页为准，实际工具闸门按已实现版本执行。
