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

## M6-05R 修复轮（2026-10-05，bug-loop：用户环境动画全程不可见）

### 缺陷与根因（架构师实机定位，证据在案）

- 现象：用户完整训练全程从未见过账户权益/收益率数字滚动。
- 根因：用户机器浏览器 `matchMedia('(prefers-reduced-motion: reduce)').matches === true`（已实测）；`Training.vue` 的 `beginRoll` 以该信号一票否决（提前 return 不建滚动层），`styles.css` 另有 `@media (prefers-reduced-motion: reduce){ .odo-roll{display:none!important} }` 双重抑制。架构师浏览器采样：推进后权益 ¥1,000,000→¥1,000,636 变化、模板重渲染正常，但 `.odo-roll` 层 50 帧零出现。
- e2e 为何绿：Playwright 默认 no-preference 环境，从未在 reduce 环境断言过"用户要求的效果可见"；ODO-REDUCED-MOTION 行按无障碍惯例冻结为"reduce＝跳过"，恰好把用户唯一真实环境判为"应该不可见"。

### 环境调查（为何该环境 reduce=true；未改系统，供追溯）

- 实测事实：用户浏览器（Chromium/Edge 系内核）`prefers-reduced-motion` 报 reduce。
- 已知映射（Chromium/Edge/WebView2 公开行为，未在用户机器上逐项验证）：Windows 设置"动画效果"关闭（设置→辅助功能→视觉效果，旧版入口"轻松使用→不显示 Windows 动画"）⇒ 浏览器报告 reduce；RDP/远程桌面会话与部分省电策略亦会触发。具体属哪一项是用户机器侧配置，留待用户按需自查——修复后动效门已不依赖该信号（逃生阀＝应用开关）。

### 修复设计（架构师拍板，用户 2026-10-05 授权"需要修复"）

- 动效门从 OS 媒体查询改为**应用偏好**：`trainer_odo_motion`（localStorage，'0'＝关，未设置/异常＝默认开＝现状；键名沿用 trainer_* 既有风格）；UI＝训练页顶栏与副图开关同款的"滚动"胶囊按钮（`.indicator-toggle.motion-toggle`，aria-pressed 语义，off＝虚线灰），点击立即生效并持久化。
- `Training.vue`：`beginRoll` 门改读 `appOdoMotion.value`；`prefersReducedMotion()` 删除；`styles.css` 的 odo-roll reduce 抑制移除（其余通用 reduce 规则 shake/ellipsis 不动）。
- **a11y 取舍（写明供追溯）**：功能为用户明确要求的核心反馈、幅度小（≤600ms、纯视觉层 aria-hidden）；OS reduce 在用户唯一真实环境恒为 true，一票否决＝功能不可见；逃生阀＝应用开关（用户拍板 2026-10-05"需要修复"）。

### RED → GREEN（独立 oracle：测试内嵌）

- **RED**：新增 e2e `OS prefers-reduced-motion no longer suppresses the roll while the app motion preference is on (ODO-MOTION-PREF e2e)`——`page.emulateMedia({ reducedMotion: 'reduce' })` 下买入＋推进 3 根，MutationObserver 全程见证 `.odo-roll` 至少挂载 1 帧。修复前复现失败（journey run `7f76ccbe`：`expect(probe.equity, 'OS reduce 下权益滚动层出现过').toBe(true)` 收到 false，1 failed；既有 2 用例同跑仍绿——失败即缺陷本身，非测试问题）。
- **开关关闭路径**：e2e `motion preference off skips the roll entirely and still shows exact final text (ODO-MOTION-PREF off e2e)`——真实 UI 点击"滚动"开关（aria-pressed true→false），买入＋推进后零视觉层、推进完成即读＝账面终值（无动画中间态）。
- **契约**：`gates the odometer roll on the app motion preference, not the OS reduced-motion query (ODO-MOTION-PREF, M6-05R)`——ts.transpile 提取执行 `readOdoMotionPref/writeOdoMotionPref`（独立 oracle：'0'＝关；'1'/未设置/异常＝默认开；写 '1'/'0'；键名 `trainer_odo_motion`），并锁 beginRoll 门字面量、组件/CSS 无 reduce 残留、UI 入口（aria-pressed＋setOdoMotion 点击）。
- 既有 ODO 行为不回归：默认开＋no-preference 下原"快速推进 5 根"用例保持绿。

