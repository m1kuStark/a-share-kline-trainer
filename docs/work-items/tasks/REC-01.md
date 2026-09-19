# REC-01 默认操作录制与分享复盘首批

```json
{
  "id": "REC-01",
  "title": "默认操作录制与分享复盘首批",
  "owner": "integrator",
  "state": "active",
  "milestone": "REC",
  "summary": "GLM分块开发默认录制、分享导入与只读回放；主代理调度及验收。",
  "next_action": "退出超时与录制区布局已修复；重建候选跑完整门禁后交用户验收。",
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
    "docs/verification/2026-09/REC-01-capacity/report.md",
    "docs/verification/2026-09/REC-01-compression/report.md",
    "docs/verification/2026-09/REC-01-release-fixes/report.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```
