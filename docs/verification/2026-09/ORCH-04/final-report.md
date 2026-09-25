# ORCH-04 本地工程验收

2026-09-25。分类候选门禁与离线效果对照已实现、集成并完成本地验证。工程任务进入review，待用户验收；未合并或推送真实main。

## 交付行为

- 新v2候选证明由控制代码重算实际Git变更：只有明确的普通Markdown变更可走docs-only并标视觉不适用，执行docs/impact/status三项。UI、配置、代码、控制规则、混合及未知变更均保留full。
- 新证明绑定task/base/commit/tree、策略版本、变更集指纹、固定检查集及前后清洁状态；清单必须真实存在于候选.runs。符号链接/目录联接、隐藏索引标志与删除/重命名都已有回归。旧v1保留原七项检查及manual-ui要求，不能借新分类自行免检。
- 离线对照按完整逻辑运行统计失败和返工，区分系统放行与独立质量真值。缺计量、缺匹配baseline或口径不可比时保留null；不估价、不签收据、不推进Git。不同命名空间的逻辑运行ID与验证ID分别保留。

## 最终提交与验证

最终运行代码提交 **3623256bdd93ec94f133f26162ac1d841af769b5**，基线a3b140c。GATES代码78758cc，METRICS原提交67034ad在集成分支为bdaf946；其余工程文档提交e62386c。后续只含验收文档的提交继承此运行结果，不冒称新HEAD已经重新跑过运行门禁。

| 检查 | 实际结果 |
|---|---|
| 最终 `verify:candidate --base a3b140c… --task ORCH-04` | 退出0；docs、impact、unit、types、build、snapshot、m2、journey八项全通过 |
| TypeScript单测 | 66个文件，882/882通过，含分类门禁62项定向覆盖；未报告跳过 |
| 严格脚本类型检查 | ES2022/NodeNext、strict、noEmit，涉及五个控制脚本；退出0 |
| M2样本闭环 | 24项通过，0失败 |
| Edge浏览器旅程 | 72/72通过，0失败、0跳过 |
| Python离线对照 | 46/46通过，0跳过；集成后再次定向通过 |
| 独立普通文档CLI | 真实producer退出0、assertProof消费退出0；只有docs/impact/status日志，无产品构建/M2/服务器/Journey产物 |

最终完整run为run-0dca5120-0290-4940-8e53-9f885def04c7，22:00:24 UTC结束；受控进程组返回exit0、cleanup_confirmed=true。当前干净HEAD的证明经assertProof独立再消费，profile=full、visual=required。可分享审计投影见[full-proof-audit.json](full-proof-audit.json)，包含精确提交、tree、检查、数据指纹和日志散列；原始证明与所有运行产物保留隔离工作树.runs。没有执行promote，也没有把自动浏览器测试称作新增人工产品视觉验收。

文档CLI试点使用独立临时Git夹具，最终源码与消费方来自3623256；证据见[docs-only-proof-audit.json](docs-only-proof-audit.json)。夹具复用node_modules联接这一事实已注明，不代表产品候选依赖隔离已被豁免。夹具main保持原基线，未推进任何真实分支。

M2/Journey读取已有冻结TDX样本再复制到本次run，截止2026-09-16、三只股票/指数；数据库隔离，没有改写个人训练库或通达信。未改行情解析/复权，因此本批未额外运行实源M1。产品界面未改动。

## 首次失败与修复保留

GATES首包35分钟超时；独立56项中1个旧门禁失败，复现缺失/越界runManifest仍被接受及Windows junction错误豁免。定向repair25分钟再次超时，但修复产物在主代理进程中62/62通过；其超时后sidecar的17项失败主要为npm子进程启动3221225794，未在独立复跑中出现。两次原runner状态未改写成completed。详情见[门禁首轮](gates-review.md)。

METRICS首轮38项通过但实际记录错误stale_binding、空策略零成本、未知计量仍valid、混合口径汇总及零交付-100%等反例失败。GLM修复到44项；主代理追加统一错误口径/错误scope汇总的2项RED回归并修正，最终46项通过，见[指标验收](metrics-acceptance.md)。

首轮完整候选e62386c也曾通过全部机器门禁，但额外严格脚本检查发现一处string|null类型未收窄。修正后提交3623256，严格检查通过，并完整重跑以取得与最终代码绑定的新证明。没有借旧证明冒充新提交。

## 效果结论与边界

[observed-report.json](observed-report.json)读取未经调整的ORCH-03真实记录：合格交付1项、质量违规0；两次GLM合计1,350,162个输入+输出token（缓存不重复相加）。强模型用量、完整时长和配对baseline未知，因此总体对照无效、节省为null。合成回归验证比较规则，不是实测成本收益。

这轮多数实现与定向修复由GLM完成，控制者做合同、反例、两处指标边界和一处类型收尾。真实token证据见[worker-usage.json](worker-usage.json)；超时批次缺完整provider用量，不能补零或宣称总成本节省。Git候选证明与Python认证收据保持不同格式；GPT自动adapter、Scout OS只读沙盒、自动合入/发布均未实现。

任务与文档同步后停止本批续接。下一步由用户验收ORCH-04，再把这套流程用于产品任务并持续收集有匹配基线的用量；现有K线时钟/笔记/条件单任务不因工程工具完成而自动算已实现。

## 工作区同步结果

最终运行代码与验收记录已同步当前工作区，共30个文件；写入前核对当前字节散列，保留备份。AGENTS及测试/并行开发文档采用三方合并保留原改动，四个本批过程文档确认与已知e62386c检查点一致后更新；其余新增或基线一致文件按审查版本回写。当前工作区代码字节与验收分支一致，原有其他改动未覆盖，main没有移动或推送。

同步后docs:check退出0（10项篇幅提示、无错误），docs:status --check及五个脚本的strict类型检查退出0。隔离验收分支的文档检查与impact退出0。原始证明仍绑定3623256；后续文档证据提交72ab2cc及同步记录提交不改变运行源码。ORCH-04与ORCH阶段标为review，用户验收尚未记录，本批自动续接已请求暂停。
