# REL-01 M3 packaging and open-source release

```json
{
  "id": "REL-01",
  "title": "M3 packaging and open-source release",
  "owner": "integrator",
  "state": "active",
  "milestone": "REL",
  "summary": "M3 packaging and open-source release",
  "next_action": "Windows0.3.0 deployed and published; resolve GitHubLinux CI launcher/gzip failures before closing release automation.",
  "allowed_paths": [
    "**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-01.md",
      "docs/engineering/public-source.md",
      "server/README.md",
      "scripts/README.md"
    ],
    "reason": "User authorized packaging accepted baseline and publicGitHub release."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-01-source/record.json",
    "docs/verification/2026-09/REL-01-release/report.md"
  ],
  "integration_ref": "29fec35f3a17539a6aa1a04b7b09f4a30f00b10f",
  "acceptance_ref": null
}
```

[Release contract](../../engineering/release-m3-contract.md).

Three isolated GLM5.3Flash/max workers cover launcher, package builder and public user docs. Integrator owns source export, license audit, release identity and delivery. The original private history and 7529 user data remain retained. User explicitly directed MIT publication after the table audit; its upstream license status remains disclosed. Actual clean-room checks and branch integration are still pending.
