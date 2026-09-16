# DATA-01 数据整批发布与超时屏障

```json
{
  "id": "DATA-01",
  "title": "数据整批发布与超时屏障",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "R1",
  "summary": "目录、权息和快照各自提交；catalog失败结果未统一拦截。",
  "next_action": "复现目录已改后权息失败、超时迟到提交；所有已发布表保持同一版本。",
  "allowed_paths": [
    "server/src/data/**",
    "server/src/tdx/**",
    "server/src/db.ts",
    "server/test/**",
    "docs/work-items/tasks/DATA-01.md",
    "server/src/data/docs/publication.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "server/src/data/docs/publication.md"
    ],
    "reason": "未来实施时按实际diff同步行为和边界。"
  },
  "verification_refs": [
    "docs/verification/architecture-audit-2026-09-17.json"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

当前登记为后续任务，本轮文档迁移不实现其业务变更。
