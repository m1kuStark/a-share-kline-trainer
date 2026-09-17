# 前端工作约束

适用范围：`web/**`。页面编排、图表交互和浏览器状态的入口见 [README](./README.md)；图表修改还须读 [components 约束](./src/components/AGENTS.md)。

- 先从 [图表交互规格](../docs/specs/chart/interaction.md) 与 [显示规格](../docs/specs/chart/display.md) 找本次规则。新增模式沿现有事件入口仲裁，不能在页面另设一套指针状态机（`CHART-GESTURE-PRIORITY`）。
- 图表样式或库行为覆盖前，查钉定版本的实际绘制源码和 [依赖登记](./src/components/docs/library-adapter.md)，补相应前端契约断言（`CHART-LIBRARY-PIN`）。
- 页面异步加载保留请求版本守卫；画线载入失败时不能以空集合继续保存。保存失败、重试、成功只更新固定状态区域，详见 [持久化实现](./src/components/docs/drawing-persistence.md)（`DRAWING-PERSISTENCE`）。
- 验证可见根数须读实际范围并等布局稳定，不能只断言计数文本（`CHART-VIEWPORT`）。临时框选层、菜单和编辑面板须验证确实可见。
- 前端交付由主代理完成深浅主题、桌面尺寸、真实操作、文本溢出、控件空间和状态切换的视觉检查（`UI-VISUAL-ACCEPTANCE`）；具体门禁见 [测试协议](../docs/engineering/testing.md)。
- Journey由独立运行器构建，不能写生产web/dist；新界面测试的端口与截图路径使用运行manifest，见[E2E入口](../e2e/README.md)。

变更后更新受影响主题与任务卡，实际测试及截图放验证记录，不向本文件追加通过数或开发日志。
