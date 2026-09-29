# M4-HISTORY-01 F1/F2 限定返修记录（control-handoff-20260928-55）

- 起始候选：`ce6ba282f7b3bcee042cf983c169475bfff1e08c`（干净）；返修完成提交见任务卡 integration_ref。
- 允许路径内修改：`web/src/views/History.vue`、`e2e/m4-history.spec.ts`、本目录、任务卡。服务端/门禁/timeout/retries/其他工作树零改动。
- 失败模式：FM-015。原首败与控制端加载探针（loading-results.json）原件保留未覆盖。

## F1（共享 Journey 库下绝对行数假设）

- RED 复现（当前候选原样，组合运行）：`npm run journey -- e2e/journey.spec.ts e2e/m4-history.spec.ts --retries=0` → 测试2 `toHaveCount(1)` 实得 2（journey Act5 结算 1 条＋自结算 1 条），exit 1。原件：`red-f1-combined.20260928T1.log`、`red-f1-combined.journey.log`（与 verify-only 的 6≠1 首败同型，证明非偶发）。
- 修复：列表行增加 `data-training-id`（History.vue）；spec 全部行级断言改为按本局创建的 training id 定位（`createTrainingFromForm` 返回 id；测试4 经 history API 按 code 定位 600519 行 id）；排序断言改为两行 DOM 相对顺序（compareDocumentPosition）；分页断言相对化（上一页 disabled 于 offset=0 恒真；下一页按真实 total≤20 判定）；不清理任何 settled 记录、不用 sleep/重试规避。
- GREEN：同组合运行 `20 passed`（exit 0，journey.spec 16 项＋m4-history 4 项），`green-combined.20260928T2.log`。

## F2（历史页 loading/empty/list 三态缺失）

- RED 复现（当前候选＋新门闩测试）：单文件运行门闩用例失败——挂起期间 `.history-loading` 不可见、空态"暂无已结算训练"可见（失败截图留档 run-4253336c）。诚实说明：该单文件运行库中 total=0，空态即最终态，其 RED 意义是"挂起期间违反『未完成只显示加载态』"；serverTotal>0 的原始 RED 由控制端 `loading-results.json`（serverTotal=2）与 verify-only journey 首败承担。
- 修复：History.vue 增加 `loaded` 成功归属状态——请求未完成（loading=true）只渲染加载态；仅当前请求成功后按 total 渲染空态或列表＋分页；409 活动训练守卫与错误态独立于三态可见；请求版本守卫、A→B 迟到响应丢弃保留；失效响应不回写任何状态、不留永续 loading。
- 回归（真实延迟门闩，predicate 路由 fetch 真实数据后延迟 3s 释放，不伪造响应）：挂起期 loading 可见、空态/列表/分页不可见；释放后按真实响应渲染列表；一次性 500 注入 → 错误态＋重试按钮 → 解除后重试恢复列表；pageerror 0。`green-single.20260928T4.log`：4/4 通过（52.0s）。
- 工具事实（如实记录）：glob 形式 `page.route('**/api/trainings/history', …)` 在本环境对页面 fetch 未生效（单文件运行因 total=0 提前 return 曾掩盖这一点）；门闩与注入统一改用 predicate 形式（`url.pathname === '/api/trainings/history'`）后确证生效（挂起计数 `historyRequests≥1` 断言通过）。

## 受影响回归与其他验证

- 定向单测：`npm test -- server/test/history-report.test.ts server/test/frontend-contract.test.ts server/test/training-rules-frontend.test.ts` → 46/46（`green-targeted-unit.20260928T1.log`）。
- `npx vue-tsc --noEmit -p web/tsconfig.json` → exit 0。
- docs 四检：`docs:check` 0、`docs:status --check` 0、`docs:impact --base 888778c --task M4-HISTORY-01` 0 errors、`git diff --check` 0（提交后终态复跑结果见下方追加）。
- 详情 A→B 版本守卫（测试4）、active guard（测试3）、错误重试（测试1）均在串行回归中覆盖。

## 未运行项与残余

- 完整候选门禁（八检查）按合同未自行重跑，等待 GPT 安排一次执行。
- 空态（total===0）正例的 e2e 覆盖依赖"run 内无任何 settled"的窗口，共享库常态下不可构造（不清库、不 mock 的前提下）；空态渲染逻辑由 loaded 三态实现与首局条件分支覆盖。
- 首次 unit 超时根因仍 unknown（1161/1161 串行重放不证明原因）。
- 共享 Journey 库中其他 spec 的绝对数量断言（如存在同类模式）不在本片允许路径内，FM-015 已登记需按同一规则检查。
