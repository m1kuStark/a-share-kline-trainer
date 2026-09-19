# ACCEPT-01 阶段验收反馈集成

```json
{
  "id": "ACCEPT-01",
  "title": "阶段验收反馈集成",
  "owner": "integrator",
  "state": "active",
  "milestone": "REC",
  "summary": "阶段验收反馈集成",
  "next_action": "按返修合同和专属Prompt实现，定向测试后提交集成人审查。",
  "allowed_paths": [
    "web/**",
    "server/**",
    "e2e/**",
    "docs/**",
    "scripts/**",
    "AGENTS.md",
    "README.md",
    "package.json"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/ACCEPT-01.md"
    ],
    "reason": "依据用户阶段反馈实施，集成人统一更新规格与证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[返修合同](../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。
