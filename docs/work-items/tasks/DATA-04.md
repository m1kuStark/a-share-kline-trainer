# DATA-04 统一行情读取与更新入口

```json
{
  "id": "DATA-04",
  "title": "统一行情读取与更新入口",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "R2",
  "summary": "DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。",
  "next_action": "wt/C/DATA-04 开发与自测完成，待集成人串行合入（order 9）；api.ts 路由级 tdxRoot 守卫与 /api/kline 直读、env/stocks 独立刷新的接线放开归集成人单写文件。",
  "base_commit": "9d4c1e0",
  "allowed_paths": [
    "server/src/**",
    "server/test/**",
    "web/src/api.ts",
    "docs/work-items/tasks/DATA-04.md",
    "docs/specs/market-data/requirements.md",
    "docs/status.md",
    "server/src/data/docs/source-contract.md"
  ],
  "depends_on": [
    "DATA-03"
  ],
  "docs_impact": {
    "update": [
      "server/src/data/docs/source-contract.md",
      "docs/specs/market-data/requirements.md",
      "server/src/data/README.md"
    ],
    "reason": "统一读取入口已实施：按实际diff同步来源合约（新增统一读取入口节与边界）、DATA-SOURCE-CONTRACT规格现状与模块索引；specs纳入allowed_paths系本任务docs影响声明所需（specs现状句已过时必须同步）。"
  },
  "verification_refs": [
    "server/test/data-reader.test.ts",
    "docs/verification/architecture-audit-2026-09-17.json"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

实现与证据（分支 `wt/C/DATA-04`，基线 9d4c1e0＝wt/C/DATA-03 头，worktree trainer-wt/wt-C）：

- 统一读取入口（[reader.ts](../../../server/src/data/reader.ts)）：`MarketDataReader` 承载 bars（原始日线，未复权/未聚合/未截断）、actions（权息事件；cached 读持久缓存，fresh 绕过缓存解码来源现势字节——保留 GPT-WAKE-02 的范围预览指纹口径）、coverage（个股尾日与根数，证明不了为 null 不冒充）、version（`cache_meta` 的 snapshot_batch，DATA-01 整批发布标识）、catalog（股票目录）与 `ensureCaches`（读取前缓存保障，TDX＝权息缓存刷新）。来源解析与刷新扫描同口径（selection.ts）：`config.tdxRoot` 非空→TDX 读取器；否则注册表中第一个 `available()` 的读取器（`registerMarketReader`，测试夹具与未来在线适配器入口）；均不可用→`MarketReaderUnavailableError`，引擎映射为既有 HttpError 503（API 状态码合约不变）。
- 训练引擎切换（[engine.ts](../../../server/src/train/engine.ts)）：五处直读面全部改经读取器——tier 创建、范围快照（指纹）、范围创建目录确认、buildTrainingSeries（K线）、advanceTraining（推进）。删除 `dayFilePath` 直构路径与 gbbq 字节直读；API 错误形状逐点保持（404 TDX data not found、503 未发现数据目录、409 等待日线数据）。同步段既有边界如实保留：replayState 旧流水兼容与 buildChartSpace 画线基准仍读 `adj_factors` 持久缓存（同步函数无法经 async 读取器），缓存新鲜度由读取器 ensureCaches 保障。
- 非 TDX 夹具运行训练（本轮验收核心，[data-reader.test.ts](../../../server/test/data-reader.test.ts) 11 项）：注册合成读取器＋`tdxRoot=null` 全程跑通 创建→K线→买入→推进（权息日现金+8/10股、送股+1/10股入账，position_events 落行）→结算；范围模式预览指纹与创建复核可跑；数据尾不足时 409 等待而非虚构覆盖；无可用来源 503。TDX 读取器单测覆盖 bars 窗口、cached/fresh 权息两口径、目录/覆盖/版本；TDX 路径回归锚点（创建落库、目录外 400、快照缺失 404）。
- 回归：受影响 8 套件（train-engine/train-range-preview/train-range/train-rules-snapshot/train-account/history-protection/data-refresh/api）81 测试全过；全程合成夹具，未触真实 TDX 与个人库。

边界（如实）：本轮不接任何真实在线来源（R2 真实来源属 V2 门槛，roadmap.md:23,25）；[api.ts](../../../server/src/api.ts) 为集成人单写文件未触碰——其路由级 `tdxRoot` 503 守卫（/api/trainings、/api/training-ranges/preview、/api/kline）、/api/kline 直读与 env/stocks 独立刷新仍在，引擎层已可非 TDX 运行，API 层放开守卫归集成接线；db.ts 本任务无需变更（读取器读既有表，无新表无迁移）。