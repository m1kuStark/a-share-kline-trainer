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
| [M3 · 图表工具链](<work-items/milestones/M3.md>) | closed | Stage feedback integrated; all engineering gates passed. / 已获用户验收（2026-09-21），能力随v0.3.1首次发布并随v0.3.2继续交付；无未结工作。 | [证据1](<verification/2026-09/ACCEPT-01-release/report.md>) | [验收记录](<verification/2026-09/M3-user-acceptance/record.json>) |
| [M4 · 指标排行复盘](<work-items/milestones/M4.md>) | planned | 完整功能尚未实现。 / 首次接入与首页反馈按first-use-batch前置；DATA-03/04仍待处理，M4实施前按roadmap固定样例冻结指标口径。 | 未记录 | 未记录 |
| [M5 · 设置与交付](<work-items/milestones/M5.md>) | planned | 设置待做，先冻结规则和核查权益。 / 首次接入和首页反馈前置，并在REL-LAUNCH-UX-01补正常退出与最后标签回收评估；完整设置仍待TRAIN-01规则快照。 | 未记录 | 未记录 |
| [ORCH · 自适应强弱模型协作](<work-items/milestones/ORCH.md>) | closed | 用户已验收现有协作工程：路由建议、GLM执行闭环、独立验证与分类候选门禁；自动GPT/Scout OS隔离及成本收益仍保留能力边界。 / 回到产品开发：优先完成首次接入/新鲜度/训练范围接线，再按V4依赖推进时钟、笔记与条件单。 | [证据1](<verification/2026-09/ORCH-03/final-report.md>)；[证据2](<verification/2026-09/ORCH-04/final-report.md>) | [验收记录](<verification/2026-09/ORCH-04/user-acceptance.md>) |
| [R1 · 本地数据更新与保护](<work-items/milestones/R1.md>) | active | DATA-01/02批次已合入并通过自动门禁；DATA-03历史版本保护尚未完成。 / 先修DATA-05盘后新鲜度误判；DATA-03及DATA-04仍需补齐历史版本和统一读取，不能把旧批次通过等同R1结束。 | [证据1](<verification/architecture-audit-2026-09-17.json>)；[证据2](<verification/2026-09/R1-data-integrity/report.json>) | 未记录 |
| [R2 · 替代来源](<work-items/milestones/R2.md>) | planned | 扫描注册点已有，真实来源未接，训练读取未解耦。 / 先补DATA-03/04。 | 未记录 | 未记录 |
| [REC · 操作录制与回放](<work-items/milestones/REC.md>) | closed | Stage feedback integrated; all engineering gates passed. / 已获用户验收（2026-09-21），能力随v0.3.1首次发布并随v0.3.2继续交付；无未结工作。 | [证据1](<verification/2026-09/ACCEPT-01-release/report.md>) | [验收记录](<verification/2026-09/M3-user-acceptance/record.json>) |
| [REL · v0.3.2 open-source distribution](<work-items/milestones/REL.md>) | closed | Package accepted trainer and publish usable open-source release. / v0.3.2公开源码与Windows安装包已交付；用户最终验收尚未记录；M4/M5仍按任务卡推进。 | [证据1](<verification/2026-09/REL-01-release/report.md>)；[证据2](<verification/2026-09/REL-02/report.md>)；[证据3](<verification/2026-09/REL-03/public-release-verification.json>)；[证据4](<verification/2026-09/REL-03/module-acceptance.json>) | 未记录 |
| [V4 · v0.4 训练时钟、条件单与成交理由](<work-items/milestones/V4.md>) | planned | 默认保持 close_only，用户可选 open_close；加入单价格条件单、可回放的成交理由和 B/S 笔记。 / 先冻结阶段、撮合、跳空、T+1/资金不足和录制兼容规则，再按任务依赖实现。 | 未记录 | 未记录 |

### 未关闭任务

详细下一步沿任务链接读取。

