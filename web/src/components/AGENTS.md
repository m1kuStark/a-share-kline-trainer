# 图表组件工作约束

适用范围：`web/src/components/**`。实现地图见 [README](./README.md)。相关几何、样式和持久化模块仍位于上一级 `src/`。

- `CHART-GESTURE-PRIORITY`：修改前读 [事件仲裁](./docs/interaction.md)。分隔条原生命中带拥有整次手势；任何新模式都须明确与取点、多选、框选、轴缩放的互斥及释放路径。
- `CHART-LIBRARY-PIN`：klinecharts 固定 10.0.3。新增内部结构依赖先查源码并登记 [库适配](./docs/library-adapter.md)；升级逐项复核登记表，不能只改版本号。
- 图形显示和命中共用几何口径；副图坐标换算使用 `absolute: true`。新增监听器必须有对应卸载，并更新 [生命周期清单](./docs/interaction.md)。
- `DRAWING-PERSISTENCE`：只保存已完成的用户图形，锚点用 `timestamp + value`；引擎标记与成本线不得进入选择、历史或保存链，详见 [持久化](./docs/drawing-persistence.md)。
- `CHART-VIEWPORT`：程序化缩放先恢复纵轴自动适配；动态前插使用库自锚定，不额外补偿滚动。可视范围与日期在布局稳定后检查。
- 图表交互修复需补真实事件回归；库覆盖需补契约断言。只读测试 hooks 不能用于创建、移动或删除图形；`UI-VISUAL-ACCEPTANCE` 的主代理视觉检查仍须完成，见 [E2E 规则](../../../e2e/AGENTS.md)。
