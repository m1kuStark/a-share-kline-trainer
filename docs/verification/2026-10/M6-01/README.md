# M6-01 KDJ 指标副图验证记录（2026-10-05）

- 任务：M6-01 KDJ 指标副图（通达信口径）
- 基线：main `e50da5e32fd328e62ee2bde0fe5f8499d4702eff`（开工前工作树干净）
- 实现位置：`web/src/indicators.ts`（computeKdj 纯函数＋registerIndicator）、`web/src/components/KlineChart.vue`（挂载/开关/语义窗格名/回放守卫/journey 探针）、`web/src/appSettings.ts`（应用偏好）、`web/src/App.vue`（顶栏开关）
- 行为矩阵：工作区 `.zcode/skills/ai-harness/matrix/kdj-subchart.yaml`（KDJ-CALC-TDX / KDJ-PANE-PRESENT / KDJ-TOGGLE-PERSIST / KDJ-INTERACT-COMPAT → covered；KDJ-THEME-COLORS 保持 proposed_default）

## 独立 oracle

- 来源：架构师预计算（矩阵 KDJ-CALC-TDX 的 oracle 字段），**不来自实现**。12 根 OHLC 夹具与期望 K/D/J 六位小数表由架构师给定；执行代理另行手工复算全表核对一致（含 i11 的 LLV=10.1 易错点），并独立手算"全平 K 线（HHV=LLV→RSV=100、种子 50）"迷你 oracle：K0=200/3、D0=500/9、J0=800/9；K1=700/9、D1=1700/27、J1=2900/27。
- 夹具（OHLC）：

```
10.0/10.2/9.8/10.1；10.1/10.5/10.0/10.4；10.4/10.6/10.2/10.3；10.3/10.8/10.2/10.7；
10.7/11.0/10.5/10.9；10.9/11.2/10.7/11.1；11.1/11.3/10.8/10.9；10.9/11.0/10.4/10.5；
10.5/10.7/10.1/10.2；10.2/10.9/10.1/10.8；10.8/11.4/10.7/11.3；11.3/11.5/11.0/11.1
```

- 期望表（i0..i11，K/D/J）：见矩阵 oracle 字段；测试 `server/test/kdj-indicator.test.ts` 以内嵌常量断言（`toBeCloseTo(…, 4)`），断言路径经 ts.transpile 提取执行 web 真实导出（沿用 `helpers/chart-zoom.ts` 模式），未在测试内复制实现。

## RED → GREEN

- RED：实现未加时 `kdj-indicator.test.ts` 4/4 失败（computeKdj 未导出／KDJ 模板未注册／偏好读写片段缺失），报错即"缺实现"本身。
- GREEN：实现后同文件 4/4 通过。
- 挂载/开关/交互语义由 `server/test/frontend-contract.test.ts::mounts the KDJ subchart pane with an app-preference toggle and equal pane semantics (M6-01)`（源码契约）＋ `e2e/kdj-indicator.spec.ts`（真实浏览器 3 例：默认挂载、开关持久化、框选/双击最大化/画线保存恢复）锁定。

## Gate 命令与退出码