| 任务 | 状态 / 负责人 | 摘要 | 验证记录 | 集成引用 | 用户验收记录 |
|---|---|---|---|---|---|
| [DATA-03](<work-items/tasks/DATA-03.md>) | planned / unassigned | 元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-04](<work-items/tasks/DATA-04.md>) | planned / unassigned | DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [DATA-05](<work-items/tasks/DATA-05.md>) | review / GLM-5.3-Flash | DATA-05 freshness coordinator, offline SSE 2026 calendar, home status, poll ordering and unreadable-source downgrade are present in the isolated integration candidate. | [证据1](<verification/2026-09/DATA-05/calendar-source.json>) | integration/product-integration-20260926 | 未记录 |
| [GLM-MONITOR-02](<work-items/tasks/GLM-MONITOR-02.md>) | review / integrator | CLI native usage and official quota dashboard installed; 78 Python and 13 browser fixture checks plus live verification passed. | [证据1](<verification/2026-09/GLM-MONITOR-02.md>) | 未记录 | 未记录 |
| [GPT-VIS-01](<work-items/tasks/GPT-VIS-01.md>) | review / integrator | 调研完成：写入者锁为共享存储层单一写者约束，对 app-server 协议与 CLI 一致生效——'注入 Desktop 正打开的会话且实时可见'不可行；App-Server 的增量价值为流式增量、turn/steer/interrupt、审批回调客户端化，定位为 run_codex 的下一代传输层候选。 | [证据1](<verification/2026-09/GPT-VIS-01/report.md>) | 未记录 | 未记录 |
| [M4-01](<work-items/tasks/M4-01.md>) | planned / unassigned | 基础账户和结算已有，完整指标、排行、成绩单与复盘待做。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [M5-01](<work-items/tasks/M5-01.md>) | planned / unassigned | 设置页/API未开发，主题热键和确认可复用。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [NOTE-01](<work-items/tasks/NOTE-01.md>) | planned / integrator | 在图表下方 B/S 标记上提供交易理由入口，并支持悬停详情和固定浮层。 | 未记录 | 未记录 | 未记录 |
| [ORDER-00](<work-items/tasks/ORDER-00.md>) | planned / integrator | 核查 GitHub 开源条件单实现的许可证、撮合假设和数据模型，只提取适合日线训练器的可验证做法。 | 未记录 | 未记录 | 未记录 |
| [ORDER-01](<work-items/tasks/ORDER-01.md>) | planned / integrator | 实现单有效订单、限价/止损四种价格行为、跳空成交、取消过期和拒单记录。 | 未记录 | 未记录 | 未记录 |
| [R2-01](<work-items/tasks/R2-01.md>) | planned / unassigned | 尚未选定和接入真实在线行情来源。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [REC-04](<work-items/tasks/REC-04.md>) | planned / integrator | 为手动成交和条件单增加可选理由，并在录制、导入和回放中保留阶段、模式与订单事件顺序。 | 未记录 | 未记录 | 未记录 |
| [REL-LAUNCH-UX-01](<work-items/tasks/REL-LAUNCH-UX-01.md>) | active / integrator | 发布包服务当前独立于浏览器运行；为新手提供保存完成后可用的“退出训练器”入口，同时保留安全的Stop.cmd兜底。 | [证据1](<verification/2026-09/LAUNCH-UX-01/report.md>) | 未记录 | 未记录 |
| [SETUP-01](<work-items/tasks/SETUP-01.md>) | active / integrator | 用户已接受接入方案；自动发现、确认、原生选目录及保存生效待实施，并需移除开发者电脑路径泄露。 | 未记录 | 未记录 | [验收记录](<verification/2026-09/SETUP-design-acceptance/record.json>) |
| [SETUP-AUTH-01](<work-items/tasks/SETUP-AUTH-01.md>) | review / integrator | control-guard.ts 纯函数 validateSetupRequest：Host 逐字、Origin 逐字＋Fetch Metadata same-origin 浏览器路径（不要求暴露令牌）、无 Origin 助手路径（非空 expectedToken＋controlToken 逐字）、混合身份令牌必须匹配；拒绝码 HOST_MISMATCH/ORIGIN_MISMATCH/FETCH_METADATA_MISMATCH/TOKEN_MISSING/TOKEN_INVALID/TOKEN_UNCONFIGURED（401/403 结构化）。测试 15/15，纯函数零环境/网络/文件读取，不打印令牌。 | 未记录 | 未记录 | 未记录 |
| [SETUP-CLUES-01](<work-items/tasks/SETUP-CLUES-01.md>) | review / integrator | process-clues.ts 提取运行中通达信安装根目录线索，保留五态结果、固定 PowerShell 白名单、-First 8、UTF-8 字节上限和跨块中文路径安全；52 项定向测试通过。 | [证据1](<../server/test/process-clues.test.ts>)；[证据2](<../server/test/discover.test.ts>)；[证据3](<../server/test/tdx-inspect.test.ts>) | integration/product-integration-20260926 | 未记录 |
| [SETUP-CLUES-02](<work-items/tasks/SETUP-CLUES-02.md>) | review / integrator | candidate-diagnostics.ts 把 process-clues 结果与 inspectTdxCandidates 组合成诊断数组：running-process+manual 双来源、首次出现顺序、Windows 大小写不敏感去重、单次 inspect、返回顺序与 inspect 一致、五态与 reason 原样透传。测试 9/9（注入 stub），零真实 TDX/进程读取。 | 未记录 | 未记录 | 未记录 |
| [TRAIN-01](<work-items/tasks/TRAIN-01.md>) | planned / unassigned | 费用/T+1每笔读全局设置，raw显示路径不入账权息。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [TRAIN-02](<work-items/tasks/TRAIN-02.md>) | review / integrator | 按周期回推默认起始日，增加到最新日线与自定义日K根数，创建前明确覆盖和不足原因。 | [证据1](<verification/2026-09/START-01/report.md>) | integration/product-integration-20260926 | 未记录 |
| [TRAIN-03](<work-items/tasks/TRAIN-03.md>) | planned / integrator | 保留默认 close_only 收盘模式，并为显式开启的训练增加 open/close 阶段、形成中 K 线和旧训练迁移。 | 未记录 | 未记录 | 未记录 |
| [UI-01](<work-items/tasks/UI-01.md>) | planned / unassigned | 08:00标签和数据尾空白尚待产品决定；多选价格轴缩放静态路径需核验。 | [证据1](<verification/architecture-audit-2026-09-17.json>) | 未记录 | 未记录 |
| [UI-02](<work-items/tasks/UI-02.md>) | review / integrator | 按用户要求移除首页顶部录像横栏，保留左侧录像导航及录像页导入、历史和回放。 | [证据1](<verification/2026-09/REL-03/ui-02-journey.json>)；[证据2](<verification/2026-09/REL-03/recording-daily-journey.json>)；[证据3](<../e2e/acceptance-feedback.spec.ts>)；[证据4](<../e2e/recording-migration.spec.ts>)；[证据5](<../e2e/recording-daily.spec.ts>) | c8f8836 | 未记录 |
| [V4-01](<work-items/tasks/V4-01.md>) | planned / integrator | 串行集成阶段时钟、理由录制、B/S 笔记和条件单，完成真实训练、回放和旧数据兼容验收。 | 未记录 | 未记录 | 未记录 |
<!-- generated:status:end -->
