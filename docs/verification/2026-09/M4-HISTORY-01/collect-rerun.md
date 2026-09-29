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
