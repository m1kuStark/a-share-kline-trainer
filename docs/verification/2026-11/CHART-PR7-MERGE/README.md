# CHART-PR7-MERGE — PR #7 维护者合入与镜像态适配（2026-11-07）

任务：CHART-ANALYSIS-01 / CHART-MEASURE-01（PR #7「常驻行情、区间统计与两点测量」）
分支 / 工作树：`verify-pr7` @ `.control/worktrees/pr7-recon`
基线：`406307c`（本地 main `255ed16` + P0 准入前置：M9 卡修复、状态对账、docs/status 重生成）
PR head：`50915ff`（fork ac-xy/a-share-kline-trainer，draft）

## 合入与适配提交

| 提交 | 内容 |
|---|---|
| `7e36136` | `--no-ff` 合并 PR #7（保留作者单提交拓扑）。冲突 2 处：KlineChart.vue（hideHoverCard 加 quoteIndex 复位 + 保留 main 侧 loadedData 注释）、docs/status.md（生成区，合入后由生成器重写） |
| `c05935c` | 镜像态真实价适配：区间统计/常驻行情条数据源改组件真实序列 `loadedData`；两点测量像素取价按活动 P₀ 反镜像回真实域；新增镜像 e2e；display/interaction/user 文档补真实价口径 |
| `9fecddf` | 常驻行情条改 `ChartQuote` 组件 + Teleport 并入训练页 `.status-strip`（状态行内单行显示，不额外占主图高度）；回放页无槽位时内联渲染。修复 compact-chart 既有"主图起始 y ≤95"口径回归 |
| `0ad5bbf` | 任务卡维护者合入记录、状态对账、docs/status 生成区重生成 |

维护者拍板（2026-11-07）：统计/行情条/两点测量一律**真实价**（镜像仅作用于 K 线像素与价格轴；决策信息不撒谎）。两点测量在镜像态显示真实价，可能与图上直观价位不同，已在规格与用户说明中明确。

## 门禁收据（工作树 `verify-pr7`，2026-11-07）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build` | 0（vue-tsc + server tsc + vite） |
| `npm test`（server 172 文件 / 2587 用例 + desktop 34 文件 / 367 用例） | 0；2954 用例全部通过 |
| `npm run docs:check` | 0 errors / 142 warnings |
| `npm run docs:status -- --check` | 0 errors |
| `npm run docs:impact -- --base 406307c --task CHART-ANALYSIS-01` | 0 errors |
| `npm run docs:impact -- --base 406307c --task CHART-MEASURE-01` | 0 errors（合入 PR 一并交付，allowed_paths 与 CHART-ANALYSIS-01 取并集后一致） |
| `check-binding --matrix chart-analysis.yaml --strict --include-untracked` | covered=6 open=0 RED=0 |
| `check-binding --matrix chart-measurement.yaml --strict --include-untracked` | covered=4 open=0 RED=0 |
| `npm run journey -- e2e/chart-analysis.spec.ts e2e/chart-invert.spec.ts e2e/compact-chart.spec.ts e2e/pane-resize.spec.ts --retries=0` | 0；25 用例通过（3.1m，run `run-74f33ba8`） |

中途失败与修复（保留记录，不放宽断言）：
- journey 第 1 跑：新增镜像 e2e 首根断言错误（bars[0].close＝P₀ 在镜像下不变，应取 bars[5]）；compact-chart 主图 y=122 > 95（行情条新增一行压缩主图）。→ 修正断言索引 + Teleport 合并状态行；第 2 跑全绿。
- 全量单测一轮出现 2 项：frontend-contract（M6-05 odometer 样式切片把新增的全局行情条 CSS 也纳入扫描）已按位置修正；review-profile 超时 flaky 隔离复跑 16/16 通过（与 PR #3 登记的 review-profile 超时 flaky 同源，非本次改动）。最终一轮全量 2954/2954 通过。

## 矩阵

- `matrix/chart-analysis.yaml`：6 行（QUOTE-REALTIME-OHLC / STATS-RANGE-CORE / STATS-READONLY-NO-PERSIST / STATS-RANDOM-MASK / STATS-REAL-PRICE-MIRROR / STATS-LAYOUT-BOTH-THEMES），全部 covered。
- `matrix/chart-measurement.yaml`：4 行（MEASURE-FIVE-FIELDS / MEASURE-FIRST-PICK-BASE / MEASURE-PRECEDENCE-CLEANUP / MEASURE-REAL-PRICE-MIRROR），全部 covered。
- 新增 e2e：`range statistics and point measurement stay on real prices while the price mirror is on`（开镜像后统计与关镜像同区间手算值一致；测量按 `2P₀−显示价` 独立期望核对）。

## 主代理视觉检查（真实页面截图）

- 1280×720 浅色状态行内嵌行情条：[quote-light-1280.png](quote-light-1280.png)；1440×900 深色：[quote-dark-1440.png](quote-dark-1440.png)。行情条单行、无横向溢出；主图起始位置与 compact-chart 既有口径一致。
- 紧凑布局 1440：[compact-1440.png](compact-1440.png)（主图起始 y 回到既有 95 内）。
- 区间统计弹窗 1280 浅色：[statistics-light-1280.png](statistics-light-1280.png)；两点测量 1440 深色：[measure-dark-1440.png](measure-dark-1440.png)。
- 页面无 pageerror（journey 每个 spec 的 afterEach 断言）；无覆盖层/重叠/遮挡；深浅主题配色正常。

## 已知边界 / 未覆盖

- 本轮 journey 为**定向 4 套件**（chart-analysis/chart-invert/compact-chart/pane-resize）；全量 journey 与旧 base 的录像类失败复核留到本批最终门禁（不将局部绿计为整版通过）。
- 本 PR 不涉及数据解析/复权与账户/训练语义，未跑 M1/M2；最终整批门禁按变更范围再核。
- 用户验收未记录；随本批整批验收统一登记。
