# ORCH-04 分类审查与效果对照实施计划

2026-09-25。承接用户已验收的ORCH-03，目标是减少不必要的强模型介入，同时保持提交、范围和验证证据约束。按本项目Worker Contract执行完整行为切片，首次实现保留worker判断空间；此计划不提供逐行代写指令。

## 固定质量约束

- 用户优先减少每次合格交付的强模型用量。无计量的数据为null；失败、修复、环境重试都进入同一逻辑运行，不挑选最便宜的成功结果。
- 机器验证先于语义/视觉判断。UI不能通过worker自报profile免检；未知风险保守使用完整门禁。保护策略、账户/数据语义及复杂新事实仍由强模型决策。
- 旧schemaVersion=1候选证明保持现有七项必需检查和manual-ui要求，不因新分类而获得豁免。新格式拒绝未知版本/策略、错误分类或缺失检查。
- Python独立收据继续保持原合同、认证和can_promote=false；它不冒充TypeScript candidate-proof。首版分类落在TS候选入口，无需改已验收的Python验证核心。
- 合入仍由显式promote命令及现有授权控制，不自动合并/推送。Mimosa保持用户指定的关闭状态。

## 切片A：分类候选门禁

范围：新增scripts/worktree/review-profile.ts，接入现有evidence.ts、workflow.ts、scripts/verify-candidate.ts、scripts/worktree.ts；回归在server/test/worktree-tools.test.ts、verification.test.ts及新的review-profile.test.ts。实际接口由实现者按现有代码确定，不改Candidate注册schema。

新schemaVersion=2 proof包含受控policyVersion、profile、实际变更路径指纹及visual要求。producer与consumer复用同一分类函数；consumer重新从candidate.baseCommit到candidate.commit观察Git，不相信proof自己给的路径或task卡新字段。删除/重命名不能漏掉原路径。空变化、未知路径、控制规则变化或不可确定来源均走full。

首版仅两类：

| profile | 资格 | 机器检查 | 视觉 |
|---|---|---|---|
| docs-only | 非空变化全为普通Markdown：docs下.md、根README.md/CONTRIBUTING.md；排除AGENTS/CLAUDE以及docs/engineering、specs、architecture | docs、impact、status（派生状态只校验，不修改） | 控制层记录not_applicable及原因 |
| full | 其余所有变更，包含UI、配置、代码及混合范围 | docs、impact、unit、types、build、snapshot、m2、journey | 必需manual-ui |

docs-only不接受可执行/链接文件、隐藏Git索引标志或由工作区伪装的路径。v2检查名称应与受控profile完全匹配；v1保留原有语义。docs-only不得启动产品服务器、读取TDX、构建前端或执行Journey。runManifest仍位于本次受控.runs中。baseline模式没有base/task时继续执行现有完整流程，不产生候选豁免。

promote的visual参数只对被重算确认为docs-only的v2证明可省略；v1、full、UI仍必需。任何来源/目标ref、commit/tree、工作树或分类绑定变化都拒绝复用证明。语义审查仍按风险和既有控制层升级规则进行；文档豁免只表示不需要产品视觉证据。

验收先覆盖：普通文档正例；UI/配置/混合修改伪装docs；删除/重命名/链接/隐藏标志；旧证明继续要求visual；未知版本和缺项/额外项；缺失/过期/越界视觉证据；source/target漂移；真实文档候选CLI只执行其固定检查。合成夹具中的promotion不得推进真实main。

## 切片B：离线效果对照

独立新增Python标准库evaluation_metrics.py、test_evaluation_metrics.py及模块说明。输入为固定experiment和完整逻辑run记录；角色映射、token口径及测量范围由experiment固定，worker不能在run里把强模型重标为弱模型。使用case/trial一对一配对，匹配输入指纹、case版本和oracle；重复键拒绝，缺配对或不兼容口径明确报告。

质量真值与系统outcome分开：系统accepted但真值failed应计为漏检，不能删除为“坏数据”。accepted却缺当前绑定的独立验证证据同样是质量违规。只有accepted、质量passed、证据绑定成立才计入合格交付。统计全部运行成本与失败数；成功子集差值必须注明条件性，不用于隐藏失败成本。

验证收据ID与逻辑运行ID分别保留，不要求二者相等；空策略没有测量样本，不记作已知零成本。两策略各至少一项合格交付、计量已知且口径可比，才允许总体节省对照。不同口径或来源的记录保留，但受影响的聚合与单位交付成本为null。

计数拒绝bool/负值；时长拒绝非有限值；缓存输入只能作为总输入的一部分，不能再次相加。未知token、介入次数或时间保留null。缺失测量或质量约束未满足时不给总体节省结论；不估计账单价格，不宣称统计显著。当前ORCH-03数据只有GLM provider计数，强模型用量未知，示例应如实输出不可量化节省。

对照夹具先固定正常配对、未配对、重复试验、版本/oracle/输入变化、不同测量口径、失败成本、错误放行、错误拒绝、未知计量、缓存口径和非法数值。此工具用于描述和比较，不签发收据、调模型或推进Git。

## 实施顺序与验证

- [x] 记录用户验收，建立隔离工作树；旧TS门禁38项基线通过。
- [x] GLM侦查；17条事实中14条散列绑定，3条未绑定保留为线索。依赖由控制者随后安装，不沿用其“未安装”时间性结论。
- [x] GLM分别实现A与B的测试、代码及模块说明，文件所有权不相交；各自先有效RED再GREEN。
- [x] 控制者从diff及具体风险复验，检查真实docs-only候选CLI；内部TS门禁变化完成适用类型/构建和基线门禁。
- [x] 用固定对照夹具与已有真实记录运行离线报告；没有匹配的GPT基线时明确未知，不声称已减少成本。
- [x] 同步AGENTS/测试/并行开发协议、任务状态及证据，保留所有失败；本批完成后停止续接。

来源：GLM侦查原件及逐事实散列审计存控制层ORCH-04-scout-report.json/ORCH-04-scout-fact-audit.json。现有流程见[并行开发](parallel-development.md)、[测试协议](testing.md)；候选代码入口[proof与visual](../../scripts/worktree/evidence.ts)，相关模型边界见[协作协议](model-delegation.md)。

完成证据：[ORCH-04本地验收](../verification/2026-09/ORCH-04/final-report.md)。效果对照只报告已知数据，未声称模型成本收益。
