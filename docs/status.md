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
| [M3 · 图表工具链](<work-items/milestones/M3.md>) | closed | Stage feedback integrated; all engineering gates passed. / Accepted by user 2026-09-21; current work is REL-01 packaging and public release. | [证据1](<verification/2026-09/ACCEPT-01-release/report.md>) | [验收记录](<verification/2026-09/M3-user-acceptance/record.json>) |
| [M4 · 指标排行复盘](<work-items/milestones/M4.md>) | planned | 完整功能尚未实现。 / M3 acceptance recorded; packaging REL-01 is current priority. Resume this planned work afterward. | 未记录 | 未记录 |
| [M5 · 设置与交付](<work-items/milestones/M5.md>) | planned | 设置待做，先冻结规则和核查权益。 / M3 acceptance recorded; packaging REL-01 is current priority. Resume this planned work afterward. | 未记录 | 未记录 |
| [R1 · 本地数据更新与保护](<work-items/milestones/R1.md>) | active | 入口和首批保护已实现；完整发布、覆盖与历史版本仍有缺口。 / 先完成DATA-01/02，再补版本保护。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 |
| [R2 · 替代来源](<work-items/milestones/R2.md>) | planned | 扫描注册点已有，真实来源未接，训练读取未解耦。 / 先补DATA-03/04。 | 未记录 | 未记录 |
| [REC · 操作录制与回放](<work-items/milestones/REC.md>) | closed | Stage feedback integrated; all engineering gates passed. / Accepted by user 2026-09-21; current work is REL-01 packaging and public release. | [证据1](<verification/2026-09/ACCEPT-01-release/report.md>) | [验收记录](<verification/2026-09/M3-user-acceptance/record.json>) |
| [REL · M3 open-source distribution](<work-items/milestones/REL.md>) | closed | Package accepted trainer and publish usable open-source release. / Windows v0.3.1 and public source delivered; M4/M5 remain planned. | [证据1](<verification/2026-09/REL-01-release/report.md>)；[证据2](<verification/2026-09/REL-02/report.md>) | 未记录 |

### 未关闭任务

详细下一步沿任务链接读取。

| 任务 | 状态 / 负责人 | 摘要 | 验证记录 | 集成引用 | 用户验收记录 |
|---|---|---|---|---|---|
| [DATA-01](<work-items/tasks/DATA-01.md>) | review / GLM-5.3-Flash | 让目录、权息、文件状态和刷新结果按同一版本提交；失败和超时不能迟到写入。 | [证据1](<../server/test/data-refresh.test.ts>)；[证据2](<../server/test/catalog-protection.test.ts>)；[证据3](<../server/test/adjustment-cache.test.ts>)；[证据4](<../server/src/data/docs/publication.md>) | 未记录 | 未记录 |
| [DATA-02](<work-items/tasks/DATA-02.md>) | review / GLM-5.3-Flash | 用目标个股的实际日期覆盖判断训练能否推进或到期，区分停牌、非交易日、缺失和来源未就绪。 | [证据1](<../server/test/train-engine.test.ts>)；[证据2](<verification/2026-09/DATA-02-review.json>) | 未记录 | 未记录 |
| [DATA-03](<work-items/tasks/DATA-03.md>) | planned / unassigned | 元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-04](<work-items/tasks/DATA-04.md>) | planned / unassigned | DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M4-01](<work-items/tasks/M4-01.md>) | planned / unassigned | 基础账户和结算已有，完整指标、排行、成绩单与复盘待做。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M5-01](<work-items/tasks/M5-01.md>) | planned / unassigned | 设置页/API未开发，主题热键和确认可复用。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [R2-01](<work-items/tasks/R2-01.md>) | planned / unassigned | 尚未选定和接入真实在线行情来源。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [TRAIN-01](<work-items/tasks/TRAIN-01.md>) | planned / unassigned | 费用/T+1每笔读全局设置，raw显示路径不入账权息。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [UI-01](<work-items/tasks/UI-01.md>) | planned / unassigned | 08:00标签和数据尾空白尚待产品决定；多选价格轴缩放静态路径需核验。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
<!-- generated:status:end -->
