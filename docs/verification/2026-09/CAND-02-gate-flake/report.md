# CAND-02 集成门禁 npm test 失败复核（2026-09-29）

结论：**门禁 3 项失败均为并行负载超时抖动，非本分支内容缺陷；分支按既定串行复跑口径全绿。** 未修改任何测试或产品代码；本记录与 CAND-02 卡的索引节更新即本轮提交的全部内容。

## 门禁失败与复核（分支 wt/A/CAND-02，tip 77a3ed6）

1. 门禁失败清单（集成阶段提供）：api.test.ts「returns forward-adjusted bars…」、data-refresh.test.ts「f) detects appended bars…」、full-acceptance.test.ts「M4 and M5 are explicitly not open yet…」——三项全是 `Test timed out in 5000ms`。
2. 本槽独立全量复跑（`npm test`，vitest run --config server/vitest.config.ts）：87 文件 3 failed/84 passed，但失败集合**不同**——recording-context.test.ts（5000ms 超时）、review-profile.test.ts（hook 超时类）、runtime-isolation.test.ts（RUN-CANCEL-01 范围已知确定性失败，任务约定排除）。两次运行失败集合不一致、逐项均为超时类，是并行负载抖动的特征而非内容缺陷。
3. 串行复跑（`npx vitest run --config server/vitest.config.ts --no-file-parallelism`，覆盖两次运行出现过的全部 5 个抖动文件：api/data-refresh/full-acceptance/recording-context/review-profile）：**5 passed (5) / 57 passed (57)，exit 0**，总耗时 66s。
4. 内容排除：`git diff 5bf4484..HEAD --name-only` 非docs 文件数为 0——本分支相对基线只改 docs（六张任务卡+status+CAND-02 卡），不可能引入测试失败。

## 对门禁的建议（本槽无权实施，供集成人裁决）

- 失败根因是 vitest 并行文件执行下 5000ms/15000ms 预算对 git 夹具/SQLite 起动类测试过紧，负载高时随机超时；已观测抖动文件累计：api、data-refresh、full-acceptance、recording-context、review-profile、docs-tooling、worktree-tools、train-range-preview、release-metadata、release-launcher。
- 可选根治：集成门禁改串行执行（--no-file-parallelism，代价是时长）或上调 testTimeout/hookTimeout；两者均属共享测试基建变更，超出 CAND-02 卡 allowed_paths，须集成人裁决后另卡实施。
- 重跑门禁时若仍遇超时，按同一口径对失败文件串行复跑确认即可，不需回退本分支。

## 环境与指纹

- 分支 wt/A/CAND-02 tip 77a3ed6；工作树干净；Node 24 / vitest 3.2.7 / win32-x64。
- runtime-isolation.test.ts 为任务约定排除的基线确定性失败（RUN-CANCEL-01 范围，本轮修复范围外），本槽历轮全量运行均复现。

## 第二轮门禁复核（2026-09-29，302a4ba 之后）

1. 门禁第 2 次失败仅 1 项：setup-api.test.ts「helper request with the configured token succeeds」（`Test timed out in 5000ms`，setup-api.test.ts:106）——与第 1 轮失败集合（api/data-refresh/full-acceptance）完全不同。
2. 本槽同日全量复跑（`npm test`）：87 文件 5 failed/82 passed，失败集又不同（docs-tooling、review-profile、runtime-isolation（已知排除）、train-range-preview、worktree-tools，逐项超时类）。
3. 串行复跑覆盖两轮全部抖动文件（`npx vitest run --config server/vitest.config.ts --no-file-parallelism`：setup-api/docs-tooling/review-profile/train-range-preview/worktree-tools）：**5 passed (5) / 103 passed (103)，exit 0**（462s）。
4. 连续两次门禁运行、四次全量/串行运行，失败集每轮不同且全部为超时类、串行全绿——进一步坐实根因是并行负载下的预算抖动，分支内容（docs-only）无关。根治仍须集成人对门禁基建裁决（串行执行或上调预算，见上文建议）；在此之前，重跑遇超时按同一口径串行确认即可，不需回退本分支。
