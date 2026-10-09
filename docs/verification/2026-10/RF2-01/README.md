# RF2-01 随机股票维度补齐经典周期档位复用 验证

对象：worktree `D:\tmp\rfa`（分支 `rf2-01-stock-tier`，基础提交 `86977aa`＝main）。改动集中：`web/src/views/Launcher.vue`（random_stock 档位网格＋自定义范围档）、`server/src/train/random-mode.ts`（window_months 档位口径扩展到 random_stock）、`web/src/api.ts`（契约注释）、`server/test/random-training-mode.test.ts` 与 `e2e/random-mode.spec.ts`（扩展）。

## 用户 oracle 与矩阵行

用户原话（2026-10-09）：「随机模式的训练周期选项复用部分，你漏掉了随机股票、用户自选时间段的模式，也要复用才对，请补上」。矩阵行 `RAND-UI-PERIOD-REUSE`（2026-10-09 架构师修订版，按用户拍板）：三种随机维度全部复用经典训练周期——random_time/random_both＝档位网格＋自定义根数档（RF-04 已交付）；random_stock＝同款档位网格＋「自定义范围」档（起止日期旧口径保留）。

## 实现口径（random_stock 档位窗口语义的实现选择与依据）

- **窗口＝「最近 N 个自然月」**：锚点＝数据可用末日（目录 lastDate 最大值）。依据：经典面板 anchorDate＝`dataStatus.sourceMaxDate || shanghaiToday()`，而 sourceMaxDate 在服务端由 tdxSource 对全部 day 文件取 max 得到——两者同源即「数据末日」而非日历今天；且数据末日锚点在本地数据陈旧时随数据回退，随机池不会因日历/数据错位而恒空（若改用 shanghaiCompleteDataDate 日历锚点，任何一天未更新数据即全池 422，feature 直接不可用）。
- **窗口形状与经典 tier 服务端同式**：起始日＝锚点回退 N 自然月（addMonths 负数＝前端 minusMonthsShanghai 同款月末裁切）→ 对齐前方最近交易日（沿用旧 random_stock 口径）→ 窗末＝起始交易日＋N 自然月（经典 `plannedEnd = addMonths(startBar.date, N)` 同式）。单调性保证窗末 ≤ 锚点（完整跨度恒落在数据内，杜绝截断残窗）。
- **池与预筛沿用既有**：目录预筛「数据覆盖到窗末」（档位口径＝lastDate ≥ 锚点）＋逐股核验预热 200 根＋窗口 ≥2 交易日（拒绝采样）。
- **校验**：window_months 与 start_date/end_date 互斥 400（档位/自定义范围二选一）；window_bars 对 random_stock 仍 400（随机股票无根数口径，报错文案更新）；window_months 值域校验（1/3/6/12/24）沿用 RF-04 共享入口。
- **UI**：random_stock「训练周期」网格＝经典五档（同 TIER_MONTHS 同文案）＋「自定义范围」档；默认 3M；起止日输入仅在自定义范围档显示（进场时重置锚点回退 3 月默认区间）；档位状态跨维度归一（WINDOW_BARS 档仅 time/both、RANGE 档仅 random_stock，切换维度自动回 3M）。
- **排行**：tier 仍 RANGE 哨兵（录制契约冻结），范围排行按精确起止分组，档位口径写入 range.notes——与 random_time 档位一致。

## RED→GREEN 收据（命令＋退出码）

