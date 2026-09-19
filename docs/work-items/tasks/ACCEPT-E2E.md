# ACCEPT-E2E

```json
{
  "id": "ACCEPT-E2E",
  "title": "阶段返修浏览器回归适配",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "REC",
  "summary": "既有回归适配已合入。",
  "next_action": "执行精确候选验收。",
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
  "integration_ref": "de88fac",
  "acceptance_ref": null
}
```

[Worker record](../../verification/2026-09/ACCEPT-01-night/accept-e2e-worker.md).
