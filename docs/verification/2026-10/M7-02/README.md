# M7-02 随机训练模式·首页入口与前端接线 — 验证记录

- 基线：`825af6547c2105e66fc031c62ef54c0239b4538b`（开工时 HEAD，工作树干净；即 M7-01 提交）
- 设计与 UI 契约：[design.md](./design.md)（阶段①②③交付物；§二为组件改动图＋§三文案表）
- 矩阵：工作区 `.zcode/skills/ai-harness/matrix/random-training-mode.yaml`（追加 6 行 RAND-UI-*，全部 covered；M7-01 既有 12 行未动）＋镜像 `ai-harness-lab/skill-v1/matrix/random-training-mode.yaml`
- 行为 oracle：用户 2026-10-06 原话＋架构师 M7-02 派发简报（文案类全部 proposed_default，见文末清单）

## RED → GREEN 证据（阶段④）

- 测试文件：`e2e/random-mode.spec.ts`（8 用例；三维度载荷断言用 route stub，遮蔽/揭晓走真实 journey 服务＋真实 TDX 数据）
- **RED**：`TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0` → **8/8 失败，全部以正确原因**：
  - 测试 1/8：`getByRole('tablist', { name: '训练模式' })` element(s) not found（标签不存在＝功能缺失）；
  - 测试 2–7：`getByRole('tab', { name: '随机模式' }).click` 30s 超时（等待元素出现＝功能缺失）；
  - 测试 8：`getByRole('tab', { name: '经典模式' })` toHaveAttribute element(s) not found。
  - 期间两次 spec 自身编排修正（先修环境序错：真实数据状态首查 sourceMaxDate=null→改用目录流动股 lastDate 推导窗口末缘，绕开冷启扫描等待），修正后重跑仍 8/8 以功能缺失失败——RED 以最终形态见证。runs：`run-d4ca8deb`（日志 `.runs/run-d4ca8deb-01e2-41cd-8983-2855c7f669be/artifacts/journey.log`）。
- **GREEN**：实现（见下「改动清单」）后同命令 → **8/8 通过**（38.7s）。中途 1 处 spec 编排修正：结算面板按钮名「留在当前界面」（源码实际值，初稿误写「继续查看图表」）——修正后 8/8。runs：`run-87501e75`。

## 门禁四件套（第 4 步）

| 门禁 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 绑定检查（strict＋未跟踪） | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix <skill>/matrix/random-training-mode.yaml --strict --include-untracked` | 18 行 covered=18 / open=0 / RED=0，1528 用例索引 | **0** |
| 定向·M7-01 服务端（不许红） | `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` | 14/14 ✓ | 0 |
| 定向·源码契约 | `npx vitest run --config server/vitest.config.ts server/test/frontend-contract.test.ts` | 35/35 ✓ | 0 |
| 全量 | `npm test` | **1468/1468** ✓（首轮 3 失败：1×frontend-contract「lean title」源码契约——本任务把经典标题组合式抽进 computed 致模板字面量消失，属实现破坏锁定形状，按红线**改实现不改断言**（组合式内联回模板）后 35/35；2×review-profile `mkdtemp` 15s 钩子超时＝Windows 高负载环境性（M7-01 同款已知），修复后全量同轮全绿） | **0** |
| 构建 | `npm run build`（typecheck:web＋build:server＋build:web） | 全绿（chunk>500kB 警告为存量提示） | **0** |
| journey·新 spec | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0` | 8/8 ✓（run-87501e75） | 0 |
| journey·既有首页 spec 抽查 | `… journey -- e2e/training-range.spec.ts --retries=0` | 7/7 ✓ | 0 |
| journey·最终代码态复跑（Training.vue 契约修复后） | `… journey -- e2e/random-mode.spec.ts e2e/training-range.spec.ts --retries=0` | **15/15 ✓**（1.2m，run-8c693a36） | 0 |

浏览器回归全程串行（journey 单进程 workers=1）。

## 语义锁定变异抽检（P4，paper_only）

| 变异（假想改回旧实现） | 击杀测试（矩阵行） | 推演 |
|---|---|---|
| 删 `maskedStock` 分支（标题恒走经典组合式） | `masked session: hidden stock shows placeholder and badge while dates render as served`（RAND-UI-MASKED-DISPLAY） | hideStock 会话 name/code 为 null → 标题渲染「 · 」裸分隔符 ≠ '随机标的 · 已隐藏'，`toHaveText('随机标的 · 已隐藏')` 红 |
| 标签引入即改经典默认（`mode` 初值 'random' 或经典面板条件误加 mode 因子） | `classic panel spot check: tier grid and stock picker intact with tabs present`（RAND-UI-CLASSIC-INTACT） | 经典默认被破坏 → `aria-selected=true` 断言红、`2年` 周期按钮/日期回退断言（锚点 2026-09-24→2024-09-24）随之失败；且 training-range.spec 7 项中 5 项依赖默认经典面板（首轮即全绿为对照证据） |

