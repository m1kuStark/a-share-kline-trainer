# ACCEPT-E2E

```json
{
  "id": "ACCEPT-E2E",
  "title": "阶段返修浏览器回归适配",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REC",
  "summary": "跟随用户新交互适配原回归，保留业务断言。",
  "next_action": "定向验证后交集成人联合检查。",
  "allowed_paths": [
    "e2e/training-flow.ts",
    "e2e/recording.spec.ts",
    "e2e/recording-long.spec.ts",
    "e2e/recording-migration.spec.ts",
    "e2e/journey.spec.ts",
    "e2e/m3-feedback.spec.ts",
    "e2e/m3-tools.spec.ts",
    "docs/work-items/tasks/ACCEPT-E2E.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/ACCEPT-E2E.md"
    ],
    "reason": "用户行为改变，对应既有自动用例需真实按钮确认并按日回放。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[当前合同](../../engineering/stage-feedback-20260919.md)。
