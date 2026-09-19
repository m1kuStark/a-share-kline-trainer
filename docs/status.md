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
| [M3 · 图表工具链](<work-items/milestones/M3.md>) | review | 图表工具链待本轮用户返修验收。 / ACCEPT-01通过后收取用户最终决定。 | [证据1](<verification/2026-09/REC-01-stage-release/report.md>) | 未记录 |
| [M4 · 指标排行复盘](<work-items/milestones/M4.md>) | planned | 完整功能尚未实现。 / 等待用户明确验收本次阶段版本；验收记录落库前不得开始本阶段开发。 | 未记录 | 未记录 |
| [M5 · 设置与交付](<work-items/milestones/M5.md>) | planned | 设置待做，先冻结规则和核查权益。 / 等待用户明确验收本次阶段版本；验收记录落库前不得开始本阶段开发。 | 未记录 | 未记录 |
| [R1 · 本地数据更新与保护](<work-items/milestones/R1.md>) | active | 入口和首批保护已实现；完整发布、覆盖与历史版本仍有缺口。 / 先完成DATA-01/02，再补版本保护。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 |
| [R2 · 替代来源](<work-items/milestones/R2.md>) | planned | 扫描注册点已有，真实来源未接，训练读取未解耦。 / 先补DATA-03/04。 | 未记录 | 未记录 |
| [REC · 操作录制与回放](<work-items/milestones/REC.md>) | active | 用户反馈画线漂移及录制/回放交互需返修。 / 完成ACCEPT-01后重新交用户验收。 | [证据1](<verification/2026-09/REC-01-stage-release/report.md>) | 未记录 |

### 未关闭任务

| 任务 | 状态 / 负责人 | 摘要 / 下一步 | 验证记录 | 集成引用 | 用户验收记录 |
|---|---|---|---|---|---|
| [ACCEPT-01](<work-items/tasks/ACCEPT-01.md>) | active / integrator | 阶段验收反馈集成 / 完整候选验收后交用户。 | [证据1](<verification/2026-09/ACCEPT-01-review/report.md>) | 未记录 | 未记录 |
| [ACCEPT-E2E](<work-items/tasks/ACCEPT-E2E.md>) | review / GLM-5.3-Flash | 既有回归适配已合入。 / 执行精确候选验收。 | 未记录 | de88fac | 未记录 |
| [DATA-01](<work-items/tasks/DATA-01.md>) | planned / unassigned | 目录、权息和快照各自提交；catalog失败结果未统一拦截。 / 复现目录已改后权息失败、超时迟到提交；所有已发布表保持同一版本。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-02](<work-items/tasks/DATA-02.md>) | planned / unassigned | 全市场末日及单一源尾不能证明个股区间无漏数。 / 加入他股更新但目标漏数、结束日后有记录但中间漏数样例；未知保持running。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-03](<work-items/tasks/DATA-03.md>) | planned / unassigned | 元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。 / 建立迁移时基线与旧版读取；无法恢复时明确阻断，不改旧流水。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-04](<work-items/tasks/DATA-04.md>) | planned / unassigned | DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。 / 统一bars/actions/coverage/version读取；用非TDX夹具运行训练，再接真实来源。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DRAW-02](<work-items/tasks/DRAW-02.md>) | review / GLM-5.3-Flash | 价格基准修复已合入ACCEPT-01。 / 等待集成分支完整候选验收。 | [证据1](<../server/test/drawing-price-basis.test.ts>)；[证据2](<../server/test/drawings.test.ts>)；[证据3](<../server/test/drawing-state.test.ts>)；[证据4](<../web/src/components/docs/drawing-persistence.md>) | 3a3421f | 未记录 |
| [M4-01](<work-items/tasks/M4-01.md>) | planned / unassigned | 基础账户和结算已有，完整指标、排行、成绩单与复盘待做。 / 等待用户明确验收本次阶段版本后再推进；先固定部分平仓、零交易、费用权息、稳定排序和防未来样例。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M5-01](<work-items/tasks/M5-01.md>) | planned / unassigned | 设置页/API未开发，主题热键和确认可复用。 / 等待用户明确验收本次阶段版本后再推进；完成TRAIN-01后开发默认设置、首次使用及全链路交付。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [R2-01](<work-items/tasks/R2-01.md>) | planned / unassigned | 尚未选定和接入真实在线行情来源。 / DATA-03/04后选择来源，验证无TDX环境及单位、覆盖、权息合约。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [REC-01](<work-items/tasks/REC-01.md>) | review / integrator | 紧凑录制已集成，用户返修见ACCEPT-01。 / 等待本轮返修及用户最终验收。 | [证据1](<verification/2026-09/REC-01-stage-release/report.md>) | 35a1671804bfe7ec17cd66a8a8295ee8991933e0 | 未记录 |
| [REC-02](<work-items/tasks/REC-02.md>) | review / GLM-5.3-Flash | 录制保存/丢弃与业务筛选已合入ACCEPT-01。 / 等待集成分支完整候选验收。 | 未记录 | 4e8eae0 | 未记录 |
| [REC-03](<work-items/tasks/REC-03.md>) | review / GLM-5.3-Flash | Day replay integrated; full gate pending. / Verify legacy and two-year recordings. | [证据1](<verification/2026-09/ACCEPT-01-night/report.md>) | d5cf35a | 未记录 |
| [TRAIN-01](<work-items/tasks/TRAIN-01.md>) | planned / unassigned | 费用/T+1每笔读全局设置，raw显示路径不入账权息。 / 等待用户明确验收本次阶段版本后再推进；默认设置变化不改旧训练；raw/forward账户权益一致，兼容旧数据。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [UI-01](<work-items/tasks/UI-01.md>) | planned / unassigned | 08:00标签和数据尾空白尚待产品决定；多选价格轴缩放静态路径需核验。 / 等待用户明确验收本次阶段版本后再推进；先用真实手势复核Ctrl/多选轴区域，再确定修复；不把静态推断当已证实故障。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
<!-- generated:status:end -->
