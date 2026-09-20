# REL-CI-GZIP Tiny gzip input throughput

```json
{
  "id": "REL-CI-GZIP", "title": "Tiny gzip input throughput", "owner": "GLM-5.3-Flash", "state": "active", "milestone": "REL",
  "summary": "Investigate and fix one-byte gzip stream regression on Linux CI.",
  "next_action": "Measure per-chunk overhead and retain cancellation, budget and exact-data guarantees.",
  "allowed_paths": ["web/src/recording/recordingFile.ts", "server/test/recording-file.test.ts", "docs/work-items/tasks/REL-CI-GZIP.md"],
  "depends_on": [], "docs_impact": {"update": ["docs/work-items/tasks/REL-CI-GZIP.md"], "reason": "GitHub Linux 1MiB roundtrip with one-byte input exceeded existing30second deadline."},
  "verification_refs": ["docs/verification/2026-09/REL-01-release/report.md"], "integration_ref": null, "acceptance_ref": null
}
```
