# M6-04 指标开关迁移验证记录（2026-10-05）

- 任务：M6-04 KDJ/VOL/MACD 三个指标开关迁至周期按钮行
- 基线：main `45bd47a`（与 M6-03 同一锚定提交；开工前工作树干净）
- 实现位置：`web/src/appSettings.ts`（VOL/MACD 偏好读写纯函数＋refs＋setters，键 trainer_vol_subchart/trainer_macd_subchart）、`web/src/components/KlineChart.vue`（SUBCHART_PREFS 映射＋applySubchartPanes 统一入口，替换 applyKdjPane；watch 三偏好）、`web/src/views/Training.vue`（周期行内 .indicator-toggles 三开关组）、`web/src/App.vue`（顶栏 KDJ 按钮与样式删除）、`web/src/styles.css`（开关胶囊样式）
- 行为矩阵：工作区 `.zcode/skills/ai-harness/matrix/chart-toggles.yaml`（TOG-PERIOD-ROW-PLACEMENT/TOG-EACH-INDICATOR/TOG-OFF-COMPAT 三行 covered，check-binding --strict --include-untracked exit 0 全闭合）；`kdj-subchart.yaml` KDJ-TOGGLE-PERSIST 复核原绑定未悬空并补绑 chart-toggles 用例（该矩阵 strict exit 3＝仅剩既有 KDJ-THEME-COLORS proposed_default，非本轮引入）

## 独立 oracle

- 规约来源＝用户 2026-10-05 验收拍板（任务卡冻结）：三开关与周期按钮同行同区、aria-pressed 保留；默认全开＝现状；三偏好独立持久化；关闭即移除副图；回放 paneHeights 守卫沿用 KDJ 机制。
- 偏好层语义 oracle（'0' 才是关、键独立互不串）＝M6-01 KDJ 偏好既有口径的自然扩展；server/test/kdj-indicator.test.ts 新增 VOL/MACD 用例以内嵌期望断言（未设置/异常值→开；'0'→关；VOL 关不影响 MACD；写入往返 '1'/'0'），经 ts.transpile 提取执行真实导出，不从实现反推。
- 窗格增删期望（e2e）：indicatorPanes 语义名序列随开关逐档变化；重开后副图为追加序（klinecharts createIndicator 追加语义，规约未钉顺序，测试按追加序断言并已注明）。

## RED → GREEN

- RED：frontend-contract M6-01 块更新后＋新增 M6-04 契约块＋kdj-indicator VOL/MACD 偏好用例，实现未加时 3 处失败（applyKdjPane 字面量不匹配/indicator-toggles 不存在/VOL 偏好导出缺失）。
- GREEN：实现后定向全绿、全量 112 文件 1441 用例通过。e2e/chart-toggles.spec.ts（新建，journey 前已 `git add -N` 入索引）三例锁真实浏览器行为。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| 定向单测 | `npx vitest run --config server/vitest.config.ts server/test/percent-hover.test.ts server/test/frontend-contract.test.ts server/test/kdj-indicator.test.ts server/test/recording-chart.test.ts server/test/drawing-state.test.ts` | 77/77 通过（exit 0） |
| 全量单测 | `npm test` | 112 文件 1441 用例通过（exit 0） |
| 构建 | `npm run build` | 通过（exit 0） |
| 浏览器回归 | `TDX_ROOT=D:\MySoftWares\TDX npm run journey -- e2e/chart-toggles.spec.ts --retries=0` | 3/3 通过（run `09907a2d-ec72-4cf5-b35d-a7d68e25988e`；截图 chart-toggles-period-row.png 等） |
| 关联 spec | 同上跑 `e2e/kdj-indicator.spec.ts` / `e2e/pane-resize.spec.ts` | 各 3/3（run `2e6a80c0`）/ 6/6（run `dc309422`；默认全开 panes 计数仍为 4） |
| 绑定检查 | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix chart-toggles.yaml --strict --include-untracked` | covered=3 open=0 RED=0（exit 0）；kdj-subchart 同命令 exit 3＝仅剩既有 KDJ-THEME-COLORS proposed_default（基线即有） |
| 台账 | `node <skill>/scripts/gate-report.mjs --task M6-04 --gate unit=0 --gate build=0 --gate e2e=0 --gate binding=0 --note …` | 已写入 `ai-harness-lab/harness-state.jsonl` |

## 定向变异抽检（paper_only）

1. 偏好键串键（VOL 读写误用 MACD 键）：kdj-indicator VOL/MACD 用例"VOL 关不影响 MACD"与写入往返断言被杀。
2. 默认值翻转（未设置→关）：'未设置→默认开'断言被杀；e2e openChart 的"panes 计数＝4"在全新 context（localStorage 空）同杀。
3. 关闭不移除副图（applySubchartPanes 只增不删）：e2e 逐档 indicatorPanes 断言（VOL 关后 ['candle_pane','MACD','KDJ']）被杀。
4. 顶栏按钮残留（App.vue 忘删）：契约负向断言 `app not.toMatch(/kdj-toggle|appKdjSubchart|setKdjSubchart/)` 被杀。
5. 回放 paneHeights 守卫退化为写回主图（去掉 actualPaneId==='candle_pane' 跳过）：契约块守卫字面量断言（M6-01/M6-04 两处）被杀。
6. watch 丢偏好（漏 appVolSubchart）：契约 watch 数组字面量断言被杀；e2e 关 VOL 后窗格不消失同杀。

## 实现要点与踩坑沉淀

- 统一入口 applySubchartPanes 按 ['VOL','MACD','KDJ'] 顺序幂等收敛（存在性与偏好比对，增删对称）；挂载期与偏好切换共用，M6-01 的 KDJ 单入口自然并入，未留两套口径。
- KDJ 偏好层（键名/读写函数/appKdjSubchart ref）逐字保留——kdj-indicator.test.ts 的源码切片提取（indexOf 起止）与契约字面量都锚定该段布局；VOL/MACD 以同构段落追加在其后，新测试切片同样自包含。
- e2e/kdj-indicator.spec.ts 的开关定位是 getByRole(button, name 'KDJ')（可寻址名与位置无关）：迁移后零断言改动即通过，仅注释更新；frontend-contract M6-01 块的"顶栏按钮"字面量断言按规约变更改写（位置断言迁入新 M6-04 块），其余断言未弱化。
- App.vue 删除顶栏按钮后其 appSettings import 整行移除（该文件不再引用其任何导出；曾误留猜测性 import，vue-tsc 未拦但属死代码，已核实用法后删除）。

## 未覆盖边界（如实登记）

- 重开后的窗格顺序＝追加序（如先关 VOL 再开，VOL 落到 KDJ 之后），未恢复原始位置；规约未钉顺序，已按追加序断言并在矩阵 binding_note 注明，用户若在意顺序需另拍板。
- 录像带 paneHeights 而 VOl/MACD 偏好已关的回放跳过行为由源码契约锁（applyReplayView 守卫沿用），未做带 VOL 高度的录像回放 e2e 专项（KDJ 侧 M6-01 已有同机制实现，逻辑共用同一行守卫）。
- 设置面板（训练默认设置）内不出现这三开关（应用偏好与训练默认设置分层），本轮未加负向断言。
