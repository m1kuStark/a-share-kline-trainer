# M9-04C 验证记录（2026-11-17）

任务：[M9-04C](../../../work-items/tasks/M9-04C.md)；提案：[M9-04 公式系统产品化](../../../proposals/M9-04-formula-product-ui.md)。

## 结论

已启用公式已挂载到 K 线图：主图公式作为 candle_pane 指标线、副图公式每公式一个独立 pane（与 VOL/MACD/KDJ 同 pane 机制）；训练加载/推进/周期切换/动态补历史/公式库变更后重算；只读回放页同样渲染；随机训练不旁路 M7-01（不注入 StockContext，上下文函数显示中文人话提示，页面不出现隐藏名称/代码）；录像 paneHeights 捕获跳过公式 pane。定向 Journey 3/3 通过，单元测试 6/6，邻接 812/812，typecheck/build 0。

## 实现摘要

| 文件 | 内容 |
|---|---|
| web/src/formulaIndicators.ts（新） | 浏览器侧公式求值：仅 import 纯值入口 FormulaEngine/futureFunctions（不 import index，避免类型按值导出运行时错误）；bars→本地午夜 timestamp；输出按 timestamp 对齐、NaN→null；单公式错误隔离为中文人话；导出公式指标命名（FORMULA_<id>_<index>）、公式 pane 识别与 paneHeights 捕获过滤纯函数 |
| web/src/components/KlineChart.vue | 新 prop formulaLines；registerIndicator 动态模板（extendData.points 按 timestamp 查表）+ createIndicator 主图 paneId='candle_pane' / 副图每公式一 pane（首行建 pane、后续行同 pane；副图 pane 最小高度 90）；overrideIndicator 更新数据；移除过期公式指标；测试钩子 formulaIndicators；semanticPaneHeights 改用纯函数跳过公式 pane；新增 barsExtended 事件（补历史后父级重算） |
| web/src/views/Training.vue | 挂载/设置面板关闭/settingsSavedVersion 变化时 GET /api/formulas；barsExtended 更新求值序列；推进/周期切换后重算；请求版本守卫（formulaEvalVersion/formulaLibraryVersion）；随机训练/盲训不注入 StockContext；状态区 .formula-chart-status 显示公式错误/未来函数提示；KlineChart 传入 formulaLines |
| web/src/views/SessionReplay.vue | 只读回放：按回放 bars 求值（无 StockContext），公式库变更刷新；KlineChart 传入 formulaLines 并接 barsExtended；不写录像/画线 |
| web/src/api.ts | 新增 fetchFormulaContext（训练图 StockContext 唯一来源） |
| e2e/formula-chart.spec.ts（新） | 3 用例：主图/副图 pane 归属与推进/周K 重算；随机训练上下文人话提示且不泄露隐藏信息；只读回放页公式渲染；4 张截图证据 |
| server/test/formula-chart.test.ts（新） | 6 用例：timestamp 对齐/NaN→null、enabled 过滤、无上下文人话错误、有上下文 NAMELIKE、指标命名/pane 探针、paneHeights 跳过公式 pane |

## RED / GREEN

| 阶段 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| RED（实现前） | TDX_ROOT=… npm run journey -- e2e/formula-chart.spec.ts --retries=0 | **1** | run run-a4c7d93b-baa1-47c0-944e-32c0a00cf825：3 用例失败（formulaIndicators 探针不存在） |
| GREEN（定向 Journey） | 同上 | **0** | run run-23982c52-15dd-4359-bd0e-cc225004996d：3 passed；截图见 screenshots/ |
| 定向单测 | npx vitest run server/test/formula-chart.test.ts --config server/vitest.config.ts | **0** | 6 passed |
| 邻接单测 | npx vitest run server/test/formula-chart.test.ts server/test/formulas server/test/formula-library-api.test.ts server/test/formula-random-guard.test.ts server/test/formula-engine --config server/vitest.config.ts | **0** | 34 files / **812 passed** |

环境 flake（不改产品逻辑）：journey 构建期 tdx-snapshot rename EPERM 出现 2 次（run-8506b551…、run-5f3eff34…，artifacts 为空），原样重试后绿；另一次 run-0b5bbc7a… 为加 shortName/pane 高度前的中绿证据。

## 门禁

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 前端类型检查 | npm run typecheck:web | **0** | vue-tsc 无错误 |
| 生产构建 | npm run build | **0** | web build 6.98s；server+bundle 构建通过 |
| 矩阵绑定 | node .zcode/skills/ai-harness/scripts/check-binding.mjs --repo <worktree> --matrix formula-chart.yaml --strict | 0 | 4 行 covered=4 RED=0（收尾核验） |
| 文档 | docs:check / docs:status -- --check / docs:impact -- --base fd017dc --task M9-04C | 0 | 0 error（收尾核验） |

