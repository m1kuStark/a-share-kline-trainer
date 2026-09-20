# REL-SMOKE Portable package integrity inspection

```json
{
  "id": "REL-SMOKE",
  "title": "Portable package integrity inspection",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REL",
  "summary": "Inspect actual extracted package hashes, required files and local user-document links.",
  "next_action": "Implement read-only package verification; integrator runs it on the real extracted ZIP.",
  "allowed_paths": ["scripts/release/verify.mjs", "server/test/release-integrity.test.ts", "docs/work-items/tasks/REL-SMOKE.md"],
  "depends_on": [],
  "docs_impact": {"update": ["docs/work-items/tasks/REL-SMOKE.md"], "reason": "Reusable packaging acceptance inspector; no product behavior changes."},
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

Read-only package checks do not replace actual Windows startup, browser acceptance or user acceptance.
