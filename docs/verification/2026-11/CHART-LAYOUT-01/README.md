# CHART-LAYOUT-01 验证记录（2026-11-12）

任务：[CHART-LAYOUT-01](../../../work-items/tasks/CHART-LAYOUT-01.md)（用户 2026-11-10 Issue #8：训练页底部大块空白、指标窗口无法填满）。
工作副本 `.control/worktrees/CHART-LAYOUT-01`，分支 `task/CHART-LAYOUT-01`，基线 `7895a22`。
环境：Windows / Node 24.15.0 / Edge channel / `TDX_ROOT=D:\MySoftWares\TDX`；journey 独立 run（独立端口、SQLite、前后端构建与证据），每 run 单 worker。数据：冻结真实样本 600519（2Y，`2024-09-13` 起）＋本局录制回放。

**证据边界**：本页是工程自验；`UI-VISUAL-ACCEPTANCE`（主代理真实页面视觉审阅）与用户阶段验收不在本记录范围。运行时工作树未提交，run manifest 的 commit 为 `7895a22`（git HEAD），被测树内容由下述未提交改动构成；交付 SHA 见文末。

## 结论

根因已实测并修复：`.chart-frame` 由 3 行 grid 改为 flex 纵向列，图表宿主恒占「面板内容高度 − 成交标记带 40px」，主图/VOL/MACD/KDJ/时间轴全部填满该高度；训练页 Quote Teleport 与回放页 Quote 内联两种形态由同一规则成立。冻结验收 `e2e/layout-fill.spec.ts` 先 RED 后 GREEN；既有响应式/窗格/回放 5 套件 22 用例回归通过。未改 paneHeights 语义、成交标记带功能、手势/画线/快捷键。

## 根因（旧实现实测）

训练页 `ChartQuote` 被 `<Teleport to="#chart-quote-slot">` 移到状态条后，`.chart-frame` 流内子元素只剩 `.chart-wrap` 与 `.trade-marker-rail`，grid 仍保留 3 行 `auto minmax(0,1fr) 40px`：

| 视口 | frame 高 | 实测 gridTemplateRows | rail 位置 | frame 底−rail 底（空白） | host vs frame−rail |
|---|---|---|---|---|---|
| 1024×680 | 580 | `536px 4px 40px` | 629→669 | **4px** | 536 vs 540 |
| 1366×705 | 605 | `536px 29px 40px` | 629→669 | **29px** | 536 vs 565 |
| 1440×900 | 800 | `536px 224px 40px` | 629→669 | **224px** | 536 vs 760 |

首行 536px 是自指固定点：host 内容＝klinecharts 窗格内联高度之和（主图 207＋VOL/MACD/KDJ 各 100＋分隔条 3×1＋时间轴 26＝536），grid auto 首行由该内容撑住，host 不随视口增长；`minmax(0,1fr)` 只拿剩余空间，rail 40px 落入中间行并溢出到第 3 行，第 3 行 40px 成为底部空白带（用户所见）。回放页无 `#chart-quote-slot`，行情条内联时 3 子元素恰填 3 行——旧实现回放页正常，修复须保持该形态。

## 修复（`web/src/components/KlineChart.vue`）

- `.chart-frame`：`display: grid; grid-template-rows: auto minmax(0,1fr) 40px` → `display: flex; flex-direction: column`（`height:100%` 保留）。
- `.chart-wrap`：`height:100%` → `flex:1 1 0; min-width:0; min-height:0`（宽度 100% 与 `overflow:hidden` 保留，`frontend-contract` 的 `.chart-wrap` 契约仍匹配）。
- 行情条 Teleport（训练页）与内联（回放页）由同一份 flex 规则自然成立；无伪元素、无 JS 布局补偿。
- 未改 paneHeights 捕获/回放、成交标记带 40px 功能、图表手势/画线/快捷键。

## 修复后实测（GREEN journey 几何快照，`layout-metrics.json`）

| 视口/主题 | frame | host | rail | 窗格（top@height） | 分隔 | 时间轴 | 合计 |
|---|---|---|---|---|---|---|---|
| 1024×680 深浅 | 580 | 540 | 40 | candle 0@211 / VOL 212@100 / MACD 313@100 / KDJ 414@100 | 1×3 | 514+26 | 540 |
| 1366×705 深浅 | 605 | 565 | 40 | candle 0@236 / VOL 237@100 / MACD 338@100 / KDJ 439@100 | 1×3 | 539+26 | 565 |
| 1440×900 深浅 | 800 | 760 | 40 | candle 0@431 / VOL 432@100 / MACD 533@100 / KDJ 634@100 | 1×3 | 734+26 | 760 |

frame 流内子元素＝2（wrap、rail，flex 无空行）；host＝frame−rail；窗格+分隔条+时间轴逐像素填满 host（±0）。

## RED（先失败）

