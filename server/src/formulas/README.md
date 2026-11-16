# 公式库与求值（服务端）

本模块实现 M9-04A：本机 SQLite 公式库、通达信文本导入、只读校验/求值 API。产品口径见 [任务卡](../../../docs/work-items/tasks/M9-04A.md) 与 [提案](../../../docs/proposals/M9-04-formula-product-ui.md)。

| 要做什么 | 入口 | 注意 |
|---|---|---|
| 增改校验/求值契约 | [api.ts](./api.ts) | 响应形状/状态码属调用合约；只读接口不得写训练/画线/录像/账户 |
| 改公式表或字段 | [storage.ts](./storage.ts)、[db.ts](../db.ts) | 走 `db.ts` 兼容迁移，不重建既有表；名称大小写不敏感唯一 |
| 改取数/上下文 | [data.ts](./data.ts) | 训练上下文必须先截断至推进日再复权聚合（复用 `trainingBars` 唯一链路）；独立证券走 TDX 日线只读并标注不复权；随机训练按 M7-01 遮蔽 |
| 改引擎加载 | [engine.ts](./engine.ts) | 唯一来源 `web/src/formula-engine`；生产加载构建期 bundle（`scripts/build/formula-engine-bundle.mjs`），dev/测试回退纯值入口；不得复制引擎实现 |
| 改文本导入 | [text.ts](./text.ts) | 只做 BOM/CRLF/首尾空白与全角告警，不改写用户公式语义 |

定向测试：`npm test -- server/test/formulas server/test/formula-library-api.test.ts server/test/formula-random-guard.test.ts`（仓库根执行）。
