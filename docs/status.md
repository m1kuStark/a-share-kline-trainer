# 当前开发状态

本页从[任务和阶段卡](work-items/README.md)生成；不要手改生成区。实现、自测、集成和用户验收是不同事实，证据必须匹配提交/数据范围。整体目录由[文档索引](README.md)导航。

<!-- generated:status:start -->
本区由任务卡与阶段卡生成；工作状态不代表已集成或用户已验收。

### 阶段

| 阶段 | 状态 | 摘要 / 下一步 | 验证记录 | 用户验收记录 |
|---|---|---|---|---|
| [BASE · M0/M1/M2](<work-items/milestones/BASE.md>) | closed | 已有用户验收记录，M2冻结提交12cba72；历史验收不等于今日数据对照。 / 保持回归，不重新解释既有用户结论。 | [证据1](<archive/2026-09/ai-changelog.md>) | 未记录 |
| [DEV · 并行开发基础设施](<work-items/milestones/DEV.md>) | closed | 本地并行开发与串行候选集成可用；未配置远端保护或自动push。 / 按任务所有权和候选流程接续开发。 | [证据1](<verification/2026-09/DEV-01-parallel/report.md>) | 未记录 |
| [DOC · 文档架构基线](<work-items/milestones/DOC.md>) | closed | 设计已获用户确认，实施分层文档与检查工具。 / 以本提交为后续开发文档基线；业务架构任务按各自任务卡推进。 | 未记录 | [验收记录](<verification/2026-09/DOC-design-acceptance/record.json>) |
| [M3 · 图表工具链](<work-items/milestones/M3.md>) | closed | Stage feedback integrated; all engineering gates passed. / 已获用户验收（2026-09-21），能力随v0.3.1发布交付；无未结工作。 | [证据1](<verification/2026-09/ACCEPT-01-release/report.md>) | [验收记录](<verification/2026-09/M3-user-acceptance/record.json>) |
| [M4 · 指标排行复盘](<work-items/milestones/M4.md>) | planned | 完整功能尚未实现。 / DATA-01/02批次已完成；DATA-03/04仍待处理。M4实施前先按roadmap固定样例冻结指标口径；首次接入改进建议见SETUP-01。 | 未记录 | 未记录 |
| [M5 · 设置与交付](<work-items/milestones/M5.md>) | planned | 设置待做，先冻结规则和核查权益。 / 完整设置仍待TRAIN-01规则快照；建议单独前置SETUP-01首次接入，先评审方案，不捆绑完整M5。 | 未记录 | 未记录 |
| [R1 · 本地数据更新与保护](<work-items/milestones/R1.md>) | active | DATA-01/02批次已合入并通过自动门禁；DATA-03历史版本保护尚未完成。 / 保持已验证批次；按DATA-03及DATA-04补齐历史版本和统一读取，不能把本批通过等同整个R1结束。 | [证据1](<verification/architecture-audit-2026-09-17.json>)；[证据2](<verification/2026-09/R1-data-integrity/report.json>) | 未记录 |
| [R2 · 替代来源](<work-items/milestones/R2.md>) | planned | 扫描注册点已有，真实来源未接，训练读取未解耦。 / 先补DATA-03/04。 | 未记录 | 未记录 |
| [REC · 操作录制与回放](<work-items/milestones/REC.md>) | closed | Stage feedback integrated; all engineering gates passed. / 已获用户验收（2026-09-21），能力随v0.3.1发布交付；无未结工作。 | [证据1](<verification/2026-09/ACCEPT-01-release/report.md>) | [验收记录](<verification/2026-09/M3-user-acceptance/record.json>) |
| [REL · M3 open-source distribution](<work-items/milestones/REL.md>) | closed | Package accepted trainer and publish usable open-source release. / Windows v0.3.1 and public source delivered; M4/M5 remain planned. | [证据1](<verification/2026-09/REL-01-release/report.md>)；[证据2](<verification/2026-09/REL-02/report.md>) | 未记录 |

### 未关闭任务

详细下一步沿任务链接读取。

| 任务 | 状态 / 负责人 | 摘要 | 验证记录 | 集成引用 | 用户验收记录 |
|---|---|---|---|---|---|
| [DATA-03](<work-items/tasks/DATA-03.md>) | planned / unassigned | 元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-04](<work-items/tasks/DATA-04.md>) | planned / unassigned | DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M4-01](<work-items/tasks/M4-01.md>) | planned / unassigned | 基础账户和结算已有，完整指标、排行、成绩单与复盘待做。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M5-01](<work-items/tasks/M5-01.md>) | planned / unassigned | 设置页/API未开发，主题热键和确认可复用。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [R2-01](<work-items/tasks/R2-01.md>) | planned / unassigned | 尚未选定和接入真实在线行情来源。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [SETUP-01](<work-items/tasks/SETUP-01.md>) | planned / unassigned | 建议将首次接入从完整设置阶段前置；自动发现、原生选目录、保存验证免手写JSON。 | 未记录 | 未记录 | 未记录 |
| [TRAIN-01](<work-items/tasks/TRAIN-01.md>) | planned / unassigned | 费用/T+1每笔读全局设置，raw显示路径不入账权息。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [UI-01](<work-items/tasks/UI-01.md>) | planned / unassigned | 08:00标签和数据尾空白尚待产品决定；多选价格轴缩放静态路径需核验。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
<!-- generated:status:end -->
