# REL-DOC Public installation and user documentation

```json
{
  "id": "REL-DOC",
  "title": "Public installation and user documentation",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "REL",
  "summary": "Public installation and user documentation",
  "next_action": "Source review corrections integrated; finalize service-stop and backup instructions after launcher lifecycle tests, then check packaged links.",
  "allowed_paths": [
    "README.md",
    "docs/user/**",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docs/work-items/tasks/REL-DOC.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-DOC.md"
    ],
    "reason": "User authorized packaging accepted baseline and publicGitHub release."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-01-docs/worker-report.md"
  ],
  "integration_ref": "367ff416a352e58a8da4f8fff6c4848e07af0391",
  "acceptance_ref": null
}
```

[Release contract](../../engineering/release-m3-contract.md). Detailed worker report is linked above. Root verified public-only commands, replay-vs-database distinction and exact browser origin; portable shutdown instructions are pending the dedicated launcher fix.
