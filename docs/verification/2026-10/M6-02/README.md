# M6-02 涨幅百分比随指针显示验证记录（2026-10-05）

- 任务：M6-02 每根 K 线涨幅百分比随鼠标指针显示
- 基线：main `53b23717ab7528e2fe23bcd7b101941a08be43e7`（M6-01 已合入；开工前工作树干净）
- 实现位置：`web/src/phasePrice.ts`（formatPercentBadge 纯函数＋PercentBadge 类型）、`web/src/components/KlineChart.vue`（徽标 ref/DOM/十字线订阅/mouseleave＋onPointerMove 兜底/键盘与复位联动/样式/journey 探针 pctBadge()）
- 行为矩阵：工作区 `.zcode/skills/ai-harness/matrix/candle-percent-hover.yaml`（PCT-VALUE-CORRECT / PCT-COLOR-CONVENTION / PCT-FOLLOWS-POINTER / PCT-FIRST-BAR / PCT-REPLAY-PARITY / PCT-NO-INTERFERE 六行全部 covered，check-binding --strict exit 0）

## 独立 oracle

- 来源：架构师预计算（任务卡 2026-10-05 冻结），**不来自实现**。收盘价序列 [10.00, 10.50, 10.29, 10.29, 9.80, 10.00] → 期望徽标：

| i | 收盘 | 前收 | 期望 text | 期望 cls |
|---|---|---|---|---|
| 0 | 10.00 | —（首根） | `--` | pct-flat |
| 1 | 10.50 | 10.00 | `+5.00%` | pct-up |
| 2 | 10.29 | 10.50 | `-2.00%` | pct-down |
| 3 | 10.29 | 10.29 | `0.00%` | pct-flat |
| 4 | 9.80 | 10.29 | `-4.76%`（9.80/10.29−1=−4.7614…%） | pct-down |
| 5 | 10.00 | 9.80 | `+2.04%`（10.00/9.80−1=+2.0408…%） | pct-up |

- 执行代理另行手工复算核对（浮点：10.29−10.50=−0.21000000000000085 → −2.000000000000008% 归 −2.00%；0.19999999999999929/9.8 → +2.0408…% 归 +2.04%），并独立手算补充 oracle：前收 0/NaN/null/undefined 与当前价缺失 → `--`（除零保护）；±0.004%（10000→10000.4 / 10000→9999.6）两位小数归零 → 无符号 `0.00%`（不得 `-0.00%`）；+10.00% / −9.09%（10→11 与 11→10）/ +0.91%（3.30→3.33 进位）。
- 测试 `server/test/percent-hover.test.ts` 以内嵌常量断言；断言路径经 ts.transpile 提取执行 `web/src/phasePrice.ts` 真实导出（沿用 kdj-indicator.test.ts 模式），未在测试里复制实现。e2e 用同一冻结公式对实时 TDX 数据独立计算期望（oracleBadge 不调用页面实现）。

## RED → GREEN

