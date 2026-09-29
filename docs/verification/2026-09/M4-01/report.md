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

## 返修二：集成门禁 setup-onboarding 超时——归属 wt-B 切片，槽内加固同型隐患（2026-09-30）

- 门禁失败原件：`npm test` 退出码 1，唯一失败用例 `setup-onboarding.test.ts:196 > rejects missing/oversized root with 400 before any inspection` 超时 5000ms（release-package 的 stderr 行仍为通过用例正常输出）。
- 归属核实（只读 git）：`server/test/setup-onboarding.test.ts` **不在 wt/D-M4-01 上**（分支内无此文件）；它来自 wt-B 的 SETUP-01 切片（分支 wt/B-SETUP-01，tip 93ebc6a——该 tip 本身即"给六个 market-data 用例显式 20s"的同型修复）。集成门禁跑在 `wt/integration/v1`（b2714ce，合并 wt/D-M4-01＋wt/B-SETUP-01＋wt/B-REL-LAUNCH-UX-01），该文件在集成分支的 blob（cc1eae2）与 wt-B tip 完全一致，且**没有任何 testTimeout 覆盖**（无 setConfig/用例级超时），每用例真实 mkdtemp＋Fastify 全量注册＋递归清理，默认 5000ms——与 settings-training 同型满载抖动。
- 槽内无法合法修复该文件：复制 wt-B 文件进本分支＝合入他人改动（且会在下次集成合并制造 add/add 冲突）；全局改 `server/vitest.config.ts` 默认值不在 M4-01 卡 allowed_paths（仅 `server/src/**`、`server/test/**`），会打破本候选 assertScope；亦不得改动 wt-B 工作树。已升级上报，建议由 SETUP-01 槽（同一行修法：文件级 `vi.setConfig({ testTimeout: 20_000 })`）或集成人在集成分支直接应用。
- 槽内顺带加固（同型已实证隐患，均在 allowed_paths 内）：`setup-api.test.ts`（本仓全量运行两次在不同用例上 5000ms 超时，串行绿）与 `drawings.test.ts`（一次"重开数据库"用例 5000ms 超时，串行绿）各加文件级 `vi.setConfig({ testTimeout: 20_000 })`，断言零改动。
- 复验：`npx vitest run --config server/vitest.config.ts server/test/setup-api.test.ts server/test/drawings.test.ts` → 16/16；全量 `npm test`（507.93s）：1184/1186——settings-training 12/12（10377ms）、setup-api 9/9（8229ms）、drawings 7/7（7759ms）均在新预算内通过；剩余失败＝runtime-isolation（任务明示排除）＋review-profile 一例 30000ms 纯超时（该文件已有 30s 预算，串行复跑 16/16 绿，同型抖动）。符合槽内口径。

## 返修三：全量门禁 journey——m4 spec 适配 UI-03 双框与 M4-01 文案（2026-09-30）

- 门禁失败原件：`m4-history.spec.ts:167` 起用例在 `getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台')` 30s 超时——旧单框 placeholder 写于候选基线 888778c，收编到含 UI-03 的基线后 UI 已是双框（Launcher.vue:377-378），旧选择器不存在；`m4-rankings.spec.ts` 为我复制同型问题。
- 修复（两分支同步，e2e/m4-history.spec.ts 两分支字节一致）：①createTrainingFromForm 改双框规范流程（填『股票代码，如 600519』→断言『已选：』，精确代码去抖自动选中，journey.spec.ts:22-24 同款）；②成绩单三处断言改 `getByRole('heading')`——M4-01 复盘文案含『逐笔成交标记』『画线标注清单』字样致 getByText 双命中 strict violation；③m4-rankings 第二局结算后补关『训练结算』模态（settle-mask 拦截指针 240s）；④m4-rankings 指标断言改数据无关（删误加的 `toContainText('买入')`；胜率/盈亏比列 td 5/6——1 笔卖出局胜率必有值、盈亏比必 '--'；零卖出局两列 '--'；原 100.00% 断言依赖样本次日方向不可假设）。
- 提交：wt/D-M4-HISTORY-01 `6d50385`＋`36a25f9`（含其 report.md 返修段）；wt/D-M4-01 `71f1438`（cherry-pick）＋`41a9510`。
- 复验：`TDX_ROOT=<本worktree>.runs/fixture/tdx-20260916-d8339f32 npm run journey -- e2e/m4-history.spec.ts e2e/m4-rankings.spec.ts`（runtime per-run 隔离 manifest/动态端口/独立库，e2e 规则要求的唯一入口）——首轮（run-f2a2c63c，仅双框修复）2 failed/1 skipped 暴露②③④；终轮（run-9653eee0，全部修复）**6 passed (1.3m)，退出码 0**。首轮失败原件与截图保留于 run artifacts；未占用 8787/8791/5173。
- 注：e2e spec 不参与 vitest 全量（`npm test` 不受影响，本轮未重跑全量；journey 实跑即本项验证）。
- 后续门禁复报（2026-09-30 二次）：m4-rankings.spec.ts:27 旧 placeholder 240s 超时——只读核实为集成侧旧副本：`wt/integration/v1` 在 7e2509f 时点合并本分支，`41a9510 不在 integration`，其 m4-rankings.spec.ts 仍为旧单框版本；本分支 tip（13e4f8b）已含全部修复（全仓 grep 旧 placeholder 零残留）。本分支复跑 `npm run journey -- e2e/m4-rankings.spec.ts` → **2 passed (35.4s)，退出码 0**（run-e6950659）。集成侧重合并 wt/D-M4-01（tip 13e4f8b）即消除。
