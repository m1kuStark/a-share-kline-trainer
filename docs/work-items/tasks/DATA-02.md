# DATA-02 个股覆盖与到期结算

```json
{
  "id": "DATA-02",
  "title": "个股覆盖与到期结算",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "R1",
  "summary": "全市场末日及单一源尾不能证明个股区间无漏数。",
  "next_action": "加入他股更新但目标漏数、结束日后有记录但中间漏数样例；未知保持running。",
  "allowed_paths": [
    "server/src/train/**",
    "server/test/train-engine.test.ts",
    "docs/work-items/tasks/DATA-02.md",
    "docs/specs/market-data/requirements.md",
    "server/src/train/docs/lifecycle.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/market-data/requirements.md",
      "server/src/train/docs/lifecycle.md"
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
