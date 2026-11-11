# CHART-MEASURE-04 验证记录（2026-11-12）

任务：可发现的测量工具（顶栏入口＋拖动/两次点击建立）；见[任务卡](../../../work-items/tasks/CHART-MEASURE-04.md)。

## 结论

工程自验通过：RED→GREEN 定向 journey、构建、定向单测、docs、impact、binding；PR #38 只读评审的三项 Important（I-1/I-2/I-3）与 M-1/M-4/M-5/M-7 已按下方「评审整改」逐条修复并复跑。冻结算法的数据窗口（RangeMeasurement/chartStatistics）零改动，字段与既有 Shift 两点测量逐条相等。视觉检查（深浅主题、桌面尺寸、真实操作）由主代理完成，本记录附自验截图供检查。未决/边界见文末。

## 实现摘要

- 入口：Training.vue 顶栏「划线」旁新增「测量」toggle（lucide Ruler 尺子图标、aria-pressed、中文 aria-label/title；1024×680 下落为 26px 图标入口，可访问名称保留），进入后按钮高亮、状态条显示「测量模式」、图上提示「测量模式：拖动或两次点击选择起止K线，Esc 退出」、光标十字。
- 建立：KlineChart.vue 新增 `measureMode` prop / `measureChange` emit，沿既有 host pointerdown capture＋window pointermove/pointerup 链新增测量手势——拖动期间只增长 Select Box 预览（`.range-measure-preview`），松手才出数据窗口；两次点击第一次复用既有 `measurementAnchor`（本任务补上其虚线竖线渲染 `.range-measure-anchor`），第二次建立区间。起止索引排序归一；再次拖动/点击替换旧值，模式保持。
- 复用：数据窗口、Select Box、可拖边界、统计源（当前周期 chart.getDataList()）与镜像真实价口径全部沿用 CHART-MEASURE-02/03，未改 `chartStatistics.ts` 与 `RangeMeasurement.vue`。
- 退出/仲裁：Esc 一步退出并清除；再点按钮/切周期/结束训练/进入画线工具或多选模式退出并清除；滚轮/缩放/平移/失焦/可见范围变化/副图指标开关切换沿用既有 closeMeasurement 只清当前测量；分隔条/价格轴/时间轴拖动（CHART-PAN-01）/绘图取点/多选/Ctrl-Alt-Meta 优先；模式内主图空白左拖改为建立测量（不再框选缩放）；训练热键（推进/买卖/删除）在测量模式内按**应用可配置键位**被吞（Training 键盘入口）。
- 只读探针：journey 模式 `__trainerChart.mode().measure` 与新增 `measurementTool()`（mode/anchor/range）；生产构建不注入。

## 评审整改（PR #38 只读评审，2026-11-12）

- **I-1（训练热键吞按可配置键位）**：删除 KlineChart 内硬编码 `event.code==='Space'` / `b/B/s/S` / `Delete` 判定，改为 Training.vue 键盘入口用既有 `isShortcut('advance'|'buy'|'sell'|'deleteDrawing')`（keyboardShortcuts，按 event.code＋按下的修饰键集合）吞键；`isTyping`（含 isComposing、input/textarea/select/contenteditable）已在入口提前返回，`matchesActionShortcut` 内部再守 isComposing/isRepeat。KlineChart 只保留 Esc 与「已建立测量时激活期间全吞」既有分支。新增 e2e：真实 PUT /api/settings/shortcuts 把 buy 改绑 KeyQ → 测量模式内 Q/B/Space/Delete 均不成交；条件单理由输入框聚焦可正常输入 `q b s `；退出模式后按 Q 买入成交（证明改绑生效、上面的不成交来自模式内吞键）。
- **I-2（失焦/窗外松键幽灵预览）**：新增 `cancelMeasureGesture()`，window blur、pointermove 检测 `event.buttons===0`、pointercancel、模式关闭与指标开关统一走它；blur 同时 closeMeasurement。新增 e2e：拖动中切到另一页（双页真实失焦）→ `.range-measure-preview` 消失且无半成品测量，回到页面松键后仍无幽灵预览、模式保持、可正常再建立。
- **I-3（证据表格如实）**：修正下文本文件 GREEN 表：删除不存在的「chart-analysis-only 通过 run」行；`run-df776de4` 明确记为整轮 15 例 13 passed/2 failed（chart-analysis 子集 9/9，非独立命令）；整体绿色改用 `run-4183bacc`/`run-977cb2f1`/`run-d6484028` 与整改后 `run-19cdac39`。任务卡「本轮交付」同步修正。
- **M-1（指标开关清测量）**：KlineChart 副图指标 watch 显式 `cancelMeasureGesture()+closeMeasurement()`；precedence 用例补断言：建立测量→点 KDJ 开关→窗口消失、模式保留、无陈旧 Select Box→再点恢复。
- **M-4（run 清单诚实标注）**：GREEN/迭代表为每个 run 标注 manifest.commit 与是否未提交工作树；截图改为从**整改后** run `run-19cdac39` 归档（此前归档来自 run-d6484028/run-977 的说明见「视觉检查」）。
- **M-5（文案）**：用户指南补「从没有数据窗口/边界手柄的空白 K 线处起手建立新测量」与「数据窗口内 Esc＝退出测量模式」；`RangeMeasurement.vue` 增加 `measureMode` prop，面板脚注在模式内改为「Esc 退出测量模式，再次拖动/点击可建立新测量」（Shift 两点测量仍为「Esc 关闭」）。
- **M-7（MA 模态优先）**：`onPanelKeydown` 开头先判 `maSettingsOpen`（原生模态接管 Esc/输入），再判测量模式 Esc，避免 MA 设置弹层打开时 Esc 先退出测量模式。

