# TRAIN-FEE-01 验证记录（2026-11-07）

任务：训练默认设置支持个性化佣金/最低佣金/卖出印花税率（Issue #8-A，用户 2026-11-07 拍板推荐口径）
基线：`79b0f8a`（F0 收口：PR #7 合入 + 镜像适配 + 证据）｜工作树 `verify-pr7`
证据提交：本记录随 `feat(train): TRAIN-FEE-01 …` 提交（提交号以 `git log --grep=TRAIN-FEE-01` 为准）

## 改动摘要

- 新增 `server/src/settings/fee-defaults.ts`：三项费率默认值（缺键回退既有 account.ts 口径：佣金 0.00025、最低 5 元、印花 0.0005）、域校验（比率 [0,1]；最低佣金 [0,1e6] 元、至多两位小数）、按字段粒度的损坏键读取。
- `server/src/settings/training.ts`：GET 视图聚合资金/复权/费率损坏键 → 409 TRAINING_DEFAULTS_UNREADABLE（列出键名、不自动修复）；PUT 支持 7 字段（4 基础＋3 费率）、旧 4 字段与旧两布尔兼容；7 字段在同一事务原子保存。
- `server/src/train/rules.ts`：observedDefaultRules 读取默认费率并冻结进 `rules_json`（version 1 数值域不变）；legacy 迁移走宽松回退。
- `server/src/train/engine.ts`：创建入口对损坏费率键 409 零写（与资金/复权同口径）。
- `server/src/train/account.ts`：佣金与印花税各自 `roundMoney` 四舍五入到 0.01 元后相加；最低佣金 0＝免 5。
- web：`TrainingSettings.vue` 增加佣金率/最低佣金/卖出印花税率输入＋5 个预设＋客户端校验；`Training.vue` 本局规则摘要显示本局费率；`HistoryReport.vue` 规则标签显示费率；`api.ts` PUT 入参扩展；`styles.css` 费率区样式。
- 文档：`docs/specs/training/rules.md`、`docs/user/training-rules.md`、`server/src/train/docs/accounting.md` 同步可配口径、取整与快照语义。
- 行为矩阵：`matrix/training-fees.yaml` 8 行（SETTINGS 默认/PUT/非法零写/损坏 409/快照冻结/取整/UI 预设持久/旧客户端兼容）。

## 门禁收据（最终一轮，工作树 verify-pr7）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build`（vue-tsc + server tsc + vite） | **0** |
| `npm test` | **0**：server 173 文件 / 2596 用例；desktop 34 文件 / 367 用例全部通过 |
| `npm run docs:check` | **0 errors** / 143 warnings |
| `npm run docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base 79b0f8a --task TRAIN-FEE-01` | **0 errors** |
| `check-binding --matrix training-fees.yaml --strict --include-untracked` | **covered=8 open=0 RED=0** |
| `npm run journey -- e2e/training-fees.spec.ts e2e/training-defaults.spec.ts e2e/training-rules.spec.ts --retries=0` | **0**：10/10 用例通过（1.7m，run `run-767ae186`） |

## 失败与修复（如实保留）

1. 首轮全量单测：`npm run build` 失败于 `CreationDefaultsRead` 联合类型未收窄（TS2339）→ 重构为 `if (!read.ok || !fees.ok)` 后收窄；`runtime-isolation` 4 项失败系临时 run 内 build 继承该 TS 错误，修复后全绿。
2. e2e 首轮：设置保存后 GET 仍为默认费率 → 根因是保存 payload 未带费率三项（多行替换未命中），改为逐行插入并重跑；训练详情摘要未显示费率 → rulesSummary 多行替换未命中，改为逐行重写。
3. e2e 次轮：`training-rules` 期望旧 4 字段 PUT 精确相等 → 更新为 7 字段 toMatchObject；`training-fees` 等待按钮角色错误（详情入口是 summary）→ 改 `getByLabel('训练详情')`。
4. e2e 三轮：`training-rules` 规则文案空格变化（`费用 关`）→ 生产文案保留既有空格以兼容既有断言；e2e 之间费率默认值残留 → 所有 reset helper 显式发送 7 字段。
5. 视觉：设置弹层截图首帧透明（动画未落定）→ e2e 截图前等待 350ms；`.settings-row-text` 增加纵向排列样式，费率高亮行不再与说明挤在一行；已复核 1280/1440 深浅主题截图无溢出。
6. 全量单测一轮出现 `review-profile` 超时 flaky（与 PR #3 登记同源）→ 隔离复跑 16/16 通过；后续最终轮全量 2596/2596 通过。

## 视觉检查（主代理，真实页面截图）

- 设置面板 1440 深色：[settings-fees-1440-dark.png](settings-fees-1440-dark.png)；1280 深色：[settings-fees-1280-dark.png](settings-fees-1280-dark.png)。费率三项与预设可见、标签与说明分行、无横向溢出/遮挡。
- 训练详情规则摘要：[rules-summary-light.png](rules-summary-light.png)（含"佣金万 1、最低免 5"）。
- 页面无 pageerror（e2e afterEach 断言）；无覆盖层残留；深浅主题配色正常。

## 已知边界

- 费率编辑不回溯历史成交；已结算训练与旧录像读冻结快照，零影响。
- 暂不设过户费、排行不按费率分组（用户拍板推荐口径）。
- 前端输入域：佣金率/印花税率 0..100 万分之、最低佣金 0..1e6 元；后端域更宽（比率 0..1、最低佣金 0..1e6、至多两位小数）。
- 本记录为用户整批验收前的工程证据，不代表用户验收。
