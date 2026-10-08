# RF-01 持仓股数浮点尾巴与无法卖出：验证记录

- 日期：2026-10-08（worktree `rf01-float-shares`，基于 main=f28fd9d）
- 任务卡：[RF-01](../../../work-items/tasks/RF-01.md)
- 现象来源：用户验收现场截图——持仓（可卖）`99456.00128173828（99456.00128173828）`，卖出被报「当前没有可卖持仓」，收益仍在计算。

## 根因（文件:行）

1. **非整数股产生点**：`server/src/train/engine.ts` `applyPositionEvents`（原 1085-1093 行）。权息事件源 `server/src/tdx/gbbq.ts:96-97` 以 `readFloatLE`（float32）解码每 10 股送转/配股比例——如 2.2 解码为 `2.2000000476837158`；引擎把 `比例/10 × 持仓` 的浮点乘积**不取整直接入账**。用户截图数字的算术还原：`Math.fround(2.2)/10 × 268800 = 59136.00128173828`（`.00128173828` 与截图尾巴逐位一致）。全库 `adj_factors` 中带非 2 进制精确每 10 股比例（如 10 送 3.2、10 配 2.37）的真实事件共 **1,511 笔**（对用户库只读副本统计），任何一笔落在持仓上即触发。
2. **无可卖误判点**：`server/src/train/account.ts` `planSell`（132-134 行）——`!Number.isInteger(availableShares)` 对 `99456.00128173828` 判真，返回「当前没有可卖持仓」，整份/按比例卖出全部被拒；条件单卖出校验（`engine.ts` placeOrder）同理受限。权益仍按 `shares × price` 计算，与「收益仍在计算」吻合。

## 修复（A 股口径：到账股数取整、零股舍去）

- `server/src/train/account.ts`：新增 `integerShareCredit`（`Math.floor(value + 1e-6)`；epsilon 保护数学上为整数的乘积不被向下噪声截掉一整股）。
- `server/src/train/engine.ts` `applyPositionEvents`：送转股、配股认购股均经 `integerShareCredit` 取整后入账（配股缴款按取整后的认购股数计价）。
- `server/src/train/engine.ts` `replayState` 与 `server/src/train/metrics.ts` `realizedSellResults`：重放旧流水时对 `position_events.shares_delta` 同口径取整——position_events 唯一写者是 applyPositionEvents，非整数 shares_delta 必来自本 bug，已污染的旧训练**无需数据迁移**即可恢复可卖与整数显示。

## RED（修复前，全部按预期失败）

命令：`npx vitest run server/test/rf01-float-shares.test.ts` → **exit 1**，3 failed：

```text
FAIL credits a float32 bonus rate as whole shares ... (端到端 API)
AssertionError: expected false to be true            ← Number.isInteger(snapshot.account.shares)，实际 91500.00035762787
FAIL books exactly the user-reported delta 59136.00128173828 ...
AssertionError: expected 327936.0012817383 to be 327936   ← 268800 股 ×10送2.2(f32) 的直入账值
FAIL repairs a legacy fractional ledger row on replay ...
AssertionError: expected false to be true            ← 重放 40320 + 59136.00128173828 = 99456.00128173828（截图原值）
```

## GREEN 与定向回归（修复后）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npx vitest run server/test/rf01-float-shares.test.ts` | 0 | 3 passed |
| `npx vitest run`（定向 11 文件：rf01-float-shares/conditional-orders/train-engine/rights-cost-basis/chart-cost-basis/rankings/history-report/journey-snapshot/equity-comparison/recording-context/api） | 0 | 11 files, 128 passed |
| `npx vitest run server/test/full-acceptance.test.ts` | 0 | 6 passed |
| `npm run build` | 0 | typecheck + server + web 全过 |

未跑全量套件（任务口径为定向回归）；无已知红。

## 语义锁定（测试断言即 oracle，不从实现反推）

- 任何时点 snapshot 的 `shares`/`availableShares`、全部成交记录 `shares` 均为整数；
- 10 送 2.2 于 75,000 股入账 = 75,000 + 16,500 = 91,500（比例折算无零股）；268,800 股入账流水 `shares_delta = 59,136`；
- 旧污染行（40,320 整数买入 + 59,136.00128173828 浮点权息行）重放修复为 99,456 且整份清仓（显式 99,456 股）成功；
- 未改动任何既有交易规则语义（T+1、整手买入、条件单冻结优先级）：conditional-orders 7 用例、rights-cost-basis 7 用例原样通过。

## 数据边界披露

- 全程未连默认 `~/.a-share-kline-trainer` 库跑测试；诊断阶段曾把 `trainer.sqlite` **复制**到 `D:/tmp/rf01-diag/` 只读查询（定位产生非整数股的事件类型与 1,511 笔统计），原库零改动。测试均用内存库/临时 fixture。