## RED（先失败测试）

`$env:TDX_ROOT='D:\MySoftWares\TDX'; npm run journey -- e2e/measure-tool.spec.ts --retries=0`

- run id：`run-0aa7c954-0d59-404e-b238-f77cf918a2ff`，**6 failed**。
- 正确原因失败：前 5 例 `waiting for getByRole('button', { name: '测量', exact: true })`（入口不存在）；第 6 例 `expect((await mode()).measure).toBe(false)` 实得 `undefined`（模式探针未接线）。
- 首跑构建耗时约 11 分钟（共享机器三路并发 journey），非断言等待；证据 `.runs/<id>/artifacts/journey.log` 保留。

## 迭代记录（失败保留）

`run-df776de4-b023-4bcd-92fc-8816d8a2c8c1`（manifest.commit=7895a22，未提交工作树）：**整轮 15 例 13 passed / 2 failed**；其中 chart-analysis 子集 9/9 全绿（既有 Shift 两点测量零回归），不存在 chart-analysis-only 的独立通过 run。2 例失败是**测试自身**覆盖层交互问题：反向拖动/反向点击的起点落在已建立测量的边界手柄（既有 CHART-MEASURE-03「边界可拖」语义正确优先）或数据窗口覆盖区，导致没有进入新建立路径。修正为：反向归一先 Esc 退出再重新进入（正/反向各自独立建立），替换建立点放在既有 Select Box 左侧空白——未删除/放宽任何产品断言。

`run-1481e5a2-89c8-4ca0-aa77-8fbb35ff8609`（manifest.commit=a87d296，整改工作树未提交）：**整轮 17 例 16 passed / 1 failed**。失败为**测试自身**前置条件缺失：I-1 新用例用普通训练创建（`orders_enabled` 默认关）导致「条件单」标签页不存在，无默认动作超时的 `click` 挂起到 240s 测试上限；失败保留。修法：该用例改用 `orders_enabled: true` 创建训练并给交互显式 20s 超时；修复后 `run-19cdac39` 17 passed。

`run-19cdac39-b4dc-4c08-ad34-beec943fa742`（manifest.commit=a87d296，整改工作树未提交）：**整轮 17 例 passed (2.1m)**（measure-tool 8 例＋chart-analysis 9 例）；本文件归档截图取自该 run。

## GREEN（定向）

被跑树以 run manifest 的 `commit` 字段为准；「未提交工作树」表示 manifest commit 之后仍有未提交改动（该 run 构建自工作树）。

| 命令 | 退出码 | run / 结果（manifest.commit / 工作树） |
|---|---|---|
| `npm run journey -- e2e/measure-tool.spec.ts --retries=0`（整改前，仅 measure-tool 6 例） | 0 | `run-4a06f420-f7d3-4e2f-8115-eb258bb46c38`：**6 passed (48.5s)**；manifest.commit=7895a22，未提交工作树 |
| 整改前合跑 `npm run journey -- e2e/measure-tool.spec.ts e2e/chart-analysis.spec.ts --retries=0` | 0 | `run-4183bacc`（panelChange 小修前）/ `run-977cb2f1`：各 **15 passed**，manifest.commit=7895a22，未提交工作树；`run-d6484028`（合并 origin/main 后）：**15 passed (1.9m)**，manifest.commit=1dadcc9（合并提交，工作树干净） |
| 整改后合跑同命令（measure-tool 8 例＋chart-analysis 9 例） | 0 | `run-19cdac39-b4dc-4c08-ad34-beec943fa742`：**17 passed (2.1m)**；manifest.commit=a87d296，整改工作树未提交；本文件截图取自该 run |
| 反向记录（不作为通过证据） | 1 | `run-df776de4` 整轮 13 passed/2 failed；`run-1481e5a2` 整轮 16 passed/1 failed（均为测试自身问题，已修，见迭代记录） |

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
| `npm run docs:impact -- --base 7895a22 --task CHART-MEASURE-04` | 0（11 路径，4 运行代码路径，0 errors/0 warnings；整改前） |
| `npm run docs:impact -- --base 8eec4cf --task CHART-MEASURE-04`（合并 main 后，相对新主线只算本任务差异） | 0（15 路径，4 运行代码路径，0 errors/0 warnings；整改前） |

