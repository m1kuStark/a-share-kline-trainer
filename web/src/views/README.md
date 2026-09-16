# 页面编排

[Launcher.vue](./Launcher.vue) 负责选股、训练参数和开始前的数据更新提醒；[Training.vue](./Training.vue) 负责训练布局、请求、账户展示、周期、热键、工具栏与画线保存。页面不直接实现账户核算，规则见 [训练规格](../../../docs/specs/training/rules.md)。

| 修改范围 | 需要理解的接线 |
|---|---|
| 周期与刷新 | `loadVersion` 拒绝过期响应；动态历史传入图表后再由 `dataVersion` 守卫。刷新按训练边界读取，回到最新只调用图表 resetView。 |
| 交易与推进 | 成功响应立即同步账户和 chartCostPrice，再加载行情；后续 GET 失败也不能让清仓成本线残留。历史成交仍使用 chartPrice。 |
| 日期与布局 | 图表 `viewportDates` 返回可见末根/载入末根；日K日期与周/月周期明确区分。当前训练日常驻，次要信息浮层不挤动图表；顶部控件 Space 保留原生操作。 |
| 画线/多选/工具自定义 | 页面切模式与工具，图表裁决画布事件。自定义期间隔离绘图和交易热键；常用工具保存在本机浏览器。 |
| 快捷键 | 输入、编辑面板、自定义和未完成绘图各有守卫；中括号周期循环由 [chartNavigation.ts](../chartNavigation.ts) 处理。完整行为见交互规格。 |
| 保存状态 | 读取失败禁用绘图；异步写入和离页恢复见 [持久化](../components/docs/drawing-persistence.md)。 |

[App.vue](../App.vue) 按训练 id 重建 Training；URL `training` 参数可重开已结算训练，离开时清参数。全局 dataStatus 检查与轮询不由每个页面重复启动。训练页数据更新按钮固定宽度，终态短提示不改变栏高。

改布局先看 [显示规格](../../../docs/specs/chart/display.md)，改手势/热键看 [交互规格](../../../docs/specs/chart/interaction.md)，组件实现看 [图表入口](../components/README.md)。浏览器回归按 [E2E 入口](../../../e2e/README.md) 选择；M3、R1 的验收状态仅以 [status](../../../docs/status.md) 及引用证据为准。
