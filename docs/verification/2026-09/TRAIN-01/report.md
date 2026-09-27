# TRAIN-01 交付报告：训练规则快照、默认设置与权息一致

状态：**候选完成，待 GPT 集中验收**（reply_to=control-handoff-20260928-43）。分支 `task/TRAIN-01`，基线 `645ad6c2f4018d1c6785ac35d499537011334f61`；候选提交 `0ed7d54`（实现）→ `64e908a`（卡路径补齐）→ `1c6ccbf`（e2e 顺序依赖修复，最终候选）。本报告记录实现范围、五验收场景证据与验证运行；不代表集成、发布或用户验收。

## 交付范围（一个写者整片完成）

- **服务端**：`server/src/train/rules.ts`（规则 v1 解析/构造/序列化）；`server/src/db.ts`（rules_json 列＋旧训练回填，同一迁移事务，DDL 可回滚）；`server/src/train/engine.ts`（创建事务边界读默认并共提交、交易/可卖数量读本局快照、推进 await 后短事务重查 `TRAIN_STATE_CHANGED`、raw 新训练权息入账、legacy raw 409）；`server/src/settings/training.ts`（GET/PUT `/api/settings/training` 严格校验＋同事务保存）；`server/src/api.ts`（注册，进入既有 drain 门闩）；`server/src/recording-context.ts`（rules 改读本局快照，透出 rulesOrigin/rulesCapturedAt 可选元数据）。
- **前端**：`web/src/api.ts`（TrainingRulesView/SettingsView＋fetch/put）；`web/src/settingsPanel.ts`（弹层全局开关，训练页热键隔离）；`web/src/components/TrainingSettings.vue`（局部弹层：保存成功反馈、取消不保存、失败不假称成功、明示默认只影响新训练）；`web/src/App.vue`（侧栏设置入口启用，弹层与 Training 同级挂载不卸载录制）；`web/src/views/Training.vue`（本局规则展示＋legacy-migration 说明＋legacy raw 只读警示与按钮停用）。
- **测试**：新增 `settings-training`（12）、`train-rules-snapshot`（15）、`db-training-rules-migration`（4）、`training-rules-frontend`（6）共 37 项；e2e 新增 `e2e/training-rules.spec.ts`（3 用例）；受影响夹具更新 4 文件（rights/chart-cost-basis/drawing-price-basis/recording-context），未降低任何旧断言。
- **文档**：specs/training/rules.md（TRAIN-RULE-SNAPSHOT 落地＋TRAIN-ACCOUNT/NO-FUTURE 口径）、specs/recording.md、新 docs/user/training-rules.md＋user/README 链接、server train AGENTS/accounting.md/recording-context.md 替换过时实现事实、TRAIN-01/M5-01 任务卡。

## 先 RED 后实现

真实 RED：`evidence/red-new-tests.log`（exit 1，4 文件 22 用例全部失败：缺路由 404、缺模块、无快照行为）。之后实现，`green-new-tests-3.log` exit 0（37/37）。实现中的两次测试夹具修正（adj_factors 重复插入/权息缓存首扫清表/结算竞争时序）记录于 green-new-tests.log、green-new-tests-2.log，属测试自身缺陷修复，非生产逻辑返工。

## 验证运行（完整日志同目录 evidence/，meta 含 cmd/cwd/start/end/exit/HEAD/脏状态）

| 运行 | 结果 | 说明 |
|---|---|---|
| red-new-tests | exit 1（22 失败） | 实现前 RED 基线（HEAD=645ad6c，dirty=5 新测试文件） |
| green-new-tests / -2 / -3 | exit 1 → exit 1 → exit 0 | 37/37 通过；前两轮为测试夹具自身缺陷 |
| full-unit-1 | exit 1（24 失败） | 暴露 4 个既有夹具缺 rules_json＋recording-context 旧语义断言 |
| full-unit-2 / full-unit-3 | exit 127（无测试失败记录） | 环境性中止：进程在 review-profile 区段被外部终止；review-profile-solo 单跑 exit 0 定位为环境/负载非业务断言失败 |
| full-unit-4 | exit 0，1126/1126 | 全量绿（含 37 项新增） |
| build | exit 0 | vue-tsc 严格类型＋server tsc＋vite 生产构建 |
| final-unit-2（HEAD=1c6ccbf） | exit 0，1126/1126 | 最终候选 HEAD 全量 unit 精确绑定 |
| final-build-2（HEAD=1c6ccbf） | exit 0 | 最终候选类型＋构建 |
| final-docs / docs check·impact | check 0 error；impact 首轮分别暴露卡漏列 docs/status、user README、recording-context.md、e2e/training-range.spec.ts（均属合同允许范围），补卡后 0 error | docs/status 0 error |
| final-m2（64e908a）/ final-m2-2（1c6ccbf） | exit 0，24/24 | 受控 M2：冻结样本 `tdx-20260916-d8339f32` 隔离拷贝（路径记 evidence/fixture-copy-path.txt），报告 `m2/M2-e2e-report.md`；结算日 2026-09-04、终权益 1,008,951、+0.9% |
| final-journey-2（64e908a） | exit 1：85 过 / 4 失败（training-range）/ 1 flaky | 见下方"全量 Journey 既有顺序缺陷" |
| final-journey-3（1c6ccbf） | exit 0：89 过 / 0 失败 / 1 flaky（drawing-basis 重试后过，沿既有如实记录先例） | 修复后全量 Journey 绿；run-d6c6a26b |

