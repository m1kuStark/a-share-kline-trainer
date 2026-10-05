# M6-06 Odometer 打磨验证记录（2026-10-05）

- 任务：M6-06 滚动中间值不带小数（权益）＋动画前后字宽稳定（tabular-nums）
- 基线：main `274e1d4`（"docs: open M6-06/07 odometer polish and animation settings tasks"；开工前工作树干净；锚点问题 M6-06 A1=`docs/work-items/milestones/M6.md`、A3=CHANGELOG＋任务卡）
- 用户反馈（2026-10-05 验收原文要点）：①滚动中间值出现两位小数（截图 ¥1,000,872.45）而终值无小数（¥1,000,872）；②动画中数字位等宽、播完后比例字宽重排，微小错位。
- 实现位置：`web/src/odometer.ts`（rollDisplayEquity 纯函数）、`web/src/views/Training.vue`（滚动层权益帧接线）、`web/src/styles.css`（两层数字位 tabular-nums）

## 独立 oracle（冻结于任务卡，用户 2026-10-05 拍板）

- 权益滚动中间值与终值同格式：整数元（无小数点）；中间采样先 `Math.round` 再 `formatEquity`。若未来权益出现真实小数（如费用拆分），须随规格变更同步改格式而非默默显示（已写进 odometer.ts 注释）。
- 收益率中间值保持两位小数（与终值一致）。
- 字宽：`.odo-text` 与 `.odo-roll` 全部数字位 `font-variant-numeric: tabular-nums`（含深浅主题）；动画任意帧与收尾后文本宽度差 ≤1px。

## 根因与修复设计

1. **幻影小数**：`formatEquity` 用 `maximumFractionDigits: 2`，缓动中间帧是浮点（1000000+2345×ease(t)）必渲染出小数位。修复＝权益滚动层帧统一 `rollDisplayEquity(value)＝formatEquity(Math.round(value))`：pumpRoll 逐帧＋beginRoll 初帧（经 `equityBinding.format`）；**settle 帧**的 `displayed(now)` 已精确＝账面终值（sampleRoll t≥1 返回 target），保持 `formatEquity` ⇒ 与真实文本层逐字一致、卸层切换零跳变（未来账面真出现小数时 settle 帧仍与终文本一致，仅中间帧按规格取整）。
2. **字宽重排**：动画层每位数字＝0-9 竖排条带，inline-block 列宽＝条带内**最宽**数字；真实文本层＝逐字比例 advance。字体数字非默认等宽时两层宽度分布不同 ⇒ 播完切回真实文本层按比例重排（M6-05 记录的"Segoe UI 数字默认等宽"假设被用户实机观感证伪）。修复＝四选择器（`.odo-text/.odo-char`（真实层）＋`.odo-roll/.odo-digit`（动画层），各含 dark 档，沿用 M6-05 双档重置写法）统一 `font-variant-numeric: tabular-nums`，两层逐字等宽。

## RED → GREEN（独立 oracle：单测内嵌常量＋手算）

- **RED（单测）**：`renders integer-only equity roll frames while return pct frames keep two decimals (ODO-NO-PHANTOM-DECIMALS)`——1000000→1002345 轨迹 16ms 全程采样，`equity roll frame at t=16ms: expected '¥1,000,291.25' to match /^¥\d{1,3}(,\d{3})*$/`（幻影小数逐字复现，与用户截图同型）。
- **RED（e2e）**：`rolling frames stay integer-only and width-stable across the two layers`——真浏览器 DOM 重构滚动层文本（strip transform 读当前数字位，规避 0-9 条带 textContent 污染），`frame[0] text=¥99,999,696.03`（run `6ef03998`，1 failed）。
- **防移除自红设计**：单测在 `rollDisplayEquity` 缺失时回退 `formatEquity` ⇒ 删除该函数（回退旧实现）测试必红；前提成立性断言（`phantomOnFinalFormat===true`）保证本轨迹确有浮点中间帧、断言非空转。
- **GREEN**：实现后定向 vitest 53/53；journey odometer 4/4（run `49dc3de2`）。

