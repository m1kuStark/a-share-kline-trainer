# 浏览器回归工作约束

适用范围：`e2e/**`。套件与运行步骤见 [README](./README.md)，跨层门禁见 [测试协议](../docs/engineering/testing.md)。

- 验证交互用 Playwright 真实鼠标、键盘事件；禁止用 dispatchEvent 或图表内部调用代替用户操作。`__trainerChart` 只读，可用于定位和核验，不能创建或改动图形。
- 框选矩形、菜单和编辑面板必须断言 DOM 可见。根数读取实际 visibleRange，并等待尺寸布局稳定（`CHART-VIEWPORT`）；仅截图或计数文案不够。
- 每run保留 `workers: 1`；不同worktree使用独立manifest/动态端口/数据库/构建/报告，可并行。必须通过npm run journey，不得连接未知进程或硬编码端口，截图走runtime helper。
- 每个测试开头清理活动训练。测试数据库跨同次运行及重试存活，不依赖 UI confirm 清理，也不依赖前一个用例的选中或视窗副作用。
- 启动失败保留 stderr、退出码与首次失败证据；只清理确认属于本轮的服务进程。Journey仅写独立产物；生产构建不得含测试钩子。诊断产物不能被其他运行覆盖。
- `UI-VISUAL-ACCEPTANCE` 由主代理负责：真实页面、深浅主题、桌面尺寸、状态切换、空间利用与截图排查。测试全绿是工程自验，不等于用户整体验收。