| `check-binding --strict --include-untracked --matrix chart-measurement.yaml` | **3（预期）**：covered=6、open(未闭合)=3、RED=0；未闭合 3 行＝Lead 预登记的 MEASURE-TOOL-ENTRY / MEASURE-TOOL-DRAG-CREATE / MEASURE-TOOL-PRECEDENCE（planned），按纪律由 Lead 用下方 test_ids 升 covered，worker 不改 matrix |
| `npm run build`（含 vue-tsc 类型检查） | 0（verify:fast 内） |
| `npm run verify:fast -- --unit server/test/chart-statistics.test.ts --journey e2e/measure-tool.spec.ts e2e/chart-analysis.spec.ts` | 0（155s；docs:check/build/unit/journey 全 PASS） |

## 矩阵行 test_ids（供 Lead 升 covered）

- MEASURE-TOOL-ENTRY：
  - `e2e/measure-tool.spec.ts::测量入口在顶栏可见、可键盘切换，1024×680 深浅主题下顶栏不溢出`
- MEASURE-TOOL-DRAG-CREATE：
  - `e2e/measure-tool.spec.ts::拖动建立区间测量：实时预览、松手出窗口、反向归一、边界可拖、字段与 Shift 完全一致且不写数据`
  - `e2e/measure-tool.spec.ts::两次点击建立区间测量：首次点击虚线锚点提示、反向归一、再次建立替换旧值`
  - `e2e/measure-tool.spec.ts::测量拖动中窗口失焦取消预览，不留幽灵 Select Box`（评审 I-2 新增）
- MEASURE-TOOL-PRECEDENCE：
  - `e2e/measure-tool.spec.ts::测量模式的互斥与仲裁：画线/多选互斥、热键被吞、滚轮/价格轴/时间轴/切周期按既有路径清理`（含评审 M-1 指标开关断言）
  - `e2e/measure-tool.spec.ts::测量模式内训练热键按应用可配置键位判定：改绑买卖键不成交、输入框可正常输入`（评审 I-1 新增）
  - `e2e/measure-tool.spec.ts::多空反转开启时测量模式仍按真实价计算与显示`
  - `e2e/measure-tool.spec.ts::只读回放：新模式不启用且零报错，既有 Shift 测量仍只读可用`

## 视觉检查（主代理）

自验截图（1024×680 顶栏入口深浅主题、1440 数据窗口、镜像窗口）归档到本目录，来源＝整改后 run `run-19cdac39` 的 `.runs/<id>/artifacts/screenshots/`（此前版本归档自 run-d6484028/run-977，整改后已按最终代码重跑并替换）。主代理仍需在真实页面做深浅主题、桌面尺寸、溢出与状态切换检查（UI-VISUAL-ACCEPTANCE）。

## 环境与边界

- 隔离 journey run：动态端口、独立 SQLite、独立前后端构建；TDX_ROOT=D:\MySoftWares\TDX；未使用个人训练库。
- **环境事故（保留记录）**：03:08—03:11 之间主检出共享 `node_modules` 因工作树清理穿过 junction 被部分删除（缺失 `.bin`、`.package-lock.json`、`@babel/parser`），本轮一次门禁复跑 4 项全部以 `'tsx'/'vue-tsc'/'vitest' is not recognized` 快速失败（保留于会话记录）。Lead 已定位根因并在主检出用 `npm install --ignore-scripts --prefer-offline` 修复（exit 0，package-lock 与工作树无改动），随后本轮按正常 `npm run` 入口重跑，得到上表 run `run-977cb2f1` 全绿。该失败记录属环境事故，不是产品断言失败，也未用其冒充通过。
- 未改冻结算法/未被本任务允许的共享模块；未改 matrix、未改 SessionReplay.vue。
- 边界 1：回放页本轮不加「测量」顶栏入口（SessionReplay.vue 不在本任务 allowed_paths；Lead 2026-11-12 确认：回放只读可用口径＝既有 Shift 测量仍通过＋新模式代码零报错/零写请求，若用户验收要求一键测量另立卡）。measure-tool 回放用例断言 `mode().measure === false`、Shift 测量 11 根窗口可用、写请求为空、无 pageerror。
- 边界 2：模式内点击已建立测量的**数据窗口区域**不会建立新测量（窗口是可交互 UI）；边界手柄仍优先调整起止 K 线（既有语义）。
- 边界 3：切周期＝退出模式并清除（Lead 口径）；滚轮/缩放/平移/失焦只清除当前测量、保留模式。
- 失败与 RED/迭代 run 保留在 `.runs`（不提交）。

## 提交

- 特性提交：`5e987c9` `feat(chart): CHART-MEASURE-04 新增顶栏测量工具入口与拖动/两次点击建立`（分支 `task/CHART-MEASURE-04`，基于 main@7895a22）。
- 合并提交：`1dadcc9` 合并 origin/main `8eec4cf`（CHART-LAYOUT-01）；`docs/status.md`/`e2e/README.md`/`KlineChart.vue` 均自动合并，合并后 `docs:status` 重生成零差异、双向条目保留。
- 评审整改提交：PR #38 的追加修复提交，SHA 与提交树门禁收据见文末「整改后最终门禁」追加记录（本文件随该提交一起进入历史，随后补充）。
- 本记录为工程自验，不代表用户验收；视觉检查仍由主代理按 UI-VISUAL-ACCEPTANCE 复核。