纸面理由：两行均以「精确文本/属性相等」断言锁 UI 契约字面量，非名字对应；本轮未实际执行变异体（e2e 变异轮成本高，M7-01 已对服务端两核心行做过 executed 级击杀，UI 层文本断言的杀伤路径单一直接）。

## 改动清单（GREEN 实现）

| 文件 | 要点 |
|---|---|
| `web/src/api.ts` | `TrainingRangeMeta.mode`/`HistoryRangeMode`/`HistoryReportTraining.range.mode` 联合补 `'random'`；新增 `RandomDimension`/`RandomTrainingMeta` 类型与 `TrainingMeta.random?` 字段；新增 `createRandomTraining()`（POST /api/trainings/random）与 `RandomTrainingRequest` |
| `web/src/views/Launcher.vue` | 「经典模式｜随机模式」标签（role=tablist，默认经典）；随机维度三选一＋训练窗口长度（默认 250，min/max=20/2000）；控件显隐 computed（showStockPicker/showPresetStart/showRangeDates/showWindowBars）实现面板复用——经典分支 v-if 条件与原版逐字等价（经典 DOM 零变化）；范围校验/锚点回退 watcher 加 classic 守卫；`performRandomCreate`（维度驱动载荷组装＋客户端校验）；`randomCreateErrorMessage`（两类 422 → 人话提示）；mode-tabs scoped 样式（沿 timeframe-tabs 下划线风格，双主题） |
| `web/src/views/Training.vue` | 标题行 `.title-row`（workspace-title＋random-mode-badge）；hideStock → 「随机标的 · 已隐藏」占位（经典组合式保持模板内联＝frontend-contract 源码契约）；徽标 v-if=training.random（结束态服务端撤字段→自然退场）；`tierLabel` random 分支「随机窗口 N 根」；日期字段零二次处理（原样呈现服务端值） |
| `web/src/views/History.vue` | `RANGE_MODE_LABELS.random = '随机模式'`（结算后随机局不再误标「自定义范围」） |
| `web/src/recording/validation.ts` | `RANGE_MODES` 补 `'random'`——否则随机局（tier=RANGE＋range.mode=random）默认开启的「记录操作」在 checkpoint 校验必失败（阶段①发现的接线缺口） |
| `e2e/random-mode.spec.ts`（新） | 8 用例：标签互斥/三维度显隐＋载荷/真实遮蔽态/真实结算揭晓/422 映射/经典抽查 |

## 服务端零改动声明

`server/src/**`、`server/test/**` 本任务未触碰（M7-01 契约消费方）。`git status` 改动面＝web/src 五文件＋e2e 一新文件＋docs。

## 待用户拍板项（proposed_default，随收尾报告转呈）

**呈现类文案**（验收时可改，改＝更新断言字面量）：
1. 标签名「经典模式」「随机模式」；随机模式副标题「服务器随机选股或随机选时段，训练中隐藏对应信息，结算后揭晓。创建后复权方式锁定，训练中不可切换。」
2. 维度选项「随机股票 · 我选时间段／随机时间段 · 我选股票／全随机」及三条 hint（design.md §三全文）
3. 窗口长度控件 label「训练窗口长度（交易日）」＋提示「默认 250，范围 20–2000；需保证所选股票（或本地数据）历史足够长」；随机分支起止日 hint 两条
4. 训练页占位「随机标的 · 已隐藏」；徽标「随机模式」（title 含维度中文名：随机股票/随机时段/全随机）
5. `tierLabel` 随机口径「随机窗口 N 根」（三维度统一按 barCount）
6. 422 两句人话提示（简报原文照用）
7. 历史档位标签「随机模式」

**行为类默认（proposed_default，已按简报实现）**：
8. 随机模式默认维度=random_stock；窗口越界（非 20–2000 整数）客户端拦截文案「训练窗口长度需为 20–2000 的整数（默认 250）」
9. random_both 维度下窗口长度输入框的值（默认 250）总是显式随载荷发送（服务端缺省亦为 250，二者等价）
10. 数据新鲜度守卫与默认设置守卫对随机创建同样生效（与经典一致）
