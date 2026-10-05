# M6-07 动画效果设置分栏验证记录（2026-10-05）

- 任务：M6-07 设置面板新增"动画效果"分栏，收纳数字滚动开关；顶栏"滚动"胶囊按钮移除
- 基线：main `274e1d4`（同 M6-06 锚点；锚点问题 M6-07 A1=`web/src/appSettings.ts`、A3=CHANGELOG＋任务卡；依赖 M6-06）
- 用户反馈（2026-10-05 验收原文要点）：③动画开关应进设置（训练中可调），单独"动画效果"分栏，未来其它动画统一管理（现状＝顶栏"滚动"胶囊按钮，须移除）。
- 实现位置：`web/src/components/TrainingSettings.vue`（分栏＋开关）、`web/src/views/Training.vue`（顶栏按钮移除＋import 清理）；`appSettings.ts`/`settingsPanel.ts` 零改动（键沿用）

## 独立 oracle（冻结于任务卡，用户 2026-10-05 拍板）

- 设置面板（rail ⚙"训练默认设置"，训练中常驻可达）新增"动画效果"分栏，与现有分栏同构；首项"数字滚动动效"开关（默认开），持久化键沿用 `trainer_odo_motion`，即改即生效。
- 分栏结构可扩展（未来动画条目平铺追加）。
- 顶栏"滚动"胶囊按钮移除；其余顶栏元素不动。
- 设置弹层既有键盘/焦点语义（M5 已验收：Tab 陷阱/Esc 还焦点）不得回归。

## 实现设计

- `activeSection` 联合类型增 `'animation'`；settings-nav 平铺追加按钮（非嵌套子菜单＝"平铺追加"扩展模式）；移动端 `@media (max-width:640px)` 栅格 3→4 列。
- 分栏首项＝`label.settings-row`＋checkbox（`:checked="appOdoMotion"`＋`@change="onOdoMotionChange"`→`setOdoMotion(checked)`）：无保存按钮即改即生效（localStorage 偏好与 KDJ/VOL/MACD 同机制，无服务端往返）；复用现有 settings-row/row-text 样式语义（与"自动检查日线数据"同构）。
- `Training.vue`：胶囊按钮及其 `indicator-toggles` 容器移除；`setOdoMotion` import 清理（`appOdoMotion` 保留——beginRoll 动效门）；其余顶栏元素不动。
- ODO-MOTION-PREF 矩阵行 **ears/oracle 不变**，仅 test_ids 重绑：off 路径 e2e 改名走设置面板＋新增 M6-07 契约与 animation-settings e2e 绑定。

## RED → GREEN

- **RED（契约）**：`moves the odometer motion switch into an animation-effects settings section and removes the topbar capsule (M6-07)`——`expected Training.vue not to match /motion-toggle|动效开关/`（胶囊残留打红）。ODO-MOTION-PREF 既有用例同步收窄（UI 入口断言迁移至新用例，语义只迁移不放松）。
- **RED（e2e）**：`animation-settings.spec.ts`（新文件，已 `git add -N`）——run `93812640`：`.motion-toggle` toHaveCount(0) 失败（1 failed）。
- **GREEN**：定向 vitest 53/53（含 training-defaults/training-rules＝设置弹层 M5 键盘/焦点语义定向回归）；journey 三 spec 8/8（run `95ed7785`）。

## 踩坑沉淀（本轮新增）

1. **注释打红负向断言**（oracle.md 红线再实证）：移除胶囊后新写的 HTML 注释含"动效开关"子串，立即打红 `/motion-toggle|动效开关/` 负向断言——改措辞"数字滚动动效入口"。写负向断言前后都必须 grep 注释。
2. **checker 引号限制**：契约测试名含双引号（"animation effects"）时 check-binding 的用例名提取正则（`[^'"`\n]*`）在引号处截断 ⇒ ref 悬空 RED。处置＝测试名去引号（animation-effects），**不改门禁脚本换绿**。矩阵 test_ids 命名需避开引号字符。
3. **关弹层后焦点还至 ⚙**（M5 语义）：焦点在设置入口按钮上按 Space 会再开设置而非推进——e2e 关弹层后显式 blur（与 M6-05R 顶栏开关持焦同一既有特性，已记录在 M6-05 README）。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| RED 契约 | `npx vitest run --config server/vitest.config.ts server/test/frontend-contract.test.ts` | 1 failed（motion-toggle 残留）＝RED 收据 |
| RED e2e | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/animation-settings.spec.ts --retries=0` | run `93812640`：1 failed（.motion-toggle count≠0） |
| GREEN 单测（含设置语义回归） | `npx vitest run --config server/vitest.config.ts server/test/odometer.test.ts server/test/frontend-contract.test.ts server/test/training-defaults.test.ts server/test/training-rules.test.ts server/test/percent-hover.test.ts` | 53/53 通过（exit 0） |
| 类型＋构建 | `npm run build` | 通过（exit 0） |
| GREEN e2e | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/odometer.spec.ts e2e/animation-settings.spec.ts e2e/percent-hover.spec.ts --retries=0` | run `95ed7785`：8/8（odometer 4 含改写后 off 路径；animation-settings 1；percent-hover 3） |
| 绑定检查 | `check-binding.mjs --matrix account-odometer.yaml --strict --include-untracked` | covered=8 open=0 RED=0（exit 0） |

## 定向变异抽检（paper_only）

1. 胶囊按钮复活（按钮保留或漏删 import）：契约负向断言＋animation-settings e2e `toHaveCount(0)` 被杀。
2. 开关不落持久化（setOdoMotion 改为只写 ref）：e2e `localStorage.getItem('trainer_odo_motion')==='0'/'1'` 断言＋ODO-MOTION-PREF 契约（writeOdoMotionPref 键值 oracle，M6-05R 已锁）被杀。
3. 换持久化键（违反"沿用 trainer_odo_motion"）：同上 e2e 断言＋契约 `const ODO_MOTION_STORAGE_KEY = 'trainer_odo_motion'` 字面量被杀。
4. 开关无即改即生效（需重开页面/保存按钮）：animation-settings e2e 关→推进零滚动→重开→推进有滚动的双向时序断言被杀。
5. Esc 不还焦点（M5 回归）：animation-settings e2e `activeElement.aria-label==='训练默认设置'` 断言被杀。
6. 移动端 nav 栅格漏改（仍 3 列）：4 个分栏按钮挤 3 列——无专测（视觉层），如实登记：由 review 人工核对，未断言锁定。

## 未覆盖边界（如实登记）

- 移动端 640px 断点下四分栏 nav 的视觉排布未自动化断言（栅格 3→4 列已改，留待用户验收/人工复核）。
- "未来其它动画统一在此分栏"的扩展性＝结构约定（平铺追加），无第二动画条目可验证。
- 深浅主题下分栏视觉（沿用既有分栏样式）未单独截图，属既有设置面板样式的复用。

## 呈现类待拍板项（needs_user_decision，已按默认实现、待验收确认）

- 分栏名"动画效果"（与"默认设置/偏好设置/数据目录"并列的措辞）。
- 首项开关名"数字滚动动效"＋说明文案（"开启时，训练中账户权益与收益率数值变化会以约 0.3–0.6 秒的滚动动画过渡；关闭后数值直接跳变。默认开启。"）。
- 分栏导语（"控制训练界面中的动画呈现，切换后立即生效并自动记住；未来其它动画设置也将收纳在此分栏。"）。
用户验收确认或调整后升级（调整即改文案并补断言）。
