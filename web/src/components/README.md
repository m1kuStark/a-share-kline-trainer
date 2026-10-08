# 图表组件

[KlineChart.vue](./KlineChart.vue) 持有图表实例、模式仲裁、选中与编辑状态、数据窗口、绘图历史和标记投影。现有库适配直接写在该组件中；本文档不表示已经拆出独立适配层。

```json
{"kind":"module","source_paths":["web/src/components/**"],"canonical_docs":["web/src/components/README.md","web/src/components/docs/interaction.md","web/src/components/docs/library-adapter.md","web/src/components/docs/drawing-persistence.md"]}
```

| 任务 | 正文与实现 |
|---|---|
| 主图均线参数 | [MaSettingsDialog.vue](./MaSettingsDialog.vue) 编辑八行草稿，[maSettings.ts](../maSettings.ts) 校验及浏览器持久化；KlineChart用公开overrideIndicator原位更新MA。日周月共用，默认25/60/144，0关闭。 |
| 改指针、快捷键、窗格或视窗 | [事件仲裁与生命周期](./docs/interaction.md)；[chartNavigation.ts](../chartNavigation.ts) |
| 升级图库、覆盖默认绘制 | [库适配登记](./docs/library-adapter.md)；[theme.ts](../theme.ts)、[indicators.ts](../indicators.ts)、[overlays.ts](../overlays.ts) |
| 改创建/编辑/撤销/恢复/保存 | [画线持久化](./docs/drawing-persistence.md)；[drawingState.ts](../drawingState.ts)、[drawingOutbox.ts](../drawingOutbox.ts) |
| 改工具形状与命中 | [drawingOverlays.ts](../drawingOverlays.ts)、[drawingGeometry.ts](../drawingGeometry.ts)、[builtInGeometry.ts](../builtInGeometry.ts) |
| 改成交聚合与图表外标记 | [TradeMarkerRail.vue](../TradeMarkerRail.vue)、[tradeMarkerLayout.ts](../tradeMarkerLayout.ts) |
| 改录制捕获或只读回放 | [录制契约](docs/recording.md)：真实动作标签、captureError、用户与程序复位 |

行为定义只维护在 [交互规格](../../../docs/specs/chart/interaction.md) 与 [显示规格](../../../docs/specs/chart/display.md)；此处记录当前接线方式和维护风险。页面输入由 [Training.vue](../views/Training.vue) 编排，交易/推进成功后同步账户成本，再读取行情。

回归入口是 [前端契约测试](../../../server/test/frontend-contract.test.ts) 和 [E2E 套件](../../../e2e/README.md)。查完成状态或验收结果时转到 [status](../../../docs/status.md)，不要从实现清单推断用户验收。