### R 轮收据

| 项 | 命令 | 结果 |
|---|---|---|
| RED 复现 | `TDX_ROOT=D:\MySoftWares\TDX npm run journey -- e2e/odometer.spec.ts --retries=0`（追加新用例后、修复前） | run `7f76ccbe`：1 failed（probe.equity=false）＋2 passed |
| 定向 vitest | `npx vitest run --config server/vitest.config.ts server/test/frontend-contract.test.ts server/test/odometer.test.ts` | 2 文件 40/40 通过（exit 0） |
| appSettings 共改回归 | 同上跑 `server/test/kdj-indicator.test.ts`（VOL/MACD/KDJ 偏好切片） | 5/5 通过 |
| build | `npm run build` | 通过（typecheck:web＋server＋web；chunk 体积告警为存量） |
| e2e GREEN | 同 RED 命令（修复后） | run `c4d38a16`：odometer 3/3（23.6s） |
| e2e 关联回归 | `npm run journey -- e2e/percent-hover.spec.ts --retries=0` | run `a72c1599`：3/3（26.8s） |
| 绑定检查 | `check-binding.mjs --matrix account-odometer.yaml --strict --include-untracked` | covered=6 open=0 RED=0（exit 0） |
| 全矩阵核对 | 同上跑 matrix/ 全部 5 个矩阵 | account-odometer、chart-toggles exit 0；candle-percent-hover/conditional-orders/kdj-subchart exit 3＝存量 proposed_default/uncovered 开放行（RED=0，与本轮无关，矩阵文件本轮未触碰） |

### R 轮定向变异抽检（paper_only）

1. 门回退为 `prefersReducedMotion()`：e2e ODO-MOTION-PREF（probe.equity=false）＋契约 `/matchMedia\(|prefers-reduced-motion:\s*reduce/` 负向断言分别被杀。
2. 忽略偏好恒播放：e2e off 用例（probe.equity=true）＋契约 `if (!appOdoMotion.value)` 门字面量分别被杀。
3. 仅重加 CSS 抑制（JS 门保留正确）：契约 styles 负向断言被杀。**如实登记 oracle 边界**：e2e 探针杀不死此变异——`display:none` 不移除 DOM 存在性，querySelector 仍命中；CSS 可见性只能锁到契约源码层（L1）。
4. 默认翻转（未设置＝关）：契约 `read({getItem:()=>null})===true` 被杀。

### R 轮踩坑沉淀

- Playwright `page.evaluate` 传函数字符串会被当表达式求值返回空对象——须用 IIFE `(() => …)()`（本套件既有写法为函数体形式，本轮未踩；架构师在 IAB 环境踩坑记录在案，供后续移植参考）。
- 点击工具栏胶囊开关后按钮持焦，随后的 `Space` 会再触发按钮 click 而非推进快捷键（与 VOL/MACD/KDJ 开关一致的既有行为，非本轮引入）——e2e 中点击后显式 `el.blur()` 再推进；用户侧同样表现为"点完开关第一次空格没反应"，属既有交互特性，如需改进另立任务。

### R 轮未覆盖边界（如实登记）

- 真实用户环境的滚动观感（节奏、与 OS reduce 的实际共存）留待用户验收——e2e 的 `emulateMedia` 只模拟信号，不等价用户机器全环境。
- Windows 侧"动画效果"具体配置项未在用户机器实测确认（见环境调查节），属用户侧自查项。
