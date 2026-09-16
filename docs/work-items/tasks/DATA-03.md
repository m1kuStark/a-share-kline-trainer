# DATA-03 可读取的历史版本保护

```json
{
  "id": "DATA-03",
  "title": "可读取的历史版本保护",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "R1",
  "summary": "元数据修订检测无法恢复旧行情；追加同时改历史可能漏报。",
  "next_action": "建立迁移时基线与旧版读取；无法恢复时明确阻断，不改旧流水。",
  "allowed_paths": [
    "server/src/data/**",
    "server/src/tdx/**",
    "server/src/db.ts",
    "server/test/**",
    "docs/work-items/tasks/DATA-03.md",
    "server/src/data/docs/source-contract.md"
  ],
  "depends_on": [],
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
