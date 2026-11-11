# CHART-MEASURE-04 验证记录（2026-11-12）

任务：可发现的测量工具（顶栏入口＋拖动/两次点击建立）；见[任务卡](../../../work-items/tasks/CHART-MEASURE-04.md)。

## 结论

工程自验通过：RED→GREEN 定向 journey、构建、定向单测、docs、impact、binding。冻结算法的数据窗口（RangeMeasurement/chartStatistics）零改动，字段与既有 Shift 两点测量逐条相等。视觉检查（深浅主题、桌面尺寸、真实操作）由主代理完成，本记录附自验截图供检查。未决/边界见文末。

## 实现摘要

- 入口：Training.vue 顶栏「划线」旁新增「测量」toggle（lucide Ruler 尺子图标、aria-pressed、中文 aria-label/title；1024×680 下落为 26px 图标入口，可访问名称保留），进入后按钮高亮、状态条显示「测量模式」、图上提示「测量模式：拖动或两次点击选择起止K线，Esc 退出」、光标十字。
- 建立：KlineChart.vue 新增 `measureMode` prop / `measureChange` emit，沿既有 host pointerdown capture＋window pointermove/pointerup 链新增测量手势——拖动期间只增长 Select Box 预览（`.range-measure-preview`），松手才出数据窗口；两次点击第一次复用既有 `measurementAnchor`（本任务补上其虚线竖线渲染 `.range-measure-anchor`），第二次建立区间。起止索引排序归一；再次拖动/点击替换旧值，模式保持。
- 复用：数据窗口、Select Box、可拖边界、统计源（当前周期 chart.getDataList()）与镜像真实价口径全部沿用 CHART-MEASURE-02/03，未改 `chartStatistics.ts` 与 `RangeMeasurement.vue`。
- 退出/仲裁：Esc 一步退出并清除；再点按钮/切周期/结束训练/进入画线工具或多选模式退出并清除；滚轮/缩放/平移/失焦/可见范围变化/指标开关沿用既有 closeMeasurement 只清当前测量；分隔条/价格轴/时间轴拖动（CHART-PAN-01）/绘图取点/多选/Ctrl-Alt-Meta 优先；测量激活期间交易/推进/删除热键被吞；模式内主图空白左拖改为建立测量（不再框选缩放）。
- 只读探针：journey 模式 `__trainerChart.mode().measure` 与新增 `measurementTool()`（mode/anchor/range）；生产构建不注入。

## RED（先失败测试）

`$env:TDX_ROOT='D:\MySoftWares\TDX'; npm run journey -- e2e/measure-tool.spec.ts --retries=0`

- run id：`run-0aa7c954-0d59-404e-b238-f77cf918a2ff`，**6 failed**。
- 正确原因失败：前 5 例 `waiting for getByRole('button', { name: '测量', exact: true })`（入口不存在）；第 6 例 `expect((await mode()).measure).toBe(false)` 实得 `undefined`（模式探针未接线）。
- 首跑构建耗时约 11 分钟（共享机器三路并发 journey），非断言等待；证据 `.runs/<id>/artifacts/journey.log` 保留。

## 迭代记录（失败保留）

`run-df776de4-b023-4bcd-92fc-8816d8a2c8c1`：13 passed / 2 failed；其中 chart-analysis 9/9 全绿（既有 Shift 两点测量零回归）。2 例失败是**测试自身**覆盖层交互问题：反向拖动/反向点击的起点落在已建立测量的边界手柄（既有 CHART-MEASURE-03「边界可拖」语义正确优先）或数据窗口覆盖区，导致没有进入新建立路径。修正为：反向归一先 Esc 退出再重新进入（正/反向各自独立建立），替换建立点放在既有 Select Box 左侧空白——未删除/放宽任何产品断言。

## GREEN（定向）

| 命令 | 退出码 | run id / 结果 |
|---|---|---|
| `npm run journey -- e2e/measure-tool.spec.ts --retries=0` | 0 | `run-4a06f420-f7d3-4e2f-8115-eb258bb46c38`，**6 passed (48.5s)** |
| `npm run journey -- e2e/chart-analysis.spec.ts --retries=0` | 0 | `run-df776de4-b023-4bcd-92fc-8816d8a2c8c1`，**9 passed**（既有用例零回归） |
| 最终 `npm run verify:fast -- --unit server/test/chart-statistics.test.ts --journey e2e/measure-tool.spec.ts e2e/chart-analysis.spec.ts` | 0 | journey run `run-977cb2f1-170d-4a80-9923-c6321779e2c1`：**15 passed (2.1m)**（chart-analysis 9/9 ＋ measure-tool 6/6）；docs:check/build/unit/journey 全 PASS，总 159s。前一次同命令 run `run-4183bacc-49bb-4cf2-83d0-6e67da705bc2`（15 passed）为 panelChange 平衡小修前的通过记录 |

## 字段 oracle（独立，不反推实现）

