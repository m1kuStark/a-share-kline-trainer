# REL-01 M3 packaging and open-source release

```json
{
  "id": "REL-01",
  "title": "M3 packaging and open-source release",
  "owner": "integrator",
  "state": "active",
  "milestone": "REL",
  "summary": "M3 packaging and open-source release",
  "next_action": "User directed MIT publication with table provenance disclosed; review GLM release branches, then validate clean source and Windows package before publication.",
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
  "verification_refs": ["docs/verification/2026-09/REL-01-source/record.json"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[Release contract](../../engineering/release-m3-contract.md).

Three isolated GLM5.3Flash/max workers cover launcher, package builder and public user docs. Integrator owns source export, license audit, release identity and delivery. The original private history and 7529 user data remain retained. User explicitly directed MIT publication after the table audit; its upstream license status remains disclosed. Actual clean-room checks and branch integration are still pending.
