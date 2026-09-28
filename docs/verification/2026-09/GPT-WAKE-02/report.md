# GPT-WAKE-02 · DATA-05 收敛修复报告（工作树 task/DATA-05-integration）

日期：2026-09-26。基线：`d4aa4e8`（干净、单写者）。授权：control-handoff-20260926-05（GPT 裁决续接）。
说明：裁决详情 `integrator-review-20260926.md`（DATA-05 节）在本工作树中不存在（控制层持有），本报告按派发单三项修复逐项记录证据。

## 修复1：ticker/poll 乱序导致永久「更新中」

- 根因：`web/src/dataStatus.ts` 中 60s 廉价检查（ticker）与 running 轮询（poll）共用 `checkSeq`。当更新的检查先返回终态时，旧 poll 响应按序号过期被丢弃；旧代码中 ticker 的 `checkDataStatus` 不清 `dataPolling` 也不触发 `onDataFinished`，过期 poll 也不补排程 → 轮询标记永久为真，UI 永久「更新中」。
- 修复：新增统一终态应用 `applyStatus()`（任何来源的最新检查：running 交回轮询循环；终态终止 `dataPolling` 并恰好触发一次轻提示）；新增 `ensurePollingAlive()` + 在途检查计数 `checksInFlight`，在每个检查结算路径（finally）保活轮询循环——乱序丢弃过期响应后不会丢失排程；隐藏时保活自动跳过（保留暂停语义）。
- 行为测试（非源码正则）：`server/test/data-status-store-order.test.ts`，用受控 deferred promise＋假定时器驱动真实异步路径，覆盖 4 个场景：ticker 终态先到/旧 poll 后到、poll 终态先到/ticker 后到不重复触发、ticker 报 running 而旧 poll 在途（过期后必须补排程继续循环）、无轮询时终态不误触轻提示。
- 红灯证据：[red-first-order-test.txt](./red-first-order-test.txt)（对未修复 HEAD 代码 3/4 失败，exit=1；修复后 4/4 通过）。

## 修复2：Launcher 与首页提示自相矛盾

- 场景：2026-09-26（周六）15:00 上海、cutoff 09-24——官方日历 freshness=current（首页绿色"已最新"），而旧 `needsUpdate` 启发式按 09-25（中秋休市）误报 → Launcher 弹"建议先更新日线数据"，与首页相反。
- 修复：`web/src/views/Launcher.vue` 守卫改为 `shouldSuggestDataUpdate`（freshness 驱动）：current 零打扰直接创建，stale/unknown 先弹确认；`needsUpdate` 降级为旧服务端（无 freshness 字段）兼容回退。弹窗文案增加 unknown 分支："最新交易日待确认。建议先重新读取本地日线再开始训练"（不声称"可能落后"）。
- 测试：前端契约测试更新守卫与文案断言（保留其余断言）；新增 e2e `g)` 用例直接编码上述矛盾场景（首页绿色＋开始训练零打扰），journey 7/7 通过。

## 修复3：来源失效仍显示 available/current

- 根因：`isTdxAvailable` 只检查 `vipdoc` 目录，`vipdoc/sh/lday` 被移除后状态查询仍报 `source.available=true` 且 freshness 沿用上次扫描宣称 current/stale。
- 修复（有界廉价结构探测，非全盘扫描、非每分钟扫描）：`DailySource` 增加可选 `probeReadability()`；`tdxSource` 实现并导出 `probeTdxDayDirectories`（对 sh/sz/bj 中已存在的市场目录检查 `lday` 可读，容错口径与扫描一致：市场目录缺失=正常，lday 缺失=不可读；≤3 次 access）。协调器 `getStatus` 在选中 TDX 且探测失败时把 freshness 降级为 unknown，reason 明确"数据可读性未知"，不得沿用上次扫描宣称已最新；expectedDate/sourceMaxDate 保留，目录恢复后自动回到正常判定。在线来源无结构探测，扫描失败时 freshness 保持计算值。
- 测试：`data-refresh.test.ts` 改写 o（失败任务＋结构缺失→unknown 可读性未知）、新增 r（降级与自动恢复生命周期：available 仍真、reason 含"可读性未知"、恢复后回到 stale）、s（在线源失败保持 stale、无"可读性未知"）。

## 门禁与退出码

| 命令（仓库根） | 结果 | exit |
|---|---|---|
| `npm test --` 七套件（freshness26/calendar7/timing6/refresh18/store-order4/catalog3/contract17） | 81 passed | 0（[final-test-run.txt](./final-test-run.txt)） |
| `npm run build` | typecheck:web + tsc + vite 通过（chunk 警告为既有） | 0（[build.txt](./build.txt)） |
| `npm run journey -- e2e/data-update.spec.ts --retries=0` | 7 passed / 0 unexpected；evidence：.runs/run-e0fbc3fc-27ff-451a-9abf-1ca4cb798627 | 0（[journey-run.txt](./journey-run.txt)） |
| 行为测试对未修复 HEAD 复跑 | 3/4 失败（红） | 1（[red-first-order-test.txt](./red-first-order-test.txt)） |

## 范围与遗留

- 本次改动文件：`web/src/dataStatus.ts`、`web/src/views/Launcher.vue`（授权扩入）、`server/src/data/{source,tdxSource,refresh,freshness}.ts`、`server/test/{data-status-store-order,data-refresh,frontend-data-status-contract}.test.ts`、`e2e/data-update.spec.ts`、`docs/specs/market-data/requirements.md`、本目录。
- 遗留（超出本次授权范围，留集成人裁决）：`web/src/views/Training.vue:484,525` 训练页小按钮的 title/attention 类仍由旧 `needsUpdate` 兼容位驱动，周末/节假日会与首页 freshness=current 并存（仅强调样式与悬浮文案，不弹窗、不阻断）。
- FRESH-01 纯模块仅追加导出 `COMPLETENESS_NOTE`，判定逻辑零改动。
