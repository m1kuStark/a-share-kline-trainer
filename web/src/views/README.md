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
| 操作录制 | [recording入口](../recording/README.md)；首页每场默认开启，Training负责请求结果和失败语义，图表负责实际手势。准备期间锁交互，失败提供重试。 |
| 离线回放 | [SessionReplay实现](recording-replay.md)，按交易日前进与独立周期观察；暂停缺口常驻，不重新成交 |
| 训练排行 | [Rankings.vue](./Rankings.vue) 顶层为训练周期、行业和单股；训练周期下用 `tier`/`range` 切固定周期与自定义区间，`cycleMode` 保留返回时的子列表，`loadVersion` 拒绝迟到响应。分组与指标口径见 [排行规格](../../../docs/specs/training/rankings.md)。 |

[App.vue](../App.vue) 按训练 id 重建 Training；URL `training` 参数可重开已结算训练，离开时清参数。全局 dataStatus 检查与轮询不由每个页面重复启动。训练页更新按钮仅在官方日历判定 `freshness=stale` 时提示待更新，不用兼容位 `needsUpdate` 判断；按钮固定宽度，独立反馈区显示扫描中、完成（含没有新数据）、失败及重试指引。扫描完成与市场数据已最新分别表达，休市不能误报待更新。阶段价位线的前收来自同一推进日、同一复权基准的已截断日线，周/月观察不改变比较基准。

改布局先看 [显示规格](../../../docs/specs/chart/display.md)，改手势/热键看 [交互规格](../../../docs/specs/chart/interaction.md)，组件实现看 [图表入口](../components/README.md)。浏览器回归按 [E2E 入口](../../../e2e/README.md) 选择；M3、R1 的验收状态仅以 [status](../../../docs/status.md) 及引用证据为准。
