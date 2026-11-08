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

## 全量门禁

待填（verify:baseline）。

## 发布

v1.3.5 打包与 CloudBase 上传见 REL-135。
