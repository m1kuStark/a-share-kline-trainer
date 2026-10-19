# 前端

Vue 3 页面和 klinecharts 图表运行在此目录。API 类型与请求封装在 [src/api.ts](./src/api.ts)，训练交易和防未来口径由 [训练规格](../docs/specs/training/rules.md) 定义。

成绩单的逐笔成交表由 [HistoryReport.vue](src/components/HistoryReport.vue) 展示；窄窗时仅表格区域横向滚动，保留全部列，可聚焦后用方向键查看，不能靠裁掉数值消除页面溢出。

```json
{"kind":"module","source_paths":["web/**"],"canonical_docs":["web/README.md","web/src/components/README.md","web/src/views/README.md"]}
```

| 要做的事 | 从这里读 |
|---|---|
| 改页面布局、周期请求、账户同步或快捷键 | [views 页面编排](./src/views/README.md) |
| 改图表命中、手势、画线或库依赖 | [components 图表入口](./src/components/README.md) |
| 改自动保存、撤销、刷新恢复 | [画线持久化](./src/components/docs/drawing-persistence.md) |
| 改操作录制、导入导出与离线回放 | [recording 模块](./src/recording/README.md) |
| 改颜色、蜡烛、日期、成交标记或显示根数 | [显示规格](../docs/specs/chart/display.md)，再定位 [theme.ts](./src/theme.ts)、[indicators.ts](./src/indicators.ts)、[TradeMarkerRail.vue](./src/TradeMarkerRail.vue) |
| 加界面回归或执行浏览器验收 | [E2E 入口](../e2e/README.md) 与 [测试协议](../docs/engineering/testing.md) |

[App.vue](./src/App.vue) 负责启动、首页/训练切换、按训练 id 重建视图以及数据更新状态控件；[dataStatus.ts](./src/dataStatus.ts) 是数据状态响应式单例。启动检查、回前台检查和轮询共享该 store；首页和训练页都以 `freshness` 判断新鲜度，兼容位 `needsUpdate` 不驱动黄色提醒或已最新结论。手动扫描的终态结果（包括没有新数据）和错误在训练页固定反馈区显示。

图表相关纯函数目前仍在 `src/`：几何、overlay 注册、画线快照、工具偏好、周期导航和成交聚合各自独立。`components/` 当前只有图表组件，尚无独立 chart adapter 目录。

仓库根目录执行 `npm run dev` 启动开发服务；`npm run typecheck:web` 检查 Vue 类型，`npm run build:web` 生成生产页面。开发端口为 5173，API 为 8787；Agent使用npm run agent:dev，Journey使用独立动态端口与产物；见[运行协议](../docs/engineering/parallel-development.md)。

[Vite 配置](vite.config.ts) 的 `/api` 代理显式保留原 Host，使浏览器 Origin 与访问地址一致，通过[服务入口守卫](../server/README.md#本机-http-边界)。不要改回字符串代理的默认 `changeOrigin: true`；这会使开发页面写请求被 403 拒绝。setup/control 的独立令牌与来源规则仍生效。