- e2e 以 `__trainerChart.bars()`（图表真实 K 线，浏览器内实际数据）手算 19 根区间：起点/终点收盘、价差、涨跌幅、区间最高/最低，逐字段 `toBeCloseTo` 断言。
- 第二 oracle：Esc 退出模式后，用同区间既有 Shift 两次点击测量，比较 `dl>dt→dd` **全字段数组逐条相等**——证明「字段完全一致」（冻结的 CHART-MEASURE-02/03 口径）。
- 几何 oracle：两次点击首点的虚线锚点中心 x 与 `pointToPixel(bars[from])` 中心差 ≤2px（浏览器真实测量，非读实现常量）。
- 反向归一：正向拖动/反向拖动（独立模式下）得到同一 `{from,to,count}`；两次点击反向同样归一。
- 镜像：开启多空反转后 `bars()` 已是镜像价，测量窗口起止收盘/价差/涨跌幅仍等于真实 bars 手算值。
- 无写：拖动建立用例断言 `/bars?` 零重载、非 GET 写请求空、`drawings()`/`visibleRange()` 前后不变。

## 轻量门禁

| 命令 | 退出码 |
|---|---|
| `npm run docs:check` | 0（0 errors；WARN 为既有文档长度建议，本任务新增两处 README 超长提示同属 WARN 级） |
| `npm run docs:status`（生成区新增 CHART-MEASURE-04 行） | 0 |
| `npm run docs:status -- --check` | 0 |
| `npm run docs:impact -- --base 7895a22 --task CHART-MEASURE-04` | 0（11 路径，4 运行代码路径，0 errors/0 warnings） |
| `check-binding --strict --include-untracked --matrix chart-measurement.yaml` | **3（预期）**：covered=6、open(未闭合)=3、RED=0；未闭合 3 行＝Lead 预登记的 MEASURE-TOOL-ENTRY / MEASURE-TOOL-DRAG-CREATE / MEASURE-TOOL-PRECEDENCE（planned），按纪律由 Lead 用下方 test_ids 升 covered，worker 不改 matrix |
| `npm run build`（含 vue-tsc 类型检查） | 0（verify:fast 内） |
| `npm run verify:fast -- --unit server/test/chart-statistics.test.ts --journey e2e/measure-tool.spec.ts e2e/chart-analysis.spec.ts` | 0（155s；docs:check/build/unit/journey 全 PASS） |

## 矩阵行 test_ids（供 Lead 升 covered）

- MEASURE-TOOL-ENTRY：
  - `e2e/measure-tool.spec.ts::测量入口在顶栏可见、可键盘切换，1024×680 深浅主题下顶栏不溢出`
- MEASURE-TOOL-DRAG-CREATE：
  - `e2e/measure-tool.spec.ts::拖动建立区间测量：实时预览、松手出窗口、反向归一、边界可拖、字段与 Shift 完全一致且不写数据`
  - `e2e/measure-tool.spec.ts::两次点击建立区间测量：首次点击虚线锚点提示、反向归一、再次建立替换旧值`
- MEASURE-TOOL-PRECEDENCE：
  - `e2e/measure-tool.spec.ts::测量模式的互斥与仲裁：画线/多选互斥、热键被吞、滚轮/价格轴/时间轴/切周期按既有路径清理`
  - `e2e/measure-tool.spec.ts::多空反转开启时测量模式仍按真实价计算与显示`
  - `e2e/measure-tool.spec.ts::只读回放：新模式不启用且零报错，既有 Shift 测量仍只读可用`

## 视觉检查（主代理）

自验截图（1024×680 顶栏入口深浅主题、1440 数据窗口、镜像窗口）从 journey run artifacts 归档到本目录；主代理仍需在真实页面做深浅主题、桌面尺寸、溢出与状态切换检查（UI-VISUAL-ACCEPTANCE）。

## 环境与边界

- 隔离 journey run：动态端口、独立 SQLite、独立前后端构建；TDX_ROOT=D:\MySoftWares\TDX；未使用个人训练库。
- **环境事故（保留记录）**：03:08—03:11 之间主检出共享 `node_modules` 因工作树清理穿过 junction 被部分删除（缺失 `.bin`、`.package-lock.json`、`@babel/parser`），本轮一次门禁复跑 4 项全部以 `'tsx'/'vue-tsc'/'vitest' is not recognized` 快速失败（保留于会话记录）。Lead 已定位根因并在主检出用 `npm install --ignore-scripts --prefer-offline` 修复（exit 0，package-lock 与工作树无改动），随后本轮按正常 `npm run` 入口重跑，得到上表 run `run-977cb2f1` 全绿。该失败记录属环境事故，不是产品断言失败，也未用其冒充通过。
- 未改冻结算法/未被本任务允许的共享模块；未改 matrix、未改 SessionReplay.vue。
- 边界 1：回放页本轮不加「测量」顶栏入口（SessionReplay.vue 不在本任务 allowed_paths；Lead 2026-11-12 确认：回放只读可用口径＝既有 Shift 测量仍通过＋新模式代码零报错/零写请求，若用户验收要求一键测量另立卡）。measure-tool 回放用例断言 `mode().measure === false`、Shift 测量 11 根窗口可用、写请求为空、无 pageerror。
- 边界 2：模式内点击已建立测量的**数据窗口区域**不会建立新测量（窗口是可交互 UI）；边界手柄仍优先调整起止 K 线（既有语义）。
- 边界 3：切周期＝退出模式并清除（Lead 口径）；滚轮/缩放/平移/失焦只清除当前测量、保留模式。
- 失败与 RED/迭代 run 保留在 `.runs`（不提交）。

## 提交

证据随 `feat(chart): CHART-MEASURE-04 新增顶栏测量工具入口与拖动/两次点击建立` 提交（分支 `task/CHART-MEASURE-04`，基于 main@7895a22）。本记录为工程自验，不代表用户验收；视觉检查仍由主代理按 UI-VISUAL-ACCEPTANCE 复核。
