# 文档清理与Mimosa门禁核查

2026-09-22，审查基线`0d5ea3568ee177086ff26810a1ad92acd7f1e8ce`。用户GLM改动为12个Markdown文件、16行增加/16行减少；没有运行源码、依赖或配置改动。原始diff保留在工程外headroom-cache。本报告不含用户模型记忆内容。

## 门禁证据

实际报告：`.mimosa/reports/task-review-sess_fe0e31b9-f7b5-4078-914d-ea4479e3953e-20260922T135533192Z-46464-070c0ab27980.json`，`run_status=inconclusive`、`coverage=partial`、`scanned_files=0`、`finding_count=0`。错误为`bash_discovery_incomplete: task baseline unavailable`及`baseline_missing: task baseline is unavailable`。不能把零发现称为安全扫描通过。

日志显示SessionStart在`Stock_WorkSpace`，该目录同会话状态保存完整基线（2453文件，2026-09-22T13:38:07.862Z）；Stop检查却使用`Stock_WorkSpace/a-share-kline-trainer`，该仓库无同会话hook-state。当前观察支持根目录错位导致基线查找失败。尚未验证究竟由宿主工作目录切换还是插件根解析导致，不把推测归因到某一版本。Mimosa安装版本1.0.3；当前不是旧的16条代码告警报告。

可操作处理：从独立仓库根或任务worktree根启动新的Zcode任务，保持任务根一致，核对SessionStart和Stop落在同一`.mimosa`目录。已有改动需按Git基线独立审查；新会话只建立之后的基线，不能追认先前扫描。未迁移/伪造hook-state、未关闭hooks、未读取插件内置密钥或绕过密封载荷。插件长期修复应统一所有hook的规范化项目根，并为跨目录会话补回归；本轮未改全局插件。

## 审查处理

保留GLM对REC/M3验收与发布状态的修正。再修正：当前探测仅3个固定目录，不能写成全盘发现或“没有错误即可判定可用”；新手步骤先启动再按实际结果处理，补充扩展名提示。提案索引区分已实现并行工具与未实施业务架构；30分钟续接遵循用户新指示。R1仍包含planned的DATA-03，不能整阶段标closed；阶段摘要改为DATA-01/02批次通过、历史保护待做，不改已有测试事实。

首次接入设计另列[提案](../../../proposals/tdx-onboarding.md)，明确未实施。生产代码、安装包、个人训练库与远端Release均未修改。文档门禁检验链接、任务与派生状态；不把它当成Mimosa覆盖补齐或运行测试。
