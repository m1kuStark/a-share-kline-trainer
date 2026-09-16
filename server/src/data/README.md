# 日线更新与来源选择

本目录选择可用来源、扫描文件状态、协调刷新并生成状态响应。它尚未接管所有行情读取和缓存写入。

| 任务 | 先读 | 实现入口 |
|---|---|---|
| 修改刷新、失败回退、超时或日志 | [发布边界](./docs/publication.md) | [refresh.ts](./refresh.ts)、[snapshot.ts](./snapshot.ts) |
| 新增来源或修改增量比较 | [来源合约](./docs/source-contract.md) | [source.ts](./source.ts)、[selection.ts](./selection.ts) |
| 修改本地文件稳定扫描 | [来源合约](./docs/source-contract.md) | [tdxSource.ts](./tdxSource.ts)，格式见 [TDX](../tdx/README.md) |
| 调查刷新后训练能否继续 | [数据要求](../../../docs/specs/market-data/requirements.md) | [训练生命周期](../train/docs/lifecycle.md)、[DATA-02](../../../docs/work-items/tasks/DATA-02.md) |

公开入口是 `createDataRefreshCoordinator()` 返回的 `start/getStatus`，由 [api.ts](../api.ts) 暴露为 `POST /api/data/refresh` 和 `GET /api/data/status`。来源插件边界是 `DailySource`，尚无真实在线适配器。

目录与权息缓存实现在 [tdx](../tdx/README.md)；全局任务进度查 [状态页](../../../docs/status.md)，测试门禁查 [验证协议](../../../docs/engineering/testing.md)。
