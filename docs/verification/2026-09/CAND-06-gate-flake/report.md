# CAND-06 集成门禁 npm test 失败复核（2026-09-29）

结论：**门禁唯一失败（release-metadata.test.ts，5000ms 超时）为并行负载抖动，非本分支内容缺陷；本分支完整 npm test 已全量全绿（87 文件/1145 测试，exit 0）。** 未修改任何测试或产品代码。

## 门禁失败与复核（分支 wt/A/CAND-06，tip 0d525f6）

1. 门禁失败清单：release-metadata.test.ts「does not accept unrelated, mismatched or invalid release metadata」——`Test timed out in 5000ms`（release-metadata.test.ts:16）。
2. 串行复跑该文件（`npx vitest run --config server/vitest.config.ts --no-file-parallelism server/test/release-metadata.test.ts`）：**1 passed (1) / 2 passed (2)，exit 0，实际测试仅 ~0.4s**——并行负载下 5000ms 预算超时，串行远低于预算，抖动性质确凿。
3. 完整全量复跑（`npm test`）：**87 文件全过 / 1145 测试全过，exit 0**——包括 runtime-isolation.test.ts（任务约定排除的基线已知失败，本轮亦通过）与门禁失败的 release-metadata；首次全量尝试的日志被截断无摘要（外层命令链问题），以重跑结果为准。
4. 内容排除：`git diff 5bf4484..HEAD --name-only` 非docs 文件数为 0——CAND-06 线（CAND-01..06 累计）相对基线只改 docs，不可能引入测试失败。

## 定性与处置

- 与 CAND-02/CAND-04 轮记录同族（并行负载预算抖动；历轮另观察到固定端口 4045 冲突类）。本轮门禁失败文件在全量串行环境 0.4s 即过，进一步坐实。
- 处置建议不变：门禁串行执行或上调预算，属集成门禁基建裁决（超出本卡 allowed_paths）；重跑遇同类超时按串行口径确认即可，不需回退本分支。

## 环境与指纹

- 分支 wt/A/CAND-06 tip 0d525f6；工作树干净；Node 24 / vitest 3.2.7 / win32-x64。
- 说明：CAND-02/CAND-04 分支上的同主题记录提交于各自分叉之后，不含于本分支，故本卡自建记录。

## 第三轮门禁复核（2026-09-29，ac79e11 之后）：fail-fast 退出码类

1. 门禁第 3 次失败形态不同：退出码 **3221226505（0xC0000409，Windows fail-fast/STATUS_STACK_BUFFER_OVERRUN）**，无任何测试输出与失败用例名——非断言失败、非超时，属进程级异常终止。
2. 本槽立即全量复跑（`npm test`）：未复现该退出码；得到的是 4 个超时类抖动文件（data-refresh 5000ms / docs-tooling 20000ms / review-profile hook 15000ms / worktree-tools hook 30000ms）。串行复跑该 4 文件：**4 passed (4) / 95 passed (95)，exit 0**。
3. 仓内同类先例：SETUP-DRAIN-01 恢复轮记录 npm ci 退出码 3221225794（0xC0000402 fail-fast）为「环境/进程异常迹象、根因 unknown、串行与恢复后完整单跑未复现」（该卡第 52 行）。本轮 0xC0000409 同族：进程级 fail-fast，发生时零输出，事后不可复现——按先例口径记为环境/进程异常迹象，不编造确定归因，未复现≠排除。
4. 分支内容仍为零运行代码改动（git diff 5bf4484..HEAD 非 docs 文件数为 0），与本退出码无内容关联路径。处置：门禁侧重跑；若 fail-fast 复现，按先例记录退出码与时间点交控制层归因（机器级），不需回退本分支。
