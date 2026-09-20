# REL-CI-LAUNCH

```json
{
  "id": "REL-CI-LAUNCH",
  "title": "Portable lifecycle CI regression",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REL",
  "summary": "Serialize launcher reuse/cleanup decisions under the lifecycle lock; platform-neutral config fixtures; identity-gated test cleanup.",
  "next_action": "Root targeted regressions passed; awaiting exact candidate, real ZIP and Windows/Linux CI.",
  "allowed_paths": [
    "scripts/release/launcher.cjs",
    "server/test/release-launcher.test.ts",
    "docs/work-items/tasks/REL-CI-LAUNCH.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-CI-LAUNCH.md"
    ],
    "reason": "GitHub Linux CI exposed an actual start/stop race and a Windows-only fixture path."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-02/review.json"
  ],
  "integration_ref": "0f028311cc1d3d63cbe6b1ba2ae27887d75b8af5",
  "acceptance_ref": null
}
```

Worker report retained in verification/2026-09/REL-02.
