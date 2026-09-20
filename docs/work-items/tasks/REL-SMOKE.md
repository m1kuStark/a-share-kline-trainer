# REL-SMOKE reviewed release module

```json
{
  "id": "REL-SMOKE",
  "title": "Portable package integrity inspection",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "REL",
  "summary": "Inspect actual extracted package hashes, required files and local user-document links.",
  "next_action": "Delivered in Windowsv0.3.0; subsequent Linux CI corrections are tracked separately under REL-CI tasks.",
  "allowed_paths": [
    "scripts/release/verify.mjs",
    "server/test/release-integrity.test.ts",
    "docs/work-items/tasks/REL-SMOKE.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-SMOKE.md"
    ],
    "reason": "Reusable packaging acceptance inspector; no product behavior changes."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-SMOKE-release/record.json"
  ],
  "integration_ref": "4224b291f5fc3bd83d7c3670b0aeeaf85381b656",
  "acceptance_ref": null
}
```

[Release contract](../../engineering/release-m3-contract.md). Full worker report retained beside verification record.
