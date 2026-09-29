# 验证与验收证据

最新交付：[v0.3.1发布验收](2026-09/REL-02/report.md)，含完整门禁、双平台CI、真实安装包、桌面升级和公开下载核验。

新记录按`YYYY-MM/任务ID-时间或短标识/`组织；一个run记录一个测试对象，失败与复跑分开。短报告负责结论，result.json负责命令/退出码、环境、提交或工作树指纹、数据范围与附件引用。普通运行临时文件不入Git。

## 当前入口

- [M5-01开发片交付](2026-09/M5-01/report.md)：应用偏好（自动检查日线数据）与TDX路径设置的服务端模块、设置面板两区块与dataStatus门闩；tdx-path RED先行、定向41/41、全量1194/1199（已知基线失败1＋负载抖动3串行复绿）；api.ts注册与浏览器e2e待集成；含F4归属修正（web Launcher.vue，非launcher.cjs）。

- [M5-DEFAULTS-01候选交付](2026-09/M5-DEFAULTS-01/report.md)：训练默认初始资金与复权（四字段原子保存/创建优先级/RANGE预览一致性/用户流/兼容五scope）；RED先行、全量1161单测、e2e三用例；完整门禁一次运行见evidence；待GPT验收。

- [TRAIN-01候选交付](2026-09/TRAIN-01/report.md)：训练规则快照、默认费用/T+1设置、raw/forward权息一致与legacy保护；RED先行、最终HEAD 1126单测+M2 24/24+全量Journey 89过（1 flaky如实记）；待GPT验收未集成。

- [TRAIN-02第一片服务端交付](2026-09/TRAIN-02-server/report.md)：范围预览/创建复核/兼容迁移，RED先行与全量874测试；[并发与权息指纹修复](2026-09/TRAIN-02-server/wake02-fix.md)：GPT-WAKE-02两项P2。

- [当前返修交付](2026-09/ACCEPT-01-release/report.md)：完整工程验收通过，已更新7529，待用户验收。

- [夜间返修与工具核验](2026-09/ACCEPT-01-night/report.md)：日回放、官方CLI资料及多模态实测。

- [阶段返修模块复核](2026-09/ACCEPT-01-review/report.md)：录制生命周期、画线返修和提交门禁证据。

- [入口布局返修过程](2026-09/ACCEPT-01-ui/report.md)：历史定向证据。

- [首次阶段交付](2026-09/REC-01-stage-release/report.md)：用户反馈前的版本证据。

- [阶段候选修复](2026-09/REC-01-release-fixes/report.md)：退出超时根因、布局回归与用户阶段验收门禁。

- [REC-01容量立项评估](2026-09/REC-01-capacity/report.md)：撤回自动停录；区分两年测算与真实录制器导出失败。
- [REC-01结构与压缩实测](2026-09/REC-01-compression/report.md)：文件构成、增量/gzip对比和逐检查点还原。
- [REC-01迁移前基线](2026-09/REC-01-v1-baseline/report.md)：旧v1定向验证。
- [v2编解码首轮审查](2026-09/REC-01-v2-codec-review/report.md)：真实样本往返通过、恢复缺陷待修及三任务并行隔离。
- [GLM长无活动诊断](2026-09/REC-01-monitor-health/report.md)：请求/工具分开观察、输出预算续接及旧修正任务关联。
- [v2并行批次验收](2026-09/REC-01-v2-batch-review/report.md)：codec已合，validator/storage精确返修与两年Journey的RED基线。
- [v2模块联合验收](2026-09/REC-01-v2-modules/report.md)：校验/存储修复通过、真实录制迁移无损、gzip取消死锁待修。
- [v2集成与两年实测](2026-09/REC-01-integration/report.md)：gzip取消、默认录制/迁移/多标签、483次真实推进与离线回放。

- [DEV-01并行基线](2026-09/DEV-01-parallel/report.md)：精确合并候选、完整验收和两个worktree并发证据。

- [文档架构设计接受记录](2026-09/DOC-design-acceptance/record.json)：只接受治理设计及执行授权。
- [架构审查](architecture-audit-2026-09-17.json)：业务缺口的发现依据。
- [9月13日成本及分隔拖拽](M3-成本线与副图拖拽验收-2026-09-13.md)：M3历史工程证据。
- [9月11日工具反馈](M3-第三轮反馈验收-2026-09-11.md)、[9月9日整体](M3-整体验收报告-2026-09-09.md)及[保存/布局反馈](M3-反馈修复验收-2026-09-09.md)。
- [M1](M1-verification-report.md)、[M2](M2-e2e-report.md)：旧固定路径输出，必须看内部时间与数据范围，不视为最新。

其余旧截图/TDX导出保持原路径，避免破坏证据链；旧报告不是当前工作指令。按任务ID/规则ID检索，不默认读取整个证据目录。

用户验收独立保存scope、决定、日期、来源；测试全绿不生成用户accepted。代码提交C被测试后，文档提交E收录其报告可引用C，不能改写成测试过E。提交前工作树验证须用指纹核对最终提交，明确写出这种证据边界。

- [MON-02看板复核](2026-09/MON-02-review/report.md)：历史轮次与当前任务区分。
