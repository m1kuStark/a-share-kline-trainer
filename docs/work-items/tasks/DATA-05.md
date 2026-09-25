# DATA-05

```json
{
  "id": "DATA-05",
  "title": "数据新鲜度与盘后状态",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "R1",
  "summary": "FRESH-01 integrated; implement coordinator and visible home status using an offline official 2026 calendar.",
  "next_action": "Follow docs/work-items/prompts/DATA-05-integration.md; implementation then independent product review.",
  "base_commit": "af0efafc48ce24e247f3c273b1ee4926be8765c5",
  "allowed_paths": [
    "server/src/data/**",
    "server/test/data-refresh.test.ts",
    "server/test/data-freshness.test.ts",
    "server/test/data-calendar.test.ts",
    "server/test/data-status-timing.test.ts",
    "web/src/api.ts",
    "web/src/dataStatus.ts",
    "web/src/App.vue",
    "e2e/data-update.spec.ts",
    "docs/specs/market-data/requirements.md",
    "docs/work-items/tasks/DATA-05.md",
    "docs/work-items/prompts/DATA-05-integration.md",
    "docs/verification/2026-09/DATA-05/**"
  ],
  "depends_on": [
    "FRESH-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/market-data/requirements.md"
    ],
    "reason": "Distinguish market freshness from local scan result and document offline calendar scope."
  },
  "verification_refs": [
    "docs/verification/2026-09/DATA-05/calendar-source.json"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[Implementation contract](../prompts/DATA-05-integration.md). Existing pure module is authoritative; do not replace it with the alternative desktop branch.
