# DATA-03 可读取的历史版本保护

```json
{
  "id": "DATA-03",
  "title": "可读取的历史版本保护",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "R1",
  "summary": "元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。",
  "next_action": "wt/C/DATA-03 开发与自测完成，待集成人串行合入（order 9）并跑受影响回归；训练/结算读取接线仍归DATA-04。",
  "allowed_paths": [
    "server/src/data/**",
    "server/src/tdx/**",
    "server/src/db.ts",
    "server/test/**",
    "docs/work-items/tasks/DATA-03.md",
    "docs/specs/market-data/requirements.md",
    "docs/status.md",
    "server/src/data/docs/source-contract.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "server/src/data/docs/source-contract.md",
      "docs/specs/market-data/requirements.md",
      "server/src/data/README.md"
    ],
    "reason": "历史版本保护已实施：按实际diff同步来源合约行为与边界、DATA-HISTORY规格现状与模块索引。"
  },
  "verification_refs": [
    "server/test/history-protection.test.ts",
    "docs/verification/architecture-audit-2026-09-17.json"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

实现与证据（分支 `wt/C/DATA-03`，基线 5bf4484，worktree trainer-wt/wt-C）：

- 修漏报（内容级差异分类）：TDX 日线文件只在尾部追加记录，故对「新文件前 prev.rows 条记录」计算前缀 SHA-256、与上一版本整文件哈希比较——逐字节一致＝纯追加（added），对不上＝追加同时改写历史（revised，旧口径因 maxDate 前移漏报为 added）。纯函数在 [fingerprint.ts](../../../server/src/data/history/fingerprint.ts)（identical/appended/rewritten/shrunk/unverifiable；任一侧无指纹一律 unverifiable，退回元数据口径不虚构结论）。
- 历史版本保护库（[store.ts](../../../server/src/data/history/store.ts)）：独立于主库的侧车 SQLite（自有 schema，不改 db.ts 兼容迁移），生产位置派生自 `TRAINER_DB` 同目录 `history-versions/`，主库 `:memory:` 时禁用，测试可注入。市场版本 lineage：刷新协调器在主库整批提交成功后 `recordMarketVersion` 记账（版本 id 与 cache_meta 批次标识一致；首版即迁移基线；未变文件只计数不落行；单事务整体生效或回滚）；文件指纹层供下一次扫描叠加做内容校验，已移除路径保留指纹供再现时校验改写。单写者＝刷新协调器，其余入口全部只读。
- 可读取保留版与只读契约（[protect.ts](../../../server/src/data/history/protect.ts)，对 M4-01 冻结合同的落地面）：`retainStockVersion` 按需保留个股 `.day` 原始字节与权息事件（保留时点固定，之后现势文件如何被改写不影响该副本）；`readRetainedStock` 无保留版时返回 `unavailable` 并给中文原因——调用方必须明确阻断，不得以现势数据顶替（改写语义）；`verifyRetainedStock` 只读比对现势与保留版指纹，漂移即报 drifted 不换数据。训练/结算历史读取路径未动，不因保护层引入改写语义；统一行情读取入口归 DATA-04。
- 扫描与刷新接线：`tdxSource` 全量读取为单次快照（一次读字节同时取末条日期、整文件哈希、前缀哈希），上一版本已有指纹且 size+mtime 未变才复用元数据（迁移时基线只贵一次）；`refresh` 协调器保护库先行解析（打开失败＝任务失败），主库整批提交成功后记账（记账失败＝任务失败，行情已更新、下次刷新以最近成功版本重新校验补记），全程中文可行动报错。
- 回归：`server/test/history-protection.test.ts` 14 项（指纹与分类、diff 重分类、基线叠加、lineage 三版、移除/再现、记账回滚、协调器首刷基线/纯追加/改写不漏报、注入与记账失败路径、保留版读取阻断与校验漂移）；其中「追加同时改写记 revised」先以错误夹具（前缀哈希误用原文件哈希）观察过 RED，修正夹具后 GREEN。全部合成 TDX 目录与独立临时库，未触真实 TDX 与个人库。

边界：市场版本记账在主库整批提交之后、非同一事务——失败时行情已更新但未记账，下次扫描以最近成功版本做内容校验跨批可验（任务按失败明确暴露，不静默放弃）；个股旧版为按需保留，未经 `retainStockVersion` 的历史数据仍不可恢复，读取侧以 `unavailable` 阻断而非冒充。