# REL-LAUNCH Portable Windows launcher

```json
{
  "id": "REL-LAUNCH",
  "title": "Portable Windows launcher",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REL",
  "summary": "Portable Windows launcher",
  "next_action": "Implement release contract, verify and deliver for integration.",
  "allowed_paths": [
    "scripts/release/launcher.cjs",
    "scripts/release/Start.cmd",
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
    "reason": "User authorized packaging accepted baseline and publicGitHub release."
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[Release contract](../../engineering/release-m3-contract.md).
