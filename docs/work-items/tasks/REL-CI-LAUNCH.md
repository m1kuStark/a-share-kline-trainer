# REL-CI-LAUNCH Portable lifecycle CI regression

```json
{
  "id": "REL-CI-LAUNCH", "title": "Portable lifecycle CI regression", "owner": "GLM-5.3-Flash", "state": "active", "milestone": "REL",
  "summary": "Fix platform-neutral config fixtures and serialize concurrent launcher start/stop.",
  "next_action": "Reproduce lifecycle race deterministically and fix without weakening ownership checks.",
  "allowed_paths": ["scripts/release/launcher.cjs", "server/test/release-launcher.test.ts", "docs/work-items/tasks/REL-CI-LAUNCH.md"],
  "depends_on": [], "docs_impact": {"update": ["docs/work-items/tasks/REL-CI-LAUNCH.md"], "reason": "GitHub Linux CI exposed an actual start/stop race and a Windows-only fixture path."},
  "verification_refs": ["docs/verification/2026-09/REL-01-release/report.md"], "integration_ref": null, "acceptance_ref": null
}
```
