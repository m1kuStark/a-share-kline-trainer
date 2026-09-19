# REC-03 按交易日回放与独立观察控制

```json
{
  "id": "REC-03",
  "title": "按交易日回放与独立观察控制",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "REC",
  "summary": "Day replay integrated; full gate pending.",
  "next_action": "Integrated and engineering-reviewed; overall user acceptance pending.",
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
    "docs/verification/2026-09/ACCEPT-01-release/report.md"
  ],
  "integration_ref": "c0ad1112f9f6d98df9acd3c6d5c6446ac54480b4",
  "acceptance_ref": null
}
```

[Worker record](../../verification/2026-09/ACCEPT-01-night/rec-03-worker.md).
