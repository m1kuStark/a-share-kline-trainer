# REL-CI-LAUNCH

```json
{
  "id": "REL-CI-LAUNCH",
  "title": "Portable lifecycle CI regression",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "REL",
  "summary": "Serialize launcher reuse/cleanup decisions under the lifecycle lock; platform-neutral config fixtures; identity-gated test cleanup.",
  "next_action": "v0.3.1 delivered, both platform CI and public downloads verified; continue future work from the new main baseline.",
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
    "docs/verification/2026-09/REL-02/review.json",
    "docs/verification/2026-09/REL-02/report.md"
  ],
  "integration_ref": "0f028311cc1d3d63cbe6b1ba2ae27887d75b8af5",
  "acceptance_ref": null
}
```

[Final release evidence](../../verification/2026-09/REL-02/report.md). Module implementation and failure history are preserved in the referenced verification records.