## 视觉检查（UI-VISUAL-ACCEPTANCE）

- 证据（本目录 screenshots/）：formula-chart-training.png、formula-chart-weekly.png、formula-chart-random.png、formula-chart-replay.png。
- 训练页 1440×900：主图图例 CHART_MAIN.MAINLINE 与 MA 图例同排；副图最底部独立窗格显示 CHART_SUB.SUB1/SUB2 两条线（收起悬浮画线工具后图例清晰）；VOL/MACD/KDJ 既有窗格与公式窗格共存，分隔条可拖动（沿用原生 pane 机制）。
- 周K 切换后主图/副图公式仍在且按周 bars 重算；回放页底部同样出现 CHART_SUB.SUB1 窗格（只读回放无写入口）。
- 随机训练：公式窗格正常渲染 MA 公式；状态区显示「公式「CHART_CTX」求值失败：缺少证券上下文…NAMELIKE…不可用」；页面文本不含真实名称/代码。

## 边界与未覆盖

- 公式 pane 高度不进入录像 paneHeights（回放按当前公式与默认布局渲染）；副图公式 pane 本地最小高度 90px。
- 在公式 pane 内新建画线时，既有 paneName 语义仍回落 candle_pane（与未知 pane 同口径）；属既有画线持久化边界，未在本卡扩展，记录为已知限制。
- 训练/回放求值使用浏览器侧引擎；服务端 evaluate API 与本卡并行存在，口径共用 web/src/formula-engine。
- 全量 npm test / 全量 journey 由 Lead 合并前执行；本卡记录定向证据。

## 环境

- 独立 Journey run（动态端口/临时 SQLite/独立构建，run 后销毁）；TDX_ROOT 只读（D:\MySoftWares\TDX）。

## Lead 复核与修复（2026-11-17）

只读复核发现并修复 3 个真实缺陷（均补回归）：

| 缺陷 | 根因 | 修复 |
|---|---|---|
| 公式线全部不可见（副图只剩图例、Y 轴 2~10 默认值） | formulaIndicators.barTimestamp 用本地午夜，而 KlineChart dateTimestamp 用 UTC 午夜；按 timestamp 查表全 miss→NaN | timestamp 统一 UTC 午夜（月键补 -01）；单测锁定 UTC 约定；e2e 探针 hasResult 改为“存在有限值”而非仅 result 长度 |
| 多空反转时主图公式线错位 | 公式值走真实价、K 线走镜像价 | 主图公式点按 2P0-p 同步镜像；watch priceMirror 重算 |
| 公式库增删改/启停后图表不刷新 | 仅数据推进触发 recalc；无柱数据变化时 override 不重算 | 新增 formulaConfigVersion（Training/Replay 公式库刷新时自增）→ KlineChart 重建公式指标；副图 pane 设 height=120/minHeight=90 保证可读 |

### Lead 修复后收据

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 图表求值单测 | npx vitest run server/test/formula-chart.test.ts --config server/vitest.config.ts | **0** | 7 passed（含 UTC timestamp 用例） |
| 定向 Journey（4 用例，含视觉尺寸/主题） | TDX_ROOT=… npm run journey -- e2e/formula-chart.spec.ts --retries=0 | **0** | run run-cfdcd7f6-ec6c-4211-b92d-bb193da4483f；主流程/随机遮蔽/回放/视觉 4 passed |
| 前端类型检查 | npm run typecheck:web | **0** | vue-tsc 无错误 |
| 生产构建 | npm run build | **0** | web 8.02s |
| 全量单测 | npm test | 1（2645/2647） | 2 项主机环境 flake（runtime-isolation cancel 等，main 基线同失败）；CI 干净环境权威 |
| 视觉证据 | 本目录 screenshots/ | — | 8 张：1440/1366/1024 light、1440 dark、训练/周K/随机/回放 |
| 公式 pane 高度 | e2e 截图 | — | 副图 pane 120px/min90，公式线可读；不进入录像 paneHeights（卡内边界） |

- 视觉观察：主图公式图例“公式名.线名”可见；副图公式两线可读；1024/1366/1440 无横向溢出；深浅主题对比度正常；悬浮工具栏先收起后截图，避免遮挡。
- 已知边界：副图 pane 内新建画线的 paneName 语义仍回落 candle_pane（既有画线持久化边界）；公式 pane 高度不持久/不进录像；web bundle 因内嵌引擎增大（未单列预算）。
