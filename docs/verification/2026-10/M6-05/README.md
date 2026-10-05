# M6-05 账户权益/收益率 Odometer 验证记录（2026-10-05）

- 任务：M6-05 训练账户面板"账户权益"大数字与"收益率"百分比数字滚动动画（Odometer 风格，自研、零新增依赖）
- 基线：main `ef956f5`（开工前工作树干净；锚定问题 A1=`web/src/theme.ts`、A3=CHANGELOG＋任务卡）
- 实现位置：`web/src/odometer.ts`（纯逻辑模块：格式化/时长/采样/中断重定向计数器）、`web/src/views/Training.vue`（双层接线：rAF 采样泵＋数字位渲染＋watch 触发）、`web/src/styles.css`（odo-* 视觉层样式＋reduced-motion 兜底）
- 行为矩阵：工作区 `.zcode/skills/ai-harness/matrix/account-odometer.yaml` 6 行全部 planned→covered（`check-binding --strict --include-untracked` exit 0；本矩阵无 proposed_default，全闭合）

## 独立 oracle

- 规约来源＝用户 2026-10-05 验收拍板（任务卡冻结）：仅两数字生效；每位数字竖直滚动；时长与幅度成比例且封顶（建议 300~600ms）；连续变化＝中断重定向不排队不重放；终值精确＝账面值、格式与现状一致；prefers-reduced-motion 直显终值；样式不变；禁新增依赖。
- 架构师 oracle（内嵌 `server/test/odometer.test.ts`，不从实现反推）：
  - 终值格式：`1002345.67 → "¥1,002,345.67"`；整数 `1000000 → "¥1,000,000"`（maximumFractionDigits 口径＝现状）；`+0.23%` / `-1.50%` / 零 `+0.00%`。
  - 中断重定向：`1000000→1000100→1000500→1001200→1002000→1002345` 五连发后动画目标＝1002345 且无排队。
  - 作用域：可用资金/持仓市值等无动画（契约源码切片＋e2e DOM 探针）。
- e2e 期望值来源＝服务端账面值（`GET /api/trainings/:id/bars?tf=1D` 的 `account.equity`，不经页面实现）＋测试侧冻结公式（`toLocaleString('zh-CN',{maximumFractionDigits:2})` / `toFixed(2)` 带符号）独立计算终文本。

## "无排队帧"断言口径（实现轮冻结，写明理由）

1. 计数器仅持单一计划且 `startMs`＝最后一次 setTarget 时刻（替换而非追加）；
2. 帧序列（16ms 步进）单调趋向最终值、永不越过目标；
3. 最后一次 setTarget 后 `MAX_ROLL_MS`(600ms) 内收口（`rolling()===false` 且 displayed 精确＝终值）。
   理由：排队/重放实现需在最后一次 setTarget 后再轮到并播完 ≥5×300ms，600ms 封顶必然超时；中断重定向只播"当前显示值→最新目标"一段（≤封顶时长），必然满足。三条件中①是结构断言、②③是行为断言，互为印证。

## 动画与既有测试断言的共存策略（任务要求调研后决策）

- 决策：**真实文本节点（.odo-text）始终写终值；动画走 aria-hidden 视觉层（.odo-roll）**。
- 依据：检索全部 e2e/spec 与 server 测试，当前没有既有断言直接读这两个数字的文本（无 `.equity-block strong`/权益文本断言）；但 e2e/journey 等按 textContent 断言文本是既有惯例（toHaveText/textContent），若把滚动中间值写进真实文本节点，动画期间的任何读取都会拿到中间值、且数字位条带（0-9 竖排）会把 textContent 污染成 "0123456789…" 串。双层方案让任何时刻读取＝精确账面值，未来新增文本断言天然免疫动画。
- 视觉层收尾时序：终帧后先渲染终值列、再延迟 `ODO_SETTLE_MS=120ms`（> 条带 CSS 过渡 80ms）卸下视觉层，条带滚到位才切回真实文本，消除切换瞬间错位闪烁。
- 对齐：视觉层与真实文本同字体栈（Segoe UI 数字等宽 → 数字位列宽＝真实数字 advance）、同行框（`height:1lh`＋`vertical-align:top` 使数字位基线与文本基线重合，推导记录见下）；样式只继承宿主 strong/em，未新增字号/颜色声明。

## RED → GREEN

