# M4-HISTORY-01 服务端 RED/GREEN 记录

- 任务：M4-HISTORY-01（合同 control-handoff-20260928-53）；基线 `888778cfc7a4b69e4446012a26618b93a8b05b20`
- 范围：HISTORY-list / HISTORY-report / HISTORY-no-future 服务端部分（合成 SQLite，无 TDX 读取）
- 环境：Windows；工作树 `trainer-worktrees/M4-HISTORY-01`；npm ci 196 packages（log: `npm-ci.20260928T1.log`）

## RED（实现前）

- 命令：`npm test -- server/test/history-report.test.ts`（cwd=仓库根，HEAD=888778c，测试文件为新增未跟踪文件）
- 结果：exit 1，`Cannot find module '../src/train/history-report.js'`，Test Files 1 failed，Tests no tests。
- 完整日志（原件，未覆盖）：
  - `m4-history-20260928-53/evidence/red-server-history-report.20260928T1.log`（sha256 `34eac457…2da1be`，首次运行：工作树无 node_modules，`vitest 不是内部或外部命令`，exit 1——环境失败原件，随后 npm ci 后复跑）
  - `m4-history-20260928-53/evidence/red-server-history-report.20260928T2.log`（sha256 `d5f59ae8…2a400c`，模块缺失 RED）

## GREEN（实现后）

- 实现：`server/src/train/history-report.ts`（纯同步只读查询）＋ `server/src/api.ts` 两条路由接线＋模块文档。
- 命令：`npm test -- server/test/history-report.test.ts`
  - T1：exit 1，23 中 3 失败（原件 `green-server-history-report.20260928T1.log`，sha256 `add86c82…12e03`）。归因：2 处为测试夹具期望算错（total 7→实为 8；分页首行 id 期望 25→按 settle_date DESC+id DESC 实为 10），1 处为实现 bug（`tradeCount` 取值取到 `{count:1}` 对象）。测试期望修正与实现修复分离记录，未改写断言强度。
  - T2：exit 1，1 失败（原件 `…T2.log`，sha256 `6a659a19…1b0b`）：分页第二页期望又算错（应为 [15,14,13,12,11]）。
  - T3：exit 0，23/23 通过（`…T3.log`，sha256 `8ee00108…8f557`）。
- 相邻兼容回归：`npm test -- server/test/full-acceptance.test.ts server/test/api.test.ts server/test/settings-training.test.ts server/test/drawings.test.ts server/test/train-engine.test.ts` → exit 0，48/48（`green-server-compat.20260928T1.log`，sha256 `11c2e6c5…788b0`）。含 full-acceptance 既有断言 `GET /api/rankings → 404` 不回归。
- `npm run build:server` → exit 0（`green-server-build.20260928T1.log`，sha256 `f023cfc1…165f1`）。

## 覆盖口径

服务测试 23 项覆盖：settled-only 与 abandoned/running 排除、complete/early-settled 分类、RANGE preset/latest/bars 与五档 tier 如实分类、settle_date DESC+id DESC 稳定排序、分页默认与非法 400、冻结手算（100000→110000=0.1、末笔现金 90000 不是最终权益、零成交=0、结算点缺失不以 109000 代补）、结算点缺失/settle_date 缺失/初始资金无效的 unavailable 隔离、坏 rules 与 legacy-raw 行与好行共存、blind 结算后如实展示、report 全字段/404/400/HISTORY_NOT_SETTLED/TRAIN_RULES_UNREADABLE/LEGACY_RAW_ACCOUNTING_UNVERIFIED/合法 legacy-migration 如实/HISTORY_EQUITY_UNAVAILABLE、范围限定输出、画线无行/坏 JSON 不变空成功、no-future 守卫（列表+直接 ID 访问+非法 ID 先 400）、settledFact 非有限口径、no-future oracle（无 tdxRoot 成功且库内容 dump 零变化）。

## 残余

- 旧 raw（legacy-raw-unverified）在列表/报告的行为是"明确不可认证"（列表标不可用、报告 409），与合同一致；未做任何回填写入。
- 本记录绑定当时工作树（实现后未提交状态）；提交 SHA 见任务卡 integration_ref 更新。