- 干净 RED：`npm run journey -- e2e/layout-fill.spec.ts --retries=0`（**exit 1**）→ run-966fc58e-40d0-4af9-8dcb-8cca9a4aa3bb（2 failed / 1 passed）
  - 训练页铺满：`1024x680-dark: grid 行数 vs 流内子元素数 Expected 2 / Received 3`（空余网格行）
  - 交互不变量：`initial-1440x900: 末个子元素底边 vs frame 底边 actual 864 vs expected 893`（29px 空白带）
  - 回放内联用例旧实现通过＝兼容性守卫（修复后必须继续成立）
  - 失败截图：`red-failed-training-1024x680.png`、`red-failed-resize-1440x900.png`
- 过程记录：首次 RED run-e4e6d553-63b0-498d-ab8c-df6d8fc2e749 中回放用例因测试 helper 把面板容器写死 `.chart-panel`（回放页为 null）而崩溃，属 helper 缺陷非产品失败；改为「frame 直接父元素＝面板容器」后复跑得上述干净 RED。两次 RED 的失败均保留，未删除断言后重写。

## GREEN（定向）

- `npm run journey -- e2e/layout-fill.spec.ts --retries=0`（**exit 0**）→ run-68c3e4a6-8850-47dc-a3f8-3e51c3e59140：3 passed (32.0s)（修复后首轮 GREEN）
- 轻量门禁内同命令（**exit 0**）→ run-4b8d1522-4889-4a29-9979-43cf9f4190cd：3 passed (35.6s)；`layout-metrics.json` 即由该 run 的 attachment 解码归档。
- 3 用例：三尺寸×深浅主题铺满；MACD 关/开、双击最大化/还原、resize 1440→1024→1440；回放页行情条内联形态。截图 11 张见本目录。

## 响应式回归（既有套件，无断言弱化）

`npm run journey -- e2e/compact-chart.spec.ts e2e/uiux-training.spec.ts e2e/pane-resize.spec.ts e2e/chart-toggles.spec.ts e2e/chart-analysis.spec.ts --retries=0`（**exit 0**）→ run-77b24bae-740f-421d-aec9-fc79986d41d1：**22 passed (3.5m)**。覆盖 Quote 内联/副图分隔条所有权/最大化/指标开关持久化/回放统计与双主题几何；未删除或放宽既有断言。

## 轻量门禁（真实命令与退出码）

| 门禁 | 命令 | 退出码 | run/收据 |
|---|---|---|---|
| verify:fast | `npm run verify:fast -- --unit server/test/frontend-contract.test.ts --journey e2e/layout-fill.spec.ts` | **0**（4 步全 PASS，77s） | 见下四行 |
| docs | `npm run docs:check` | **0**（0 errors / 160 warnings） | 独立复跑同值 |
| build | `npm run build` | **0** | 独立复跑；verify:fast 内 build PASS |
| unit | `npm exec -- vitest run server/test/frontend-contract.test.ts --config server/vitest.config.ts` | **0**（37 tests passed） | verify:fast 内 unit PASS |
| journey | `npm run journey -- e2e/layout-fill.spec.ts --retries=0` | **0**（3 passed） | run-4b8d1522-4889-4a29-9979-43cf9f4190cd |
| docs:status | `npm run docs:status -- --check` | **0** | 生成区仅新增 CHART-LAYOUT-01 行 |
| docs:impact | `npm run docs:impact -- --base 7895a22 --task CHART-LAYOUT-01` | **0**（7 变更路径，2 运行路径） | 工作树预检 |
| binding | `node .zcode/skills/ai-harness/scripts/check-binding.mjs --repo <树> --matrix .zcode/skills/ai-harness/matrix/uiux-workbench.yaml --strict --include-untracked` | **1**（预期） | covered=13 / open=3 / RED=0；其中 UIUX-TRAINING-FILL-HEIGHT 待 Lead 升 covered，另 2 行为 UIUX-TOOLBAR-PIN/RESIZE（非本任务） |

## 矩阵绑定（供 Lead 升 covered）

矩阵行 `UIUX-TRAINING-FILL-HEIGHT`，test_ids：

- `e2e/layout-fill.spec.ts::training chart fills the available height at three desktop sizes in both themes`
- `e2e/layout-fill.spec.ts::fill invariants survive MACD toggle, maximize/restore and window resize`
- `e2e/layout-fill.spec.ts::replay page keeps the inline quote and fills the frame without an empty row`

## 视觉检查

- 工程截图：三尺寸×深浅 6 张、MACD 关闭/最大化 2 张、resize 2 张、回放内联 1 张（本目录 `layout-fill-*.png`）。
- 主代理 `UI-VISUAL-ACCEPTANCE` 待 Lead 真实页面审阅后回填；本页截图仅工程自验。

## 提交

本记录与修复同一交付提交入库（`git log --oneline -1` 可核对提交 SHA）；集成人按 PR/合并提交回填任务卡 `integration_ref`。运行产物（含 `browser-results.json` 的 attachment 源）在隔离 run 目录，索引目录只保留报告与必要截图/几何快照。
