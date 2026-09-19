# REC-03 按交易日回放与独立观察控制

```json
{
  "id": "REC-03",
  "title": "按交易日回放与独立观察控制",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "REC",
  "summary": "Day replay integrated; full gate pending.",
  "next_action": "Verify legacy and two-year recordings.",
  "allowed_paths": [
    "web/src/views/SessionReplay.vue",
    "web/src/recording/dailyReplay.ts",
    "server/test/recording-daily-replay.test.ts",
    "e2e/recording-daily.spec.ts",
    "docs/work-items/tasks/REC-03.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REC-03.md"
    ],
    "reason": "依据用户阶段反馈实施，集成人统一更新规格与证据。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ACCEPT-01-night/report.md"
  ],
  "integration_ref": "d5cf35a",
  "acceptance_ref": null
}
```

[Worker record](../../verification/2026-09/ACCEPT-01-night/rec-03-worker.md).
