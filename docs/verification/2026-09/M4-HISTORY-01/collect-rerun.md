# M4-HISTORY-01 收编槽内复跑（wt-D）

- 工作树：`D:/Superlinear_Academy/Stock_WorkSpace/trainer-wt/wt-D`，分支 `wt/D-M4-HISTORY-01`，被测提交 `045c07d`（收编合并：基线 `5bf4484` ← 候选 `f707a14`，零冲突；`git diff 5bf4484 045c07d --name-only` 32 文件与 `git diff 888778c f707a14 --name-only` 完全一致）。
- 环境：Windows 10.0.26200 x64，Node ≥24，vitest threads 池（最多 4 worker）；`TDX_ROOT` 未设置，个人训练库未触碰；本槽未启动任何服务（18804/18904 未占用）。
- `npm run build`：退出码 0（vue-tsc --noEmit + tsc -p server + vite build；"chunks larger than 500 kB" 为既有 vite 提示，非错误）。
- `npm test` 全量三轮（合并树上，工作树干净）：
  - 第1轮：6 文件 7 用例失败 / 1161 通过；`tail` 截断仅保留 runtime-isolation、setup-api（5000ms 超时）、worktree-tools（beforeEach 30000ms hook 超时）可见，其余失败明细未保留（日志截断，非隐藏）。
  - 第2轮（完整日志）：3 文件 3 用例失败 / 1165 通过（88 文件）；失败＝runtime-isolation（已知基线确定性失败，RUN-CANCEL-01 范围，本轮排除）＋drawings（5000ms 超时）＋worktree-tools（90000ms 超时）。
  - 第3轮（完整日志）：3 文件 3 用例失败 / 1165 通过；失败＝runtime-isolation＋docs-tooling（20000ms 超时）＋setup-api（5000ms 超时）。
- 三轮非 runtime-isolation 失败全部为超时、无业务断言失败，且失败用例集合逐轮不同（抖动特征）；按 testing.md 口径串行复跑（每文件独立 vitest 进程）：drawings 7/7、worktree-tools 28/28、setup-api 9/9（两次）、docs-tooling 30/30，全绿。
- 本任务自有套件 `server/test/history-report.test.ts` 在第2轮全量中 23/23 通过（22440ms）。
- 结论：槽内口径达成（npm test 仅 runtime-isolation.test.ts 持续失败视为通过＋抖动串行复跑确认）。完整候选门禁 `npm run verify:candidate -- --base 5bf4484 --task M4-HISTORY-01`（含 M2 与全量 Journey，须显式 TDX_ROOT）不在本槽执行，留集成阶段；分支上的历史测试证据（服务端 23/23、FM-015 返修、共库组合回归 20/20、定向单测 46/46）不替代本轮收编基线复跑，本轮复跑即上表。

## 终态复验（2026-09-30，HEAD 36a25f9＝合并＋e2e 适配后）

- 被测树：分支 `wt/D-M4-HISTORY-01` HEAD `36a25f9`（相对 045c07d 仅 docs/e2e 变更，本轮复验时工作树另含 docs-only 未提交改动，无代码差异）；`TDX_ROOT` 未设置，本槽未启动任何服务（18804/18904 未占用）。
- `npm run build`：退出码 0（typecheck:web＋build:server＋build:web；chunks>500kB 为既有提示）。
- `npm test` 全量两轮：
  - 第1轮：5 用例失败 / 1163 通过（1189.73s）；可见失败＝drawings/public-source/runtime-isolation/worktree-tools（均超时，除 runtime-isolation 断言外），1 个失败文件因日志 tail 截断未能识别——该文件在第2轮全量中必然通过（第2轮失败文件全列于下，不含它）。
  - 第2轮（完整日志）：8 用例失败 / 1160 通过（1066.06s）；失败＝api（5000ms）＋docs-tooling（20000ms）＋drawings（20000ms）＋public-source（20000ms）＋review-profile×2（beforeEach 15000ms hook）＋runtime-isolation（已知确定性断言失败）＋worktree-tools（90000ms）。
  - 两轮非 runtime-isolation 失败全为超时/hook 超时，失败集合逐轮不同（抖动特征），无业务断言失败。
- 按 testing.md 口径串行复跑（每文件独立 vitest 进程）：api 6/6、docs-tooling 30/30、drawings 7/7、public-source 3/3、review-profile 16/16、worktree-tools 28/28，全绿。
- `history-report.test.ts`（本任务自有套件）在第2轮全量中 23/23 通过（45026ms）。
- docs 工具链：docs:check 0 错误（17 条既有长度警告）；docs:status --check 0 错误；docs:impact --base 5bf4484 --task M4-HISTORY-01 0 错误（33 变更路径，10 运行代码/配置/测试路径——预检口径，不代表集成）。
- 终态口径同上：runtime-isolation（RUN-CANCEL-01 范围，本轮排除）外全绿；完整候选门禁留集成阶段执行。
