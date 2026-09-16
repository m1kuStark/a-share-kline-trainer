# 前端

Vue 3 页面和 klinecharts 图表运行在此目录。API 类型与请求封装在 [src/api.ts](./src/api.ts)，训练交易和防未来口径由 [训练规格](../docs/specs/training/rules.md) 定义。

```json
{"kind":"module","source_paths":["web/**"],"canonical_docs":["web/README.md","web/src/components/README.md","web/src/views/README.md"]}
```

| 要做的事 | 从这里读 |
|---|---|
| 改页面布局、周期请求、账户同步或快捷键 | [views 页面编排](./src/views/README.md) |
| 改图表命中、手势、画线或库依赖 | [components 图表入口](./src/components/README.md) |
| 改自动保存、撤销、刷新恢复 | [画线持久化](./src/components/docs/drawing-persistence.md) |
| 改颜色、蜡烛、日期、成交标记或显示根数 | [显示规格](../docs/specs/chart/display.md)，再定位 [theme.ts](./src/theme.ts)、[indicators.ts](./src/indicators.ts)、[TradeMarkerRail.vue](./src/TradeMarkerRail.vue) |
| 加界面回归或执行浏览器验收 | [E2E 入口](../e2e/README.md) 与 [测试协议](../docs/engineering/testing.md) |

[App.vue](./src/App.vue) 负责启动、首页/训练切换、按训练 id 重建视图以及数据更新状态控件；[dataStatus.ts](./src/dataStatus.ts) 是数据状态响应式单例。启动检查、回前台检查和轮询共享该 store；`needsUpdate` 仅是更新建议，不可替代训练数据完整性判断。

图表相关纯函数目前仍在 `src/`：几何、overlay 注册、画线快照、工具偏好、周期导航和成交聚合各自独立。`components/` 当前只有图表组件，尚无独立 chart adapter 目录。

仓库根目录执行 `npm run dev` 启动开发服务；`npm run typecheck:web` 检查 Vue 类型，`npm run build:web` 生成生产页面。开发端口为 5173，API 为 8787；Journey 使用 8791，并覆盖同一 `web/dist`，不能并发构建或运行，见 [DEV-01](../docs/work-items/tasks/DEV-01.md)。
