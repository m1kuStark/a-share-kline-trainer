# NOTE-DETAIL-01 第一次限定返修验证记录（control-handoff-20260927-39）

2026-09-27。基线 d804be81025306c9c1776415ac09dcc39193c658（GPT review39 四缺陷 F1–F4，cost_owner=implementation）。候选提交 **6cbf7a679849f7a3cf1d33ac64018b2dabf3f448**（父=d804be8），验证记录由后续 docs 提交补入并继承该运行结果。

## 修复内容与根因

- **F1**（标题方向不随成交更新）：`TradeMarkerDetails.vue` 的 `sideLabel` 在 setup 期用 const 取首次 props，非响应式 → 改 `computed`。B→S→B 同挂载标题/事实一致。
- **F2**（键盘进入 hover 浮层仍被鼠标离开关闭）：Rail 把 `@focusin/@focusout` 挂在 Details 组件上，但 Details 根是 Teleport，attrs 不透传到真实 div（GPT 编译探针证实 extraneous listeners）→ Details 显式声明 `focusIn/focusOut` emits 并在真实 div 上绑定转发，Rail 改用 `@focus-in/@focus-out`。presence.focusPanel 从此真实生效。
- **F3**（固定后徽标离屏浮层消失）：reducer sync 本就保留 pinned 状态，但 Rail 的 `panelSelected` 只从屏内 marker 派生、`v-if` 将组件移除 → `panelSelected` 回退到当前 `props.trades` 查找（只渲染受限当前数据，列表在无屏内 marker 时隐藏，定位保留最后有效值）。回放后退 trades 收缩 → 回退查找为 null 且 sync 置 null，立即清空，不缓存未来。
- **F4**（深色聚合列表深字叠深底不可读）：`.details-list button` 固定浅色 `#334155`，dark 规则只覆盖了背景 → 补 `body.dark .details-list button { color: var(--text-primary) }`（解析为 #e4e4e4）。

## RED→GREEN（真实浏览器序列，非 reducer/DOM 文本断言）

- 新增/修改 Journey（e2e/trade-marker-details.spec.ts）：F1 用含卖出夹具（单笔B＋聚合B2＋30 个交易日后单笔S，B/S 间距约 200px 互不在对方面板覆盖内）同一挂载 B→S→B 断言标题==事实方向、序号随切；F2 复现 GPT 序列（hover→Shift+Tab 进面板→鼠标移开 400ms 保留且焦点不丢→Tab 出面板收起）；F3 真实滚轮平移至徽标离屏断言浮层保留事实、回视口恢复锚定；F4 在深/浅循环中断言列表行 computed color 亮度（dark>400，light<400）。
- **RED**（stash 组件修复后对基线 d804be8 运行，`01-red-journey-details.log`）：恰好 4 败（F1 标题 toHaveText 失败、F2 toBeVisible 失败、F3 toBeVisible 失败、视觉 F4 亮度断言失败），其余 5 项通过——失败与缺陷一一对应，无夹具性误报。
- **GREEN**：修复恢复后 9/9（`02-green-journey-details.log`）；最终候选 HEAD 复跑 9/9（`03-final-journey-details.log`，run-cf752374）。
- 首次 RED 尝试的流程偏差如实记录：修复代码先于 RED 落地，第一轮运行（run-de339fe5）实为修复后状态（仅 F1 因测试自身面板遮挡点击失败）——已用 stash 基线运行补齐真实 RED 证据；F1 首轮失败根因是测试夹具间距不足（面板物理拦截徽标点击），与产品无关。

## 最终定向门禁（候选 6cbf7a6，单验证进程串行）

| 检查 | 结果 |
|---|---|
| Journey details 9 项（run-cf752374，冻结样本隔离拷贝/独立库/端口） | 9/9 通过（`03` 日志） |
| Journey m3-round3 4 项（密集标记回归，run-7ed14962） | 4/4 通过（`04` 日志） |
| 定向单测 trade-marker＋frontend-contract＋frontend-data-status（maxWorkers=1） | 57/57 通过（`05`） |
| vue-tsc -p web（noEmit） | 退出 0（`06`） |
| npm run build（typecheck+server+vite） | 退出 0（`07`） |
| docs:status / status --check / check / impact --base 3f8c612 | 全部 0 错误（`08`–`10`；impact 相对返修基线 d804be8 会误报 display.md/NOTE-01 卡"已声明未更新"——两文件在 d804be8 提交已更新、本轮无需再动，属基线口径问题，已按功能原始基线复跑确认） |

## 执行者视觉自验（不替代 GPT 验收）

- F3 截图 `details-pin-offscreen.png`：图表已平移至 2024 历史（屏内 0 徽标），固定浮层保留在最后有效位置，事实=当前成交（#2/1,443.98 元/2025-01-13），无未来数据。
- F4 截图 `details-dark-840.png`：深色聚合列表行亮字清晰可读（选中/未选中均可辨），浅色 `details-light-840.png` 不回归。

## 组件边界为何未被纯测试覆盖（防遗漏）

状态机纯单测（node 环境，无组件挂载设施）验证 reducer 语义；F1/F2 属 Vue 响应性与 Teleport 组件边界（const 非响应、attrs 不穿透 Teleport），F3 属渲染派生链（reducer 保留 state 但 v-if 读屏内 marker），F4 属 computed style——四者都只在该组件真实渲染/交互中显形。防遗漏规则：改变不同语义的 props 不重挂载、focus-only 与 click-open 分别真实键盘验证、状态保留必须同时断言实际渲染与数据边界、主题可读性断言 computed style 而非 DOM 文本——均已落入 Journey 回归。

## 边界与未运行项

- 未运行：全量 unit、全量 Journey、verify:candidate、发布门禁——由 GPT 集成侧组织。
- 未触碰：KlineChart.vue、server/src、api.ts、录像 schema、聚合算法、SETUP 相关；无新依赖；防未来/盲训/无写请求回归保持通过。
- 已知限制（沿用 review39 非阻断项）：离屏固定面板无笔次列表（仅选中事实，受限当前数据）；长行 ellipsis；固定面板位置为最后有效锚点。
- 角色区分：本记录为执行者（GLM 会话）自验证据；GPT 限定复核前不称验收。
