# REL-PACK Windows release packaging

```json
{
  "id": "REL-PACK",
  "title": "Reproducible Windows portable package",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "REL",
  "summary": "Reproducible Windows portable package",
  "next_action": "Delivered in Windowsv0.3.0; subsequent Linux CI corrections are tracked separately under REL-CI tasks.",
  "allowed_paths": [
    "scripts/release/build.mjs",
    "server/test/release-package.test.ts",
    "docs/engineering/release-build.md",
    "docs/work-items/tasks/REL-PACK.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-PACK.md"
    ],
    "reason": "User authorized packaging accepted baseline and publicGitHub release."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-01-package/record.json"
  ],
  "integration_ref": "bf61a128c82a29261bd46a903642b03511a1b676",
  "acceptance_ref": null
}
```

[Build protocol](../../engineering/release-build.md). Detailed worker report and root checks are retained in the linked verification directory. Real package, launcher and browser acceptance remain pending.