## 五验收场景证据映射

1. **RULES-defaults-current-next**：settings-training 12 项（默认口径/合法保存/五类非法 400 零写/部分失败回滚/drain 503）；train-rules-snapshot「A 冻结不漂移」「B 采用新默认费用手算 125/375、T+1 关当日可卖」；e2e 用例 1 真实 UI 走完设置→A→改默认→结算→B。
2. **RULES-persistence-create**：迁移测试「重启文件库再迁移快照不变」；「提交边界读取默认」用 beforeCommit 注入真实验证等待期间更新默认进入快照；单活动训练约束未放宽（commitTrainingCreation 原重查保留，既有 engine 回归保持）。
3. **RULES-corporate-accounting**：「同一合成行情 raw/forward 逐项一致」两组（足额配股＋现金不足放弃）＋legacy forward 推进入账；推进冲突 409 零写/最新余额入账；既有 T+1/费用/防未来回归全绿。
4. **RULES-legacy-safe**：迁移幂等/失败回滚（SQLite 触发器）/旧行逐字段不变；legacy raw 交易/推进/结算 409、可放弃、可查看；已结束 legacy raw 只读；新 raw 正常训练（场景 3 同证据）。
5. **RULES-recording-ui-regression**：recording-context 测试（快照来源、设置变更后不漂移、元数据透出、路径零泄漏、只读）；不升级录像 schema/事件类型；NOTE/热键/主题既有回归全绿＋e2e 热键隔离、legacy 警示、840/浅色弹层。

## 已知边界与 followup

- 旧 forward 训练沿迁移时点冻结规则继续；历史设置未记录（UI 已如实说明）。这是合同冻结的诚实观察口径，非缺陷。
- 权息只处理推进目标交易日的事件，不声称完整交易所清算/历史修订恢复（DATA-03/04 未交付，来源只做诚实观察）。
- full-unit-2/3 的 exit 127 环境中止已单跑定位（review-profile-solo exit 0），保留原始日志未覆盖；若 GPT 复现可按同提交 verify-only 处理。
- 预算：执行 2（本次 1）、审查 2（待 GPT）、设计 1（已用）＝认领 2/5 后余 3。

## 全量 Journey 既有顺序缺陷（首次暴露，非本片引入）

- 现象：final-journey-2 中 `training-range.spec.ts` 4 用例（含重试共 8 次）失败，停留"创建训练"不可见；journey 库存在遗留 running 训练。
- 根因：`trade-marker-details.spec.ts`（6cbf7a6，NOTE-DETAIL-01 返修引入）仅在自身 beforeEach 清理活动训练、收尾不清理；`training-range.spec.ts` 违反 e2e AGENTS"每个测试开头清理活动训练"约定、依赖运行顺序。两文件均先于本片存在；本片是 trade-marker-details 加入后第一次全量 Journey（NOTE-DETAIL 片级验收记录"全量整合门禁未跑"），缺陷首次暴露。归因证据：本片 diff 不含该两文件与 launcher/active 逻辑（git diff 645ad6c..0ed7d54 --stat 可核），且失败机制（隔离库遗留 running 训练）与本片改动无关。
- 修复：training-range 的 openLauncher 开头按约定清理活动训练（不降任何断言）；training-rules 套件收尾补清理。提交 1c6ccbf。
- 复跑 final-journey-3：89 过 / 0 失败 / 1 flaky（drawing-basis 重试后过；该 flaky 先例见于 FM-009 收敛记录，如实保留）。