- RED：`server/test/odometer.test.ts` 先行（7 用例），实现未建时 7/7 失败（`ENOENT: web/src/odometer.ts`）。
- GREEN：实现 `odometer.ts` 后 7/7 通过；契约块（frontend-contract M6-05 两用例）与 e2e（odometer.spec.ts 两用例，journey 前已 `git add -N`）随后全绿。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| 定向单测 | `npx vitest run --config server/vitest.config.ts server/test/odometer.test.ts server/test/frontend-contract.test.ts server/test/percent-hover.test.ts server/test/kdj-indicator.test.ts server/test/recording-chart.test.ts` | 68/68 通过（exit 0） |
| 类型＋构建 | `npm run build`（vue-tsc＋tsc＋vite） | 通过（exit 0） |
| 新增 e2e | `TDX_ROOT=D:\MySoftWares\TDX npm run journey -- e2e/odometer.spec.ts --retries=0` | 2/2 通过（run `0bbfd11c`；截图 odometer-settled.png） |
| 关联 e2e | 同上跑 `e2e/percent-hover.spec.ts` ＋ `e2e/journey.spec.ts` ＋ `e2e/training-range.spec.ts` | percent-hover 3/3、training-range 7/7、journey 14/15（run `9e37f9b1`） |
| journey 唯一失败 Act4d | stash 全部 M6-05 改动后在干净 HEAD `ef956f5` 复跑 `npm run journey -- e2e/journey.spec.ts -g "Act4d"` | 同样失败（run `abdd4f11`）→ **存量失败**（属 GITHUB-HEALTH-01 记录的 29 处已知失败），非本模块回归；stash 已 pop 恢复 |
| 绑定检查 | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix account-odometer.yaml --strict --include-untracked` | covered=6 open=0 RED=0（exit 0） |
| 台账 | `node <skill>/scripts/gate-report.mjs --task M6-05 --gate …` ＋ `--event matrix-change` | 已写入 `ai-harness-lab/harness-state.jsonl`（2 条） |
| 状态对账 | `npx tsx scripts/workflow/state-cli.ts task --control-root ../.control --id M6-05 --status review …` | M6-05→review（active_task=M6-05） |

## 定向变异抽检（paper_only）

1. 终值去精确化（`sampleRoll` t≥1 改为公式值不落 target）：浮点残留被 `expect(sampleRoll(plan,370)).toBe(1002345)` 严格 toBe 杀死（'samples an eased roll…'）。
2. 排队实现（setTarget 不替换旧计划直到播完）：五连发用例 `plan.startMs===240` 与 `rolling(840)===false` 被杀（'redirects five rapid setTargets…'）。
3. 回卷重放（中断后 from 重置为初始值 1000000）：`1000000 < displayed(240) < 1002000` 连续性断言被杀（同上用例）。
4. 时长封顶删除（rollDurationMs 线性不设上限）：`[5,1e9,100] → ≤600` 边界断言被杀（'freezes the duration bounds…'）。
5. 作用域越界（account-stats 也接 odo 结构）：契约源码切片 `accountStats not.toMatch(/odo-/)` 与 e2e 探针 `probe.others===false` 被杀。
6. reduced-motion 失守（删组件判定或 CSS 兜底其一）：契约字面量断言（matchMedia＋媒体查询两处）与 e2e `probe.equity===false` 分别被杀——单删一道防线仍被另一道＋e2e 兜住。
7. 格式漂移（formatEquity 改两位定长/丢 ¥ 前缀）：`formatEquity(1000000)==='¥1,000,000'` 等逐字断言被杀。

## 实现要点与踩坑沉淀

- **`.equity-block span` 污染**：现有规则 `.equity-block span, .account-stats span { display:block; color:#8a98a9; font-size:11px }` 与 dark 变体 `body.dark .equity-block span` 会命中所有数字 span。odo 样式块置于 styles.css 末尾、光/暗双档显式重置（dark 变体特异性 (0,3,1) 恒压过污染规则），数字位样式只 `inherit` 宿主 strong/em。
- **基线对齐推导**：数字列 inline-block（overflow:hidden）默认基线＝底缘，会把数字抬高半个行高；改用 `vertical-align: top`＋`height:1lh` 使列顶＝行框顶，列内 1lh 单元格的字形基线与真实文本基线重合（列内每格自带上同偏移，条带平移整格不失配）。`lh` 单位需 Chrome/Edge 109+（与应用目标环境一致）。
- **数字等宽前提**：字体栈首选 Segoe UI 数字默认等宽（tabular），数字位列宽（＝条带最宽数字）与真实文本中数字 advance 一致；若未来换比例字体的字体栈，需给视觉层补 `font-variant-numeric: tabular-nums`（契约已用"odo 样式块无字号/颜色声明"间接锁定现状）。
- **触发链**：`watch(account.equity)`/`watch(returnPct)` → `counter.setTarget`（中断重定向，注入 `performance.now()`）→ 单一 rAF 泵逐帧采样渲染两处视觉层；`load()` 重取同值时 `rollDurationMs=0` 不播动画；挂载用 `createRollCounter(初始值)` 静止起步（首屏无动画）。
- **组件卸载清理**：cancelAnimationFrame＋两个 settle 定时器清理，防后台页 rAF 暂停后的悬挂。

## 未覆盖边界（如实登记）

- ODO-STYLE-UNCHANGED 的 L2 范围＝样式类/结构层（样式只继承宿主、¥ 前缀与 up/down 绑定不变、span 污染已重置）；像素级滚动观感（节奏是否"不违和"）与深浅主题下的肉眼效果留待用户验收。
- 快速推进的"中断"在 e2e 中未逐帧验证（推进往返 > 单次动画时长时中断未必发生）——中断语义由单测五连发场景锁定，e2e 只锁"动画播过＋终值正确＋越界无动画"。
- 收益率正负翻转瞬间（up/down 类同帧切换）颜色立即变、数字继续滚——与"颜色随账面值即时变"的现状一致，未做颜色过渡（规约未要求）。
- 动画时长量纲（权益 1% 相对幅度到封顶、收益率 5 个百分点到封顶）＝呈现类默认，已按 300~600ms 冻结区间实现，具体节奏待用户验收拍板。