| 步骤 | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| RED 单元 | `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` | 1 | 4 failed / 26 passed：random_stock+window_months 被 400 拒（窗口/rng/排行/422 四例）——[red-unit.txt](red-unit.txt) |
| RED e2e | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0` | 1 | 3 failed / 9 passed：home tabs 面板互斥断言、random_stock panel 载荷、新增 3M 真实创建（run `run-331e5f63`，[red-e2e-journey.txt](red-e2e-journey.txt)） |
| GREEN 单元 | 同 RED 单元 | 0 | 30/30 通过（[green-unit.txt](green-unit.txt)） |
| GREEN e2e | 同 RED e2e | 1 | 11 passed / 1 failed：唯一失败＝masked-session 用例（**并行边界，另一 subagent 管辖、本任务禁触碰**；其经随机面板起止日期创建 random_stock 训练，而 random_stock 默认已改档位网格致起止日输入退场——适配＝填日期前先点「自定义范围」档一行）。本任务交付的 panel/period 全部用例过（run `run-2d3d0033`，[green-e2e-journey.txt](green-e2e-journey.txt)） |
| 全量单测 | `npm test` | 0 | server 123 文件 1563/1563＋desktop 12 文件 115/115（[regression-unit-full.txt](regression-unit-full.txt)） |
| 构建 | `npm run build` | 0 | typecheck:web＋build:server＋build:web 全过（[build-receipt.txt](build-receipt.txt)） |
| 经典面板回归 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/training-range.spec.ts e2e/training-defaults.spec.ts e2e/journey.spec.ts --retries=0` | 1 | 24 passed / 3 failed＝存量基线（与 RF-04 记录同款同数：journey Act4d 副图多选 paneId 断言、training-defaults 设置对话框取消超时×2；三例路径均不经过随机面板，[regression-classic-journey.txt](regression-classic-journey.txt)） |

## RAND-UI-PERIOD-REUSE 重绑 test_ids（矩阵行修订版 2026-10-09）

单元（`server/test/random-training-mode.test.ts`，describe `RF2-01 random stock by classic tier months (window_months)`）：

1. `creates a random_stock tier training whose window is the most recent 3 natural months anchored at data end`
2. `picks the tier pool stock deterministically from the injectable rng`
3. `settles a random_stock tier training into range rankings under its exact window key`
4. `rejects with 422 RANDOM_STOCK_UNIVERSE_EMPTY when no stock fits the tier window warmup`
5. `rejects tier misuse with 400 and zero side effects`

（random_stock+window_months+start_date 互斥另有 RF-04 组 `rejects window_months misuse with 400 and zero side effects` 既有用例第 7 项继续覆盖。）

e2e（`e2e/random-mode.spec.ts`）：

6. `random panel: dimension-driven control visibility and payload for random_stock`（更新：档位网格默认 3M 载荷 window_months、自定义范围档载荷 start_date/end_date）
7. `random stock period grid: tier options mirror classic and real creation with 3M succeeds`（新增：五档＋自定义范围同文案、无自定义根数档、真实 3M 创建成功）
8. `home tabs: classic is default, switching to random swaps the panel and back`（更新：随机面板面板互斥断言适配 random_stock 档位网格在场）

## RANDOM-INPUT-VALIDATION 受影响子句评估

- 原子句「random_stock 不接受 window_months（时间段由用户指定）」——**废止**（本任务即用户要求补齐）；替换为「window_months 与 start_date/end_date 互斥 400」＋「window_bars 对 random_stock 仍 400」两子句，前者由上述单元用例 5 覆盖，后者由既有 `validates request bodies with 400 and zero side effects`（random_stock+start/end+window_bars 项）与本任务用例 5（window_bars 单独给）覆盖。
- 「window_months 值域＝经典档位月数、与 window_bars 互斥」共享校验子句不变（RF-04 用例继续覆盖，random_stock 路径同入口）。

## 相邻问题登记

1. **masked-session e2e 并行边界**：`masked session: hidden stock shows star-masked title and badge while dates render as served`（random-mode.spec.ts:321）因 random_stock 默认档位网格而起止日输入退场超时失败；该用例属并行 subagent 管辖（masked-session/eye-toggle/settle-reveal 三例），本任务未触碰。适配＝在填起止日期前增加 `await page.getByRole('button', { name: '自定义范围', exact: true }).click()`（一行）。eye-toggle/settle-reveal 两例走 random_both/random_time＋自定义根数档，不受影响（本轮实测通过）。
2. 经典面板 3 例存量失败与 RF-04 基线同款同数，未归因（E2E-BASELINE-01 域），与本改动无关。