- RED：实现未加时 `percent-hover.test.ts` 4/4 失败（`formatPercentBadge 未在 phasePrice.ts 导出`——报错即"缺实现"本身）。
- GREEN：实现后 4/4 通过。挂载/跟随/隐藏/回放一致/不干扰语义由 `frontend-contract.test.ts` M6-02 源码契约块＋`e2e/percent-hover.spec.ts`（真实浏览器 3 例：训练悬停文本/配色/pointer-events/不遮轴/离开隐藏/localStorage 不变；键盘十字线驱动＋徽标可见时框选照常缩放；导出→导入录制的真实回放视图按回放序列计算＋滚到回放首根 `--`）锁定。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| 徽标单测 | `npx vitest run --config server/vitest.config.ts server/test/percent-hover.test.ts` | 4/4 通过（exit 0） |
| 定向四件套 | `npx vitest run --config server/vitest.config.ts server/test/percent-hover.test.ts server/test/frontend-contract.test.ts server/test/kdj-indicator.test.ts server/test/recording-chart.test.ts` | 51/51 通过（exit 0） |
| 构建 | `npm run build`（vue-tsc＋server tsc＋vite） | 通过（exit 0） |
| 浏览器回归 | `TDX_ROOT=D:\MySoftWares\TDX npm run journey -- e2e/percent-hover.spec.ts --retries=0` | 3/3 通过（exit 0；run `38f6697b-18a9-4edd-9b6d-0b0afdf9ea13`，截图 percent-hover-down-bar.png / percent-hover-replay-first-bar.png） |
| 关联 spec | 同上跑 `e2e/pane-resize.spec.ts` | 6/6 通过（exit 0；run `f5d9e978-420d-4459-84d1-cac06960cbd4`） |
| 绑定检查 | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix <skill>/matrix/candle-percent-hover.yaml --strict` | covered=6 open=0 RED=0（exit 0） |
| 台账 | `node <skill>/scripts/gate-report.mjs --task M6-02 --gate unit=0 --gate build=0 --gate e2e=0 --gate binding=0 --note …` | 已写入 `ai-harness-lab/harness-state.jsonl` |

## 定向变异抽检（paper_only）

1. 颜色档对调（pct-up↔pct-down）：i1 期望 cls=pct-up 变 pct-down → 被 `formats the badge text and class against the architect oracle close series` 杀死。
2. 删除归零分支（小涨跌照带符号输出）：10000→9999.6 得 "-0.00%" ≠ "0.00%" → 被 `rounds tiny moves to a sign-less 0.00% flat badge (never "-0.00%")` 杀死。
3. 删除前收 0/非有限守卫（照常除法）：prev=0 得 "Infinity%" ≠ "--" → 被 `treats a missing or unusable previous close (null/undefined/0/NaN) as the first-bar placeholder` 杀死。
4. 删除 mouseleave/兜底隐藏：指针移出后徽标残留 → 被 e2e `percent badge follows the pointer with oracle text, CN colors, no persistence, and hides on leave`（两次 toHaveCount(0)）杀死。
5. 徽标状态外发（emit/持久化）：被契约块负向断言（`defineExpose` 不含 pctBadge、无 emit 引用 pctBadge）＋ e2e localStorage 快照逐字节比对杀死。

## 实现要点与踩坑沉淀

- klinecharts 10.0.3：`subscribeAction('onCrosshairChange', cb)` 的 payload 是原始 `{x, y, paneId}`（宿主坐标系），**不含** dataIndex/kLineData，dataIndex 需自行 `convertFromPixel` 并按库内 setCrosshair 口径钳制到 [0, length−1]（越界锚首/末根），否则最左缘十字线与徽标指向不同 K 线。
- 库在指针离开图表/移到价格轴/时间轴/分隔条时**清除十字线但不派发 onCrosshairChange**（setCrosshair() 无 paneId 直接跳过派发；程序化 executeAction 走 notExecuteAction 也不通知订阅者）——隐藏必须另做：host mouseleave ＋ window pointermove 兜底（outside/价格轴/非绘图 pane 即隐藏）。
- 键盘十字线（moveCrosshair 的 executeAction）同样不通知订阅者：徽标须在 moveCrosshair 内直接调 updatePctBadge；resetView/feedData 显式清除。
- e2e 踩坑一：`visibleRange().from` 会低估实际屏上首根（左侧柱 pointToPixel 可为负，实测 887→x=−82）——悬停目标必须按屏内像素挑选，不能拿 from 当屏上首根（首根 `--` 用例因此在回放视图滚到真实 index 0 后断言）。
- e2e 踩坑二：本工程滚轮口径 `scrollByDistance(deltaY)` 为**正值向更早 K 线平移、负值向右侧空白区平移**（实测 wheel(0,−2000) 后 realTo 越过数据末尾）——滚到序列开头要用正 deltaY。
- 训练视图动态补历史（fetchEarlier 分批前插）使绝对首根不可达，首根 `--` 的 e2e 落在回放视图（回放不传 fetchEarlier，序列有限）；数值语义另由单测直锁。

## 已知边界与登记

- 徽标视觉样式（字号 11px/边框/背景令牌/锚点偏移 +12,+16）为工程默认实现，属呈现细节，用户验收时可调；配色三值为冻结 oracle（与 phasePriceColor/MACD/VOL 同源）。
- 拖拽画线/滚轮平移期间（库不重派 onCrosshairChange 的场景：consumed 移动、同像素滚动）徽标停留最后一次更新位置，直至下一次十字线事件或指针移动重建；徽标 pointer-events:none 不拦截任何交互，纯视觉残留，未在矩阵行范围内。
- 训练页喂新 K 线（feedData）时徽标即时清除，等待下一次十字线事件重建（旧文本对应旧序列，不保留陈旧值）。
- 存量失败登记（非本任务回归）：`e2e/journey.spec.ts` Act4d overlayInfo 探针缺陷沿自 M6-01 记录（基线同败）；本任务未跑全量 journey.spec，改动面（KlineChart 指针路径新增只读分支）由 pane-resize 6/6 与本套件 3/3 覆盖。
- check-binding 索引对新文件的可见性：新增 `server/test/percent-hover.test.ts`、`e2e/percent-hover.spec.ts` 已 `git add -N`（intent-to-add）纳入索引；未 commit，提交由架构师复核后进行。

## 复现要点

- journey 浏览器回归需要 `TDX_ROOT` 指向本机通达信目录（运行器不读 saved-tdx-choice.json，须显式传 env）。
- 回放用例自建训练（600519 / 1Y / 2025-01-02）→ 页面导出录制 .json.gz → 训练录像页导入，不依赖外部夹具。