| Gate | 命令 | 结果 |
|---|---|---|
| KDJ 单测 | `npx vitest run --config server/vitest.config.ts server/test/kdj-indicator.test.ts` | 4/4 通过 |
| 定向四件套 | `npx vitest run --config server/vitest.config.ts server/test/frontend-contract.test.ts server/test/drawing-state.test.ts server/test/recording-chart.test.ts server/test/kdj-indicator.test.ts` | 64/64 通过（exit 0） |
| 构建 | `npm run build`（vue-tsc＋server tsc＋vite） | 通过（exit 0） |
| M2 冻结样本 | `npm run verify:m2` | 111 文件/1428 用例全绿＋冻结样本 **24/24 检查 0 失败**（exit 0；报告产物 M2-e2e-report.md 含本机路径未脱敏，已还原不入库） |
| 浏览器回归 | `TDX_ROOT=<本机通达信目录> npm run journey -- e2e/kdj-indicator.spec.ts --retries=0` | 3/3 通过（exit 0） |
| 关联 spec | 同上跑 `e2e/pane-resize.spec.ts` | 5/5 通过（exit 0） |
| 绑定检查 | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix <skill>/matrix/kdj-subchart.yaml --strict` | covered=4 open=1（KDJ-THEME-COLORS proposed_default 属声明债务）RED=0，exit 3（符合预期） |
| 台账 | `node <skill>/scripts/gate-report.mjs --task M6-01 --gate kdj-unit=0 --gate build=0 --gate m2=0 --gate e2e-kdj=0 --gate binding=3 --note …` | 已写入 `ai-harness-lab/harness-state.jsonl` |

## 定向变异抽检（paper_only）

1. 种子 K=50 改 0：i0 的 K=(75+0)/3=25≠58.333333 → 被 oracle 表用例 `computes KDJ against the architect oracle table…` 杀死。
2. 删除 HHV=LLV 特例（range===0 直接除）：全平 K 线 RSV=NaN → 被 `maps flat bars (HHV=LLV) to RSV=100…` 杀死。
3. 窗口改全历史（不截 9 根）：i9 的 LLV 将取 9.8 而非 10.0，RSV 由 61.538 变 66.667 → 被 oracle 表 i9 行杀死。

## 用户授权的越界改动（三项）

1. `e2e/pane-resize.spec.ts:26-27` 与 `e2e/journey.spec.ts:110-111`：pane 计数断言 3→4（KDJ 副图默认挂载所致，均带注释）。
2. `server/src/drawings.ts:13`：PANE_IDS 白名单加 `'KDJ'`（e2e 实测：KDJ 窗格画线保存被拒"paneId must be candle_pane, VOL or MACD"；矩阵 KDJ-INTERACT-COMPAT 冻结口径为与 VOL/MACD 同等参与）；错误文案同步列明 KDJ。
3. `web/src/recording/validation.ts:17`：DRAWING_PANES 白名单加 `'KDJ'`（同一冻结口径的录像导入侧）；文案同步。

## 已知边界与登记

- **KDJ-THEME-COLORS（proposed_default，待用户拍板）**：K 白 `#f2f2f2` / D 黄 `#f5c343` / J 紫洋红 `#d446d6`（通达信习惯）经 createIndicator styles.lines 传入，代码注释已标注；用户验收时确认或改色。
- **KDJ 偏好关闭时的窗格内容丢失**：KDJ 窗格被移除时，位于该窗格的画线随窗格销毁（会话内不自动恢复；已保存的画线在重载后按语义名回落主图 candle_pane，重新开启 KDJ 后新画线正常）。画线持久化/录像导入白名单已含 KDJ；如需"关闭时迁移画线"或"KDJ 窗格禁画线"，属新取舍待拍板。
- **录像回放按当前开关渲染**：旧录像 paneHeights 不含 KDJ；含 KDJ 高度的新录像在偏好关闭时回放会跳过该项（不写回主图，见 KlineChart.vue applyReplayView 守卫），不视为布局损坏。
- **存量失败登记（非本任务回归）**：`e2e/journey.spec.ts` Act4d"副图画线与多选框选"在 main 基线（`e50da5e`，stash 本任务全部改动后实测）同样失败于 `overlayInfo(0).paneId !== 'candle_pane'`：该探针取到图表初始化期创建在 candle_pane 的引擎 overlay（阶段价位线），不是所画副图线段；本任务实测 `drawings()[0].paneId='MACD'` 语义正确。修复需改探针或用例（越界），另行处理。journey.spec 其余 14 例在本任务改动下全部通过。
- **check-binding 索引对新文件的可见性**：新增测试文件以 `git add -N`（intent-to-add）纳入 `git ls-files` 索引供绑定检查解析；未 commit，提交由架构师复核后进行。

## 复现要点

- journey 浏览器回归需要 `TDX_ROOT` 指向本机通达信目录（独立运行时从 `~/.a-share-kline-trainer/saved-tdx-choice.json` 读取；运行器不读该文件，须显式传 env）。
