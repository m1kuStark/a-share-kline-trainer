# REC-01 默认操作录制与分享复盘首批

```json
{
  "id": "REC-01",
  "title": "默认操作录制与分享复盘首批",
  "owner": "integrator",
  "state": "active",
  "milestone": "REC",
  "summary": "GLM分块开发默认录制、分享导入与只读回放；主代理调度及验收。",
  "next_action": "codec/validator/storage已联合验收145测试及真实IDB，第三批3GLM并行：gzip取消死锁返修、CompactRecorder、按需回放页；随后根统一接线及两年全流程。",
  "allowed_paths": [
    "web/src/**",
    "web/README.md",
    "server/src/**",
    "server/README.md",
    "server/test/**",
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
  "verification_refs": ["docs/verification/2026-09/REC-01-capacity/report.md", "docs/verification/2026-09/REC-01-compression/report.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```
