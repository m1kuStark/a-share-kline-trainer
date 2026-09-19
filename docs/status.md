# 当前开发状态

本页从[任务和阶段卡](work-items/README.md)生成；不要手改生成区。实现、自测、集成和用户验收是不同事实，证据必须匹配提交/数据范围。整体目录由[文档索引](README.md)导航。

<!-- generated:status:start -->
本区由任务卡与阶段卡生成；工作状态不代表已集成或用户已验收。

### 阶段

| 阶段 | 状态 | 摘要 / 下一步 | 验证记录 | 用户验收记录 |
|---|---|---|---|---|
| [BASE · M0/M1/M2](<work-items/milestones/BASE.md>) | closed | 已有用户验收记录，M2冻结提交12cba72；历史验收不等于今日数据对照。 / 保持回归，不重新解释既有用户结论。 | [docs/archive/2026-09/ai-changelog.md](<archive/2026-09/ai-changelog.md>) | 未记录 |
| [DEV · 并行开发基础设施](<work-items/milestones/DEV.md>) | closed | 本地并行开发与串行候选集成可用；未配置远端保护或自动push。 / 按任务所有权和候选流程接续开发。 | [docs/verification/2026-09/DEV-01-parallel/report.md](<verification/2026-09/DEV-01-parallel/report.md>) | 未记录 |
| [DOC · 文档架构基线](<work-items/milestones/DOC.md>) | closed | 设计已获用户确认，实施分层文档与检查工具。 / 以本提交为后续开发文档基线；业务架构任务按各自任务卡推进。 | 未记录 | [docs/verification/2026-09/DOC-design-acceptance/record.json](<verification/2026-09/DOC-design-acceptance/record.json>) |
| [M3 · 图表工具链](<work-items/milestones/M3.md>) | review | 23工具和多轮修复已有工程验证，最终用户验收/冻结未记录。 / 汇总用户最终整体意见。 | [docs/verification/M3-成本线与副图拖拽验收-2026-09-13.md](<verification/M3-成本线与副图拖拽验收-2026-09-13.md>) | 未记录 |
| [M4 · 指标排行复盘](<work-items/milestones/M4.md>) | planned | 完整功能尚未实现。 / 固定数值和生命周期边界。 | 未记录 | 未记录 |
| [M5 · 设置与交付](<work-items/milestones/M5.md>) | planned | 设置待做，先冻结规则和核查权益。 / 完成TRAIN-01。 | 未记录 | 未记录 |
| [R1 · 本地数据更新与保护](<work-items/milestones/R1.md>) | active | 入口和首批保护已实现；完整发布、覆盖与历史版本仍有缺口。 / 先完成DATA-01/02，再补版本保护。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 |
| [R2 · 替代来源](<work-items/milestones/R2.md>) | planned | 扫描注册点已有，真实来源未接，训练读取未解耦。 / 先补DATA-03/04。 | 未记录 | 未记录 |
| [REC · 操作录制与回放](<work-items/milestones/REC.md>) | planned | 用户要求默认开启、可暂停和分享；本轮仅完成方案讨论。 / 确认首批格式与范围后实施REC-01。 | 未记录 | 未记录 |

### 未关闭任务

| 任务 | 状态 / 负责人 | 摘要 / 下一步 | 验证记录 | 集成引用 | 用户验收记录 |
|---|---|---|---|---|---|
| [DATA-01 · 数据整批发布与超时屏障](<work-items/tasks/DATA-01.md>) | planned / unassigned | 目录、权息和快照各自提交；catalog失败结果未统一拦截。 / 复现目录已改后权息失败、超时迟到提交；所有已发布表保持同一版本。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-02 · 个股覆盖与到期结算](<work-items/tasks/DATA-02.md>) | planned / unassigned | 全市场末日及单一源尾不能证明个股区间无漏数。 / 加入他股更新但目标漏数、结束日后有记录但中间漏数样例；未知保持running。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-03 · 可读取的历史版本保护](<work-items/tasks/DATA-03.md>) | planned / unassigned | 元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。 / 建立迁移时基线与旧版读取；无法恢复时明确阻断，不改旧流水。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-04 · 统一行情读取与更新入口](<work-items/tasks/DATA-04.md>) | planned / unassigned | DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。 / 统一bars/actions/coverage/version读取；用非TDX夹具运行训练，再接真实来源。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M4-01 · 指标排行与复盘](<work-items/tasks/M4-01.md>) | planned / unassigned | 基础账户和结算已有，完整指标、排行、成绩单与复盘待做。 / 先固定部分平仓、零交易、费用权息、稳定排序和防未来样例。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M5-01 · 设置与完整交付](<work-items/tasks/M5-01.md>) | planned / unassigned | 设置页/API未开发，主题热键和确认可复用。 / 完成TRAIN-01后开发默认设置、首次使用及全链路交付。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [R2-01 · 真实替代来源](<work-items/tasks/R2-01.md>) | planned / unassigned | 尚未选定和接入真实在线行情来源。 / DATA-03/04后选择来源，验证无TDX环境及单位、覆盖、权息合约。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [REC-01 · 默认操作录制与分享复盘首批](<work-items/tasks/REC-01.md>) | active / integrator | GLM分块开发默认录制、分享导入与只读回放；主代理调度及验收。 / 存储修复已合入；修复回放缺口提示并验收真实旅程。自动停录已撤回，先据两年容量测量评估存储表示方案。 | [docs/verification/2026-09/REC-01-capacity/report.md](<verification/2026-09/REC-01-capacity/report.md>) | 未记录 | 未记录 |
| [TRAIN-01 · 冻结训练规则并统一权息入账](<work-items/tasks/TRAIN-01.md>) | planned / unassigned | 费用/T+1每笔读全局设置，raw显示路径不入账权息。 / 默认设置变化不改旧训练；raw/forward账户权益一致，兼容旧数据。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [UI-01 · 待复核交互与体验边界](<work-items/tasks/UI-01.md>) | planned / unassigned | 08:00标签和数据尾空白尚待产品决定；多选价格轴缩放静态路径需核验。 / 先用真实手势复核Ctrl/多选轴区域，再确定修复；不把静态推断当已证实故障。 | [docs/verification/architecture-audit-2026-09-17.json](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
<!-- generated:status:end -->
