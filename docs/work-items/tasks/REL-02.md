# REL-02 v0.3.1 CI correction release

```json
{
  "id": "REL-02",
  "title": "v0.3.1 CI correction release",
  "owner": "integrator",
  "state": "closed",
  "milestone": "REL",
  "summary": "Integrate reviewed lifecycle/gzip corrections and deliver the validated patch.",
  "next_action": "v0.3.1 delivered, both platform CI and public downloads verified; continue future work from the new main baseline.",
  "allowed_paths": [
    "**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-02.md",
      "web/src/recording/recording-file.md",
      "docs/engineering/release-build.md"
    ],
    "reason": "Published Linux CI exposed a launcher race and tiny-input decompression overhead."
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-01-release/report.md",
    "docs/verification/2026-09/REL-02/review.json",
    "docs/verification/2026-09/REL-02/report.md"
  ],
  "integration_ref": "dbe6727c035f1f2f02e82bd3c4d62a5c5ad88ab0",
  "acceptance_ref": null
}
```

[Final release evidence](../../verification/2026-09/REL-02/report.md). Module implementation and failure history are preserved in the referenced verification records.
