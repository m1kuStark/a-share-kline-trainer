# MIG-MERGE-01 历史合并导入

```json
{
  "id": "MIG-MERGE-01",
  "title": "恢复历史任务索引：v1.2.7 训练历史合并导入",
  "owner": "integrator",
  "state": "review",
  "milestone": "R5",
  "summary": "补回被 MIG-ONECLICK-01 引用的任务索引。已有实现提交 61b02335 可达当前候选，已有验证记录保留；本卡不补造用户验收。",
  "next_action": "真实旧包补验见 BUILDER-ACCEPT-01；安装包和用户验收仍单独记录。",
  "allowed_paths": [
    "desktop/src/mig-import.ts",
    "desktop/test/mig-import.test.ts",
    "docs/work-items/tasks/MIG-MERGE-01.md",
    "docs/verification/2026-10/MIG-MERGE-01/**"
  ],
  "depends_on": [
    "MIG-01"
  ],
  "docs_impact": {
    "update": [],
    "reason": "恢复历史依赖索引，不改产品行为。"
  },
  "verification_refs": [
    "docs/verification/2026-10/MIG-MERGE-01/README.md"
  ],
  "integration_ref": "61b02335b18de466642305d59a3c1ceb2bdb3688",
  "acceptance_ref": null
}
```

本卡于 2026-10-20 根据已有代码和验证记录恢复，仅补索引；原始执行结论见验证记录。
