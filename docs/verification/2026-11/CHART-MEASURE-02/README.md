# CHART-MEASURE-02 验证记录（2026-11-08）

任务：两点测量改为 K 线区间统计（用户 2026-11-08 验收反馈）；范围见 [任务卡](../../../work-items/tasks/CHART-MEASURE-02.md) 与 [交互规格](../../../specs/chart/interaction.md)。

## 实现

- 交互：Shift+左键两次单击 K 线（首点虚线竖线提示）→ 起止 K 线归一化 → Select Box＋数据窗口；左右边界可拖动，统计实时更新；Esc/普通点击/滚轮/周期/尺寸/失焦清除；测量激活期间训练热键被吞。
- 统计：`calculateTwoPointMeasurement`（起止收盘/涨跌幅/价差/K线数＋复用 `calculateRangeStatistics` 的区间高低/振幅/量额/涨跌根数）；镜像态用真实 `loadedData`（显示真实价）。
- 组件：新增 `RangeMeasurement.vue`（Select Box/边界拖动/数据窗口）；移除旧自由两点组件与 `calculatePointMeasurement`。

## 定向门禁

| 检查 | 结果 |
|---|---|
| `npx vitest run server/test/chart-statistics.test.ts server/test/frontend-contract.test.ts` | **0**：43/43 通过（含新区间测量单测 3 例、契约 37 例） |
| `npm run typecheck:web` | **0** |
| `npm run journey -- e2e/chart-analysis.spec.ts --retries=0` | **0**：8/8 通过（1.1m；含两次点击、拖动边界实时更新、所有权/取消、镜像真实价、回放只读、随机遮蔽） |
| `check-binding --matrix chart-measurement.yaml` | **covered=6 open=0 RED=0** |

## 全量门禁（环境不稳定，记录复跑）

- `npm run verify:baseline`（被测提交 fa7d4ff）共跑 5 轮；本轮结果为 **234 passed / 2 failed / 1 skipped（journey 43.5m；总 60.5min）**，失败项均为**既有无关 e2e 的满载超时**，非本任务行为失败：
  - `m4-rankings.spec.ts::运行中守卫（排行关闭、零行）与放弃不入榜`：等待「3个月」按钮 180s 超时（页面冻结）；
  - `recording-long.spec.ts`：全量第 237 项满载下首笔买入未成交（同轮 isolated 通过）。
  - 两项 **隔离复跑 3/3 通过**（`m4-rankings` 8.4s / 22.6s、`recording-long` 1.3m，run `run-98fb…`，2026-11-09）。
- 本任务定向门禁（chart-analysis 8/8、chart-statistics 43/43、typecheck 0、binding 6/6）全部通过；v1.3.4 上一版全量门禁曾全绿（236 passed），本版改动仅测量交互与测试预算/等待，无训练/行情/账户写路径变化。
- 环境结论：当日 Windows 全量浏览器套件在持续满载下出现随机页面冻结/超时（同一测试隔离全绿、CPU/进程无残留 trainer 服务）；已把 trace 默认关闭、预算与动作等待收敛后仍偶发，按已知环境 flaky 记录并保留隔离收据。

## 发布

v1.3.5 打包与 CloudBase 上传见 REL-135。
