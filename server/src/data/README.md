# 日线更新与来源选择

本目录选择可用来源、扫描文件状态、协调刷新并生成状态响应。它尚未接管所有行情读取和缓存写入。

| 任务 | 先读 | 实现入口 |
|---|---|---|
| 修改刷新、失败回退、超时或日志 | [发布边界](./docs/publication.md) | [refresh.ts](./refresh.ts)、[snapshot.ts](./snapshot.ts) |
| 新增来源或修改增量比较 | [来源合约](./docs/source-contract.md) | [source.ts](./source.ts)、[selection.ts](./selection.ts) |
| 修改本地文件稳定扫描 | [来源合约](./docs/source-contract.md) | [tdxSource.ts](./tdxSource.ts)，格式见 [TDX](../tdx/README.md) |
| 修改历史版本保护（指纹、记账、保留版） | [来源合约·历史版本保护](./docs/source-contract.md) | [history/store.ts](./history/store.ts)、[history/protect.ts](./history/protect.ts)、[history/fingerprint.ts](./history/fingerprint.ts) |
| 修改统一行情读取（训练用 bars/actions/coverage/version） | [来源合约·统一读取入口](./docs/source-contract.md) | [reader.ts](./reader.ts)（TDX 实现＋注册解析，回归见 [data-reader.test.ts](../../test/data-reader.test.ts)） |
| 修改新鲜度判定或交易日历 | [freshness 合同](../../../docs/engineering/release-032-contracts.md) | [freshness.ts](./freshness.ts)、[calendar.ts](./calendar.ts)（离线2026日历，生产不联网） |
| 调查刷新后训练能否继续 | [数据要求](../../../docs/specs/market-data/requirements.md) | [训练生命周期](../train/docs/lifecycle.md)、[DATA-02](../../../docs/work-items/tasks/DATA-02.md) |

公开入口是 `createDataRefreshCoordinator()` 返回的 `start/getStatus`，由 [api.ts](../api.ts) 暴露为 `POST /api/data/refresh` 和 `GET /api/data/status`。来源插件边界是 `DailySource`，尚无真实在线适配器。

目录与权息缓存实现在 [tdx](../tdx/README.md)；全局任务进度查 [状态页](../../../docs/status.md)，测试门禁查 [验证协议](../../../docs/engineering/testing.md)。
