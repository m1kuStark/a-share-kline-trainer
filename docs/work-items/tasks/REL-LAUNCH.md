# REL-LAUNCH reviewed release module

```json
{
  "id": "REL-LAUNCH",
  "title": "Portable Windows launcher",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "REL",
  "summary": "Portable Windows launcher",
  "next_action": "Delivered in Windowsv0.3.0; subsequent Linux CI corrections are tracked separately under REL-CI tasks.",
  "allowed_paths": [
    "scripts/release/launcher.cjs",
    "scripts/release/Start.cmd",
    "scripts/release/Stop.cmd",
    "scripts/release/Create Shortcut.cmd",
    "scripts/release/create-shortcut.ps1",
    "scripts/release/trainer.config.example.json",
    "server/test/release-launcher.test.ts",
    "docs/work-items/tasks/REL-LAUNCH.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-LAUNCH.md"
    ],
    "reason": "Round-2 review fixes: public shutdown path (Stop.cmd/--stop), never erase a live unverified owner, reuse compatibility checks, health-probe redirect hardening."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-LAUNCH-release/record.json"
  ],
  "integration_ref": "e834ca254f0e12ae13b11b89fae7480ee323553e",
  "acceptance_ref": null
}
```

[Release contract](../../engineering/release-m3-contract.md). Full worker report retained beside verification record.
