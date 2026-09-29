# M4-01 指标排行与复盘：开发槽验证记录（wt-D）

- 工作树：`D:/Superlinear_Academy/Stock_WorkSpace/trainer-wt/wt-D`，分支 `wt/D-M4-01`（`wt/D/M4-01` 与既有分支 `wt/D` 同名冲突，按槽内先例用扁平名），自 M4-HISTORY-01 收编基线 `e8f80f9` 切出。
- 提交序列：`1786783` 排行骨架（分组/冻结排序链/复盘防未来守卫）→ `64f3ce3` 排行 UI 骨架＋成绩单只读K线复盘 → `b62725f` 冻结口径四指标（已实现盈亏/胜率/盈亏比/沪深300超额）→ `5cdc41f` e2e 规格 → 本记录随 docs 提交。
- 口径依据：拍板 S4（2026-09-29 用户确认六项固定样例全部冻结，含执行要求①null 殿后与稳定键一致、②手算测试覆盖清单）；行为规格见 `docs/specs/training/rankings.md`。
- 环境：Windows 10.0.26200 x64，Node ≥24，vitest threads 池；合成 SQLite 夹具＋合成 sh000300 日线（32 字节记录与 `src/tdx/dayfile.ts` 解码互逆）；个人训练库未触碰；本槽未启动长驻服务（18804/18904 未占用）。

## 命令与结果

- `npm run build`（vue-tsc --noEmit + tsc -p server + vite build）：退出码 0（实施后复跑一次确认，含测试文件；"chunks larger than 500 kB" 为既有 vite 提示）。
- `npx vitest run --config server/vitest.config.ts server/test/rankings.test.ts`：18/18 通过。手算样例：部分卖出摊销 790.6/588.7（买入费按卖出比例摊销）、一赢一亏盈亏比 489.75/509.75、零交易入榜且胜率/盈亏比/超额 null、零亏损盈亏比 null、持有期分红 1000 不进单笔（−15 亏损）、基准对齐（基准 +2.5%、训练 +12% → 超额 +9.5%）、基准文件缺失/训练起点早于覆盖两态、胜率键 null 殿后在 id 破平局之前、bars 复盘守卫两态（running 自身放行→缺 TDX 503；他局 409 HISTORY_ACTIVE_TRAINING）。
- `npm test` 全量第 1 轮（487.16s）：1184/1186 通过；失败＝`full-acceptance.test.ts`（陈旧断言：断言 `/api/rankings` 404——M4 排行已按拍板交付，属本任务范围内的行为变更，已改为"合法档位显式 200/非法 400、M5 settings 仍 404"）＋`review-profile.test.ts`（30000ms 纯超时，串行复跑 16/16 绿）。
- `npm test` 全量第 2 轮（修复后，642.56s）：1183/1186 通过；失败＝`runtime-isolation.test.ts`（已知基线确定性失败，RUN-CANCEL-01 范围，本轮排除）＋`setup-api.test.ts` 两例（5000ms 纯超时，串行复跑 9/9 绿）。符合槽内口径"仅 runtime-isolation 失败视为通过＋抖动串行复跑确认"。
- 串行复跑命令：`npx vitest run --config server/vitest.config.ts server/test/<file>`（review-profile 16/16、setup-api 9/9、full-acceptance 3/3）。
- `npm run docs:status`／`docs:check`／`docs:status -- --check`／`docs:impact --base e8f80f9 --task M4-01`：见提交前终检（本记录提交于终检之后，最终数字以提交信息为准）。

## 数据范围与边界

- 排行与指标全部为持久事实只读派生：不新增持久化指标表、不写库、不重算账户；基准只读 `vipdoc/sh/lday/sh000300.day`（与 `tdx/inspect.ts` 同源）。
- 防未来：`/api/rankings` 与历史同守卫（running 存在 409，异步基准读取后复守卫）；`/api/trainings/:id/bars` 复盘守卫——running 存在时仅放行该局自身（推进日截断），其余训练 409。
- 明确未做：RANGE 训练排行展示分组（roadmap §2.7 留存）、复盘画线编辑、M5 设置。浏览器 Journey（含 `e2e/m4-rankings.spec.ts`）不在本槽执行，集成阶段串行跑。

## 返修：集成门禁 settings-training 超时（2026-09-30）

- 门禁失败原件：`npm test` 退出码 1，唯一失败用例 `settings-training.test.ts > 同一请求内两值同事务更新，不部分成功（第二次更新失败则整体回滚）` 超时 5000ms（release-package 的 stderr 行为通过用例的正常输出，非失败）。
- 归因：该文件每个用例都做真实临时文件 SQLite＋迁移＋Fastify 注入，threads 池满载并行下整体耗时数倍于串行；失败用例串行实测仅 965ms（本槽复跑两次 12/12 全绿），`saveTrainingSettings` 事务语义正确（RAISE(ABORT)→catch→ROLLBACK，server/src/settings/training.ts），无挂起路径；settings 路由不在 M4-01 改动路径内，属负载超时抖动，与此前 setup-api/review-profile 各例同型。
- 修复：按仓库既有先例（docs-tooling `testTimeout 20_000`、review-profile `30_000`、worktree-tools `90_000`）给该文件文件级 `vi.setConfig({ testTimeout: 20_000 })`，注释记录门禁失败与预算理由；断言零改动——时间预算修正，不是产品延迟 SLO。
- 复验：`npx vitest run --config server/vitest.config.ts server/test/settings-training.test.ts` 12/12；全量 `npm test`（551.39s）：1184/1186 通过——settings-training 12/12（含原失败用例，整文件 10985ms，新预算内）；剩余失败＝runtime-isolation（任务明示排除的已知确定性失败，RUN-CANCEL-01 范围）＋docs-tooling 一例 20000ms 纯超时（串行复跑 30/30 绿，与前几轮同型抖动）。符合槽内口径"仅 runtime-isolation 失败视为通过＋抖动串行复跑确认"。
- 提交位置：wt/D-M4-01（settings-training.test.ts 在 M4-01 卡 allowed_paths `server/test/**` 内；M4-HISTORY-01 卡不含该路径，提交到该分支会打破其 assertScope 门禁）。
