# M6-03 悬浮信息卡验证记录（2026-10-05）

- 任务：M6-03 K 线悬浮信息卡（停留 1 秒触发、含开高低收与涨幅、左上角只留均线）
- 基线：main `45bd47a`（M6 验收反馈任务开工提交；开工前工作树干净，锚定确认 `git log -1`）
- 实现位置：`web/src/phasePrice.ts`（formatHoverCard 纯函数＋HOVER_CARD_DWELL_MS 冻结常量）、`web/src/components/KlineChart.vue`（hoverCard ref/停留状态机/位置钳制 placeHoverCard/键盘即时 showHoverCardNow/mouseleave＋onPointerMove 兜底/复位与换数据清除/样式/journey 探针 hoverCard()）、`web/src/theme.ts`（candleLegendTemplate 置空＝左上角只留 MA）
- 行为矩阵：工作区 `.zcode/skills/ai-harness/matrix/candle-percent-hover.yaml`（v2；PCT-VALUE-CORRECT/PCT-COLOR-CONVENTION/PCT-FIRST-BAR/CARD-DWELL-DELAY/CARD-CONTENTS-OHLC/CARD-POSITION-NO-OCCLUDE/CARD-CORNER-MA-ONLY/CARD-KEYBOARD-INSTANT/PCT-REPLAY-PARITY/PCT-NO-INTERFERE 十行 covered；CARD-EXTRA-FIELDS 保持 proposed_default；check-binding --strict --include-untracked：covered=10 open=1 RED=0，exit 3＝仅剩待拍板行）

## 独立 oracle

- 涨幅口径沿用 v1 冻结序列（架构师预计算）：收盘 [10.00,10.50,10.29,10.29,9.80,10.00] → `--`/`+5.00%`红/`-2.00%`绿/`0.00%`灰/`-4.76%`绿/`+2.04%`红（server/test/percent-hover.test.ts 内嵌常量）。
- 卡内容夹具（架构师预计算，任务卡冻结）：bar{date:'2026-08-19', o:10.00, h:10.50, l:9.80, c:10.29}, prevClose=10.00 → 日期"2026-08-19"、开"10.00"、高"10.50"、低"9.80"、收"10.29"、涨幅"+2.90%"（红）。执行代理手工复算：(10.29−10.00)/10.00×100=2.90 精确值，两位小数无舍入争议。
- 补充手算 oracle（执行代理独立于实现）：首根/前收 null → 涨幅"--"灰、OHLC 行照常；下跌日 前收10.00→收9.95 = "-0.50%" 绿；bar 缺失或 OHLC 非有限 → 不产出卡；冻结延时常量＝1000ms。
- 测试经 ts.transpile 提取执行 `web/src/phasePrice.ts` 真实导出（沿用 kdj-indicator.test.ts 模式），不在测试里复制实现；e2e 用同一冻结公式对实时 TDX 数据独立计算期望（oracleCard 不调用页面实现）。

## RED → GREEN

