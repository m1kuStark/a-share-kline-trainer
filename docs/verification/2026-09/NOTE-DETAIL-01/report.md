# NOTE-DETAIL-01 定向验证记录

2026-09-27。并行开发候选（dispatch control-handoff-20260927-37，feature TRADE-MARKER-DETAILS）。本记录为定向验证，完整发布门禁未运行，由 GPT 在两路候选整合时串行组织。

## 交付行为

- `web/src/tradeMarkerDetails.ts`：只读详情浮层纯状态机（preview/activate/select/pin/unpin/pointer-leave/outside-pointerdown/escape/close/sync）与逐笔事实/列表行格式化。sync 在选中成交消失时立即清选择和固定；非固定面板在其徽标消失时关闭，固定面板保留；select 只接受当前面板聚合内的成交。
- `web/src/TradeMarkerDetails.vue`：Teleport 到 body 的只读浮层（避开 rail `overflow:hidden`），单笔直显、聚合列笔次选笔；固定/关闭按钮；盲训时所有文本只用 blindLabel。无任何写请求。
- `web/src/TradeMarkerRail.vue`：徽标悬停/聚焦预览（120ms 延迟收起防间隙闪烁）、点击/Enter/Space 打开（键事件 stop，不触发页面交易/推进）、Esc 关闭归还焦点、窗口 pointerdown 外部关闭、markers/trades 变化 sync 重锚定、徽标 getBoundingClientRect 定位钳制在视口内；window pointerdown/resize 监听在 onBeforeUnmount 卸载。原生 title 由 aria-label 取代（浮层取代原生提示）。
- KlineChart.vue 零改动（复用现有 rail 挂载）；server/src、api.ts、录像 schema、账户语义均未触碰。

## 提交与指纹

- 代码提交：见任务卡 integration_ref 与回调简报（本文件同提交写入，不自引 SHA）。
- 基线：3f8c61246d5c057743fc312b07ebdd704d23658a；分支 task/NOTE-DETAIL-01。
- 冻结样本：C:/Users/Stark_Du666/.codex/headroom-cache/fixtures/tdx-20260916-d8339f32（只读引用，runner 隔离拷贝；截止 2026-09-16）。

## 验证结果（全部完整日志在控制缓存 evidence/）

| 检查 | 结果 |
|---|---|
| RED：新建 trade-marker-details 测试先于实现运行 | 失败（模块不存在），日志 01-red-*.log 保留 |
| GREEN：`npm test -- --maxWorkers=1 trade-marker-details` | 11/11 通过（含 escape 分支缺失、跨标记 select 劫持两个实现缺陷由测试先行抓出） |
| 定向单测 `trade-marker frontend-contract frontend-data-status` | 4 文件 57/57 通过 |
| `vue-tsc -p web/tsconfig.json --noEmit` | 退出 0 |
| `npm run build`（typecheck+server+vite） | 退出 0（chunk 体积告警为既有） |
| `docs:check` / `docs:impact --base 3f8c612 --task NOTE-DETAIL-01` / `docs:status --check` | 均 0 错误（impact 曾抓出 README 越界改动，已撤销；status.md 为合同授权自动生成，已补入卡片 allowed_paths） |
| Journey `e2e/trade-marker-details.spec.ts`（单 worker，独立端口 3969/独立库） | 6/6 通过（run-db3a043c） |
| Journey `e2e/m3-round3.spec.ts`（密集标记回归＋aria-label 适配） | 4/4 通过（run-deb0ce02） |

## 首次失败与修复保留（FM-007）

1. Journey 第 1 轮（run-96cca58b）4 败：测试数据用相邻交易日，日K右缘两日投影落入同一 34px 聚合单元合并为 B3（既有布局算法正确行为，截图留证）；回放断言误设徽标数与选中笔序。修正：单笔与聚合间隔 7 个交易日；回放先选 #2 再固定。日志 journey-run-96cca58b.log 保留。
2. Journey 第 2 轮（run-ad4c7487）3 败：聚合内序号断言错位（聚合含 #2/#3 而非 #1/#2）；周K右缘相邻周线合并导致 data-count=2 徽标不存在（切回日K再操作）；主题按钮名假设错误（默认深色，按钮为"切换到浅色主题"，改为按 body.dark 状态切换）。日志 journey-run-ad4c7487.log 保留。
3. 实现侧缺陷（单测先行抓出）：DetailsEvent 联合类型漏声明 escape（switch 漏分支返回 undefined）；select 未校验目标聚合即当前面板聚合，跨标记选择可劫持面板。均已修复并有 GREEN 证据。

## 视觉检查（主代理，UI-VISUAL-ACCEPTANCE）

截图（evidence/ 与 run-db3a043c artifacts）：深色 1440 周K固定浮层（列表+逐笔事实+已固定态，锚定徽标上方不裁切）、浅色 840（面板完整、徽标无重叠）、盲训（日期仅"今日"，aria/文本无真实日期）、回放（B2 徽标+浮层可用）。深浅主题、840/1440px 由 DETAILS-visual-regression 测试断言面板完整可见与徽标两两无重叠。

## 边界与未运行项

- 未运行：全量 npm test、全量 Journey、verify:candidate、发布门禁、GPT 语义/视觉验收。定向完成，整合门禁待运行。
- 理由/阶段/订单字段依赖 REC-04/TRAIN-03，本片未显示占位值；NOTE-01 整体保持 planned。
- m3-round3 适配仅一处：title 断言改 aria-label（原生 title 由浮层取代，断言意图不变）。
- 已知限制：固定面板在其徽标滚出视口时保留最后锚定位置（成交仍是 props.trades 当前事实）；面板打开时焦点在浮层内，页面快捷键（含 [ ] 周期）被隔离，属合同要求的详情范围拦截。