## 帧文本重构口径（e2e，实现轮冻结）

视觉层 `.odo-roll` 每位是 strip（内联 `translateY(-Nlh)`，N＝当前显示数字）或 `.odo-char`（¥/千分位逗号）；重构＝char 列直接读 textContent＋digit 列解析 strip transform。逐帧断言：①`/^¥[\d,]+$/`（无小数点）；②`|hostWidth−settledHost|≤1px`；③settle 帧（重构文本＝终文本，两层同串）`|rollWidth−textWidth|≤1px`——**滚动中两层合法显示不同字符串**（视觉层从旧值滚向新值、文本层恒为新终值），逐帧比宽无意义，奇偶校验只做在 settle 帧；④三元素 computed `fontVariantNumeric` 含 `tabular-nums`（删 CSS 声明的确定性杀手，与字体默认渲染无关）。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| RED 单测 | `npx vitest run --config server/vitest.config.ts server/test/odometer.test.ts server/test/frontend-contract.test.ts` | 3 failed（幻影小数＋rollDisplayEquity 缺失＋import 断言）＝RED 收据 |
| RED e2e | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/odometer.spec.ts -g "integer-only" --retries=0` | run `6ef03998`：1 failed（frame text=¥99,999,696.03） |
| GREEN 单测 | 同上五件套（＋training-defaults/training-rules/percent-hover） | 53/53 通过（exit 0） |
| 类型＋构建 | `npm run build` | 通过（exit 0；chunk 体积告警为存量） |
| GREEN e2e | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/odometer.spec.ts --retries=0` | run `49dc3de2`：4/4 |
| 绑定检查 | `check-binding.mjs --matrix account-odometer.yaml --strict --include-untracked` | covered=8 open=0 RED=0（exit 0） |

## 定向变异抽检（paper_only）

1. 回退取整（rollDisplayEquity 删掉或改回 formatEquity 直通）：单测逐帧正则（回退设计自红）＋e2e 逐帧 `frame.text` 正则被杀。
2. settle 帧也取整（settleEquityRoll 改 rollDisplayEquity）：当前账面值为整数时不可区分（等价变异，如实登记）；未来真实小数出现时规格要求同步——由注释＋任务卡口径约束，非断言锁。
3. 删 tabular-nums（四选择器任一层/任一档）：契约 `odoStyleBlock` 六处字面量断言＋e2e computed `fontVariantNumeric` 断言分别被杀（源码层＋真实生效层双杀）。
4. 只给动画层 tabular 不给真实层（或反之）：真实层缺 ⇒ 播完后仍比例字宽（用户可见缺陷本体）；e2e fvnText/fvnRoll/fvnDigit 三元素断言＋契约四选择器断言被杀。
5. 收益率帧误套取整：单测 return 帧两位小数正则（`/^[+-]\d+\.\d{2}%$/`）被杀。

## 未覆盖边界（如实登记）

- 字宽断言的字体环境＝journey Chromium/Windows 本机字体栈；用户实机若用不同默认字体，tabular-nums 仍强制等宽（CSS 语义层），但像素级观感留待用户验收。
- e2e 层宽奇偶校验只做 settle 帧（两层同串才可比），滚动中两层的**位错位**（字符列逐列 x 坐标差）未逐列断言——由 tabular 等宽＋同字体栈推导保证，肉眼观感留待用户验收。
- 单测轨迹为冻结单例（1000000→1002345 / 0.1→1.5）；其它量纲轨迹的取整行为由 `Math.round` 语义统一覆盖，未逐轨迹枚举。

## 呈现类待拍板项（needs_user_decision / 待验收确认）

- 无新增呈现默认需拍板；本任务全部口径已由用户 2026-10-05 验收反馈冻结。
