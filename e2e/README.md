# 真实事件浏览器回归

Playwright 使用系统 Edge，验证训练、图表和数据更新的真实操作。公共门禁与 failure pattern 维护见 [测试协议](../docs/engineering/testing.md)，图表只读接口见 [库适配](../web/src/components/docs/library-adapter.md)。

```json
{"kind":"module","source_paths":["e2e/**","playwright.config.ts"],"canonical_docs":["e2e/README.md","e2e/AGENTS.md"]}
```

## 套件入口

| 文件 | 适用场景 |
|---|---|
| [journey.spec.ts](./journey.spec.ts) | 六幕基础链：训练创建、画线生命周期、手势矩阵、多选、交易与周期、主题。包含空白解选和主副图同权。 |
| [m3-tools.spec.ts](./m3-tools.spec.ts) | 实画、编辑、文字、周期锚点、保存恢复和故障注入。 |
| [m3-feedback.spec.ts](./m3-feedback.spec.ts) | 工具自定义拖拽、固定保存栏几何和滚动、折叠与双主题多尺寸。 |
| [m3-round3.spec.ts](./m3-round3.spec.ts) | 周期快捷键、实际 840 范围/1040 初始供给、尺寸变化、纯黑主题、诅咒线、密集成交条。 |
| [cost-basis.spec.ts](./cost-basis.spec.ts) | 含权息账户成本与图表、清仓后行情 GET 失败、跨周期和刷新。 |
| [pane-resize.spec.ts](./pane-resize.spec.ts) | 分隔条 7px 命中边缘、默认/多选/Ctrl/绘图/最大化、右轴侧与拖后框选。 |
| [compact-chart.spec.ts](./compact-chart.spec.ts) | 紧凑顶部、详情不挤图、控件空格保护、刷新和真实末日。 |
| [data-update.spec.ts](./data-update.spec.ts) | 日线更新控件、开始前提醒、状态切换、中文错误和响应布局。 |

测试文件按任务选择，不能把基础六幕覆盖等同于所有工具或组合已验收。实际执行清单可用 `npx playwright test --list` 查看；列清单不是浏览器运行。

## 运行与共享资源

在仓库根运行 `npm run journey`，脚本依次 build:journey、Playwright。[配置](../playwright.config.ts) 当前固定 `http://127.0.0.1:8791`、`workers: 1`、默认 retries=1；提验需保留首次失败，可用 `npm run journey -- --retries=0` 显式禁重试。

定向运行先 `npm run build:journey`，再 `npx playwright test e2e/pane-resize.spec.ts --retries=0`。构建将覆盖共用 `server/dist` 和 `web/dist`，不可与生产构建、其他 Journey 或其他代理浏览器验收并行。

[global-setup.ts](./global-setup.ts) 在临时目录创建 SQLite 库，通过 TRAINER_DB、PORT=8791、OPEN_BROWSER=0 启动服务；先探测端口，子进程退出立即报告 stderr，返回的 teardown 结束该子进程。每次运行临时库不同，但同次套件/重试共用库，每个测试必须 resetToLauncher，经 API 放弃残留活动训练。

数据库独立，端口、构建、报告及截图仍共享，完整隔离待 [DEV-01](../docs/work-items/tasks/DEV-01.md)。端口异常先查 PID 与命令行归属；不杀未知服务。启动超时、强制中断后检查本轮进程是否残留；当前 teardown 只结束服务，不承诺清理临时数据库目录。

运行后执行 `npm run build:web` 恢复生产产物，并检查日常页面没有 `window.__trainerChart`。本轮是否完成这些步骤写入验证记录，不能沿用上次结论。

## 断言和诊断

见[断言与证据](docs/assertions.md)。
