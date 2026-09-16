# DATA-04 统一行情读取与更新入口

```json
{
  "id": "DATA-04",
  "title": "统一行情读取与更新入口",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "R2",
  "summary": "DailySource仅扫描；训练直读TDX，env/stocks独立刷新仍在。",
  "next_action": "统一bars/actions/coverage/version读取；用非TDX夹具运行训练，再接真实来源。",
  "allowed_paths": [
    "server/src/**",
    "server/test/**",
    "web/src/api.ts",
    "docs/work-items/tasks/DATA-04.md",
    "server/src/data/docs/source-contract.md"
  ],
  "depends_on": [
    "DATA-03"
  ],
  "docs_impact": {
    "update": [
      "server/src/data/docs/source-contract.md"
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
