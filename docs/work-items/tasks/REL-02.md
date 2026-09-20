# REL-02 v0.3.1 CI correction release

```json
{
  "id": "REL-02", "title": "v0.3.1 CI correction release", "owner": "integrator", "state": "active", "milestone": "REL",
  "summary": "Integrate reviewed lifecycle/gzip corrections and deliver the validated patch.",
  "next_action": "Reviewed integration includes immutable gzip writes and thread-compatible cwd test; rerun exact candidate, remote CI and package checks.",
  "allowed_paths": ["**"], "depends_on": [],
  "docs_impact": {"update": ["docs/work-items/tasks/REL-02.md", "web/src/recording/recording-file.md", "docs/engineering/release-build.md"], "reason": "Published Linux CI exposed a launcher race and tiny-input decompression overhead."},
  "verification_refs": ["docs/verification/2026-09/REL-01-release/report.md", "docs/verification/2026-09/REL-02/review.json"], "integration_ref": null, "acceptance_ref": null
}
```

Preserve v0.3.0 release and user data. M4/M5 remain outside this patch.
