# FRESH-01 新鲜度纯计算模块

```json
{
  "id": "FRESH-01",
  "title": "新鲜度纯计算模块",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "R1",
  "summary": "为DATA-05提供上海收盘时刻与显式日历的可信计算。",
  "next_action": "只实现纯模块与失败回归，不改refresh/API/UI。",
  "allowed_paths": [
    "server/src/data/freshness.ts",
    "server/test/data-freshness.test.ts",
    "docs/work-items/tasks/FRESH-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/FRESH-01.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。
