# REC-01 默认操作录制与分享复盘首批

```json
{
  "id": "REC-01",
  "title": "默认操作录制与分享复盘首批",
  "owner": "integrator",
  "state": "review",
  "milestone": "REC",
  "summary": "紧凑录制已集成，用户返修见ACCEPT-01。",
  "next_action": "Await explicit user stage acceptance; M4/M5 blocked.",
  "allowed_paths": [
    "web/src/**",
    "web/README.md",
    "server/src/**",
    "server/README.md",
    "server/test/**",
    "server/vitest.config.ts",
    "e2e/**",
    "docs/specs/recording.md",
    "docs/proposals/session-recorder/**",
    "docs/work-items/tasks/REC-01.md",
    "docs/**",
    "AGENTS.md",
    "README.md",
    "scripts/**",
    "package.json",
    "web/vite.config.ts"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/recording.md",
      "docs/engineering/model-delegation.md"
    ],
    "reason": "实现时同步覆盖边界、格式版本和验收要求。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ACCEPT-01-release/report.md"
  ],
  "integration_ref": "c0ad1112f9f6d98df9acd3c6d5c6446ac54480b4",
  "acceptance_ref": null
}
```
