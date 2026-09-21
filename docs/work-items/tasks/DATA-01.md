# DATA-01 数据整批发布与超时屏障

```json
{
  "id": "DATA-01",
  "title": "数据整批发布与超时屏障",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "R1",
  "summary": "让目录、权息、文件状态和刷新结果按同一版本提交；失败和超时不能迟到写入。",
  "next_action": "已合入并通过R1完整基线门禁；后续数据版本冻结与统一来源接入分别由DATA-03/DATA-04负责。",
  "allowed_paths": [
    "server/src/data/**",
    "server/src/tdx/**",
    "server/src/db.ts",
    "server/test/data-refresh.test.ts",
    "server/test/catalog-protection.test.ts",
    "server/test/adjustment-cache.test.ts",
    "docs/work-items/tasks/DATA-01.md",
    "server/src/data/docs/publication.md",
    "docs/verification/2026-09/DATA-01-review.json"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["server/src/data/docs/publication.md", "docs/work-items/tasks/DATA-01.md"],
    "reason": "刷新事务、失败回退和超时边界改变时必须同步实现说明和证据。"
  },
  "verification_refs": [
    "server/test/data-refresh.test.ts",
    "server/test/catalog-protection.test.ts",
    "server/test/adjustment-cache.test.ts",
    "server/src/data/docs/publication.md"
  ],
  "integration_ref": "f4a7584",
  "acceptance_ref": null
}
```

实现记录（2026-09-22，分支 task/DATA-01）：

1. 先失败后实现：回归 k（权息失败不得留下"目录已发布、权息未发布"的混合批次）、l（看门狗超时后迟到流程不得发布或覆盖新任务）、m（目录扫描不完整＝整批失败）在旧代码上复现失败；旧实现另以临时脚本证实混合可见状态（任务 failed 但 stocks 已单独发布新日期）。
2. 实现整批发布屏障：目录/权息扫描改为只读（`scanCatalogChanges`/`scanAdjustmentChanges`），协调器在发布屏障后的单事务内提交目录＋权息＋文件快照＋成功日志＋批次标识（`cache_meta` 三键 `catalog_batch`/`adjustment_batch`/`snapshot_batch` 同一 UUID）；屏障条件（超时或任务已结束）与提交之间为同步段，迟到写入不可能落库。目录 `failures` 非空按整批失败处理。
3. 独立入口 `refreshStockCatalog`/`refreshAdjustmentCache` 公开签名与单域事务行为不变（/api/env、训练查询路径兼容）；API 状态码与中文错误保持 202/200+joined/409 及原失败文案。
4. 验证：定向 `npm test -- server/test/data-refresh.test.ts server/test/catalog-protection.test.ts server/test/adjustment-cache.test.ts server/test/catalog.test.ts` 19/19 通过；全量 `npm test` 61 文件 773/773 通过；`npm run build:server` 通过。

当前任务不改变训练交易规则，也不写用户 7529 数据库或通达信目录。
