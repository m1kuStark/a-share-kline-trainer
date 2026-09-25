# TRAIN-01 冻结训练规则并统一权息入账

```json
{
  "id": "TRAIN-01",
  "title": "冻结训练规则并统一权息入账",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "M5",
  "summary": "费用/T+1每笔读全局设置，raw显示路径不入账权息。",
  "next_action": "v0.3.2已发布；实施前冻结费用、T+1、复权和来源快照规则，并补旧训练兼容。",
  "allowed_paths": [
    "server/src/train/**",
    "server/src/db.ts",
    "server/test/**",
    "docs/work-items/tasks/TRAIN-01.md",
    "docs/specs/training/rules.md",
    "server/src/train/docs/accounting.md"
  ],
  "depends_on": [
    "REC-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/training/rules.md",
      "server/src/train/docs/accounting.md"
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