- RED：实现未加时 percent-hover.test.ts 新增 6 用例全败（`formatHoverCard 未在 phasePrice.ts 导出`＝缺实现本身）；frontend-contract M6-03 契约块与 lean-legend 块失败（旧实现仍含 pct-badge/开高低收 legend）。
- GREEN：实现后定向 45/45、全量 112 文件 1441 用例通过。停留/移根重计时/键盘即时/回放一致/不遮轴不压热点语义由 e2e/percent-hover.spec.ts（真实浏览器 3 例）锁定。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| 定向单测 | `npx vitest run --config server/vitest.config.ts server/test/percent-hover.test.ts server/test/frontend-contract.test.ts server/test/kdj-indicator.test.ts server/test/recording-chart.test.ts server/test/drawing-state.test.ts` | 77/77 通过（exit 0） |
| 全量单测 | `npm test` | 112 文件 1441 用例通过（exit 0） |
| 构建 | `npm run build`（vue-tsc＋server tsc＋vite） | 通过（exit 0） |
| 浏览器回归 | `TDX_ROOT=D:\MySoftWares\TDX npm run journey -- e2e/percent-hover.spec.ts --retries=0` | 3/3 通过（run `4efb7cf1-711a-490a-be71-b41b182f2944`；截图 hover-card-dwell-up/down.png、hover-card-replay-first-bar.png） |
| 绑定检查 | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix candle-percent-hover.yaml --strict --include-untracked` | covered=10 open=1（仅 CARD-EXTRA-FIELDS）RED=0，exit 3（预期：待拍板行在 strict 口径计 open） |
| 台账 | `node <skill>/scripts/gate-report.mjs --task M6-03 --gate unit=0 --gate build=0 --gate e2e=0 --gate binding=3 --note …` | 已写入 `ai-harness-lab/harness-state.jsonl` |

## 定向变异抽检（paper_only）

1. 涨幅配色档对调（pct-up↔pct-down）：夹具卡 pct.cls 变 pct-down → 被 `formats the card rows and pct against the architect fixture` 杀死；e2e 计算色 rgb 断言（239,68,68 / 22,163,74）同杀。
2. 停留计时改为同根微动重置（去掉 hoverPendingIndex===dataIndex 早返回）：同一根内指针微动会无限推迟显示 → e2e 第一例"继续停留到 ≥1200ms 可见"（800ms 检查后未再移动鼠标）被杀。
3. 延时常量漂移（1000→2000）：`keeps the frozen dwell constant at 1000ms` 直接杀；e2e 800ms 不可见＋1200ms 可见的时钟断言窗口同杀。
4. 键盘路径误接停留计时（showHoverCardNow 改走 scheduleHoverCard）：e2e `toBeVisible({timeout:600})` 在 600ms 上限内等不到 1000ms 计时 → 被杀。
5. 删除翻左侧分支（右侧不足仍向右放）：绘图区右缘断言 `box.x+box.width ≤ host.x+plotRight+2` 在窄屏/右缘目标下被杀（契约块另锁翻转不等式字面量）。
6. 卡状态外发（emit/持久化/进录像）：契约块负向断言（defineExpose 不含 hoverCard、无 emit 引用）＋e2e localStorage 快照逐字节比对杀死。
7. OHLC legend 回潮（candleLegendTemplate 恢复开高低收）：lean-legend 契约负向断言（模板 400 字符窗口内不得出现 开/高/低/收）被杀。

## 实现要点与踩坑沉淀

- klinecharts@10.0.3 事实（dist 源码核实）：onCrosshairChange payload＝原始指针 {x,y}（未吸附），吸附竖线位置须自行 `convertToPixel({dataIndex})`；键盘 executeAction('onCrosshairChange') 内部 notExecuteAction 不回派事件——moveCrosshair 必须显式调 showHoverCardNow；candle tooltip legend 走模板回调、空数组即不绘制，indicator tooltip legend（MA 数值）独立渲染不受影响。
- 停留状态机以 dataIndex 为键：同根微动仅更新锚点（可见时实时重摆），换根＝取消计时＋隐藏＋重计；卡可见性兜底沿用 v1 的 mouseleave＋onPointerMove（轴区/图表外）双路径，另在换数据（feedData）与复位（resetView）清除。
- 契约正则须容忍 CRLF（仓库源码 Windows 行尾）：`return\n}` 类断言一律 `\r?\n`；源码注释不得含契约负向断言的字面词（"readOnly"曾写进注释被自家断言拦下）。
- e2e 悬停目标纵向留 170px 底部余量：卡在指针下方展开，目标贴底会触发底缘钳位、几何退化（见下）。

## 未覆盖边界（如实登记）

- 指针贴近绘图区底缘（下方放不下卡）时钳位优先于指针热点避让：卡上抬可能与热点区相交（轴保护口径，用户拍板"钳制绘图区内不遮价格/时间轴"优先）；e2e 目标挑选避开该区，未做退化几何断言。
- CARD-CORNER-MA-ONLY 的 L2 为 paper 级：左上角 OHLC/MA 均为 canvas 绘制无 DOM 文本，自动断言锁的是 theme 模板与库渲染路径（dist 源码核实 legends.length>0 才画），像素级确认留给人工验收看截图。
- 回放页的键盘十字线即时显示未单独驱动（回放侧 e2e 为 mouse-dwell；键盘路径与训练页共用同一 moveCrosshair/showHoverCardNow 代码，由训练页用例锁）。
- 移动端/触屏长按、超窄视口（绘图区宽 < 卡宽）的翻侧连锁钳制未做专项断言。
