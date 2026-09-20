# REL-CI-GZIP

```json
{
  "id": "REL-CI-GZIP",
  "title": "Tiny gzip input throughput",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REL",
  "summary": "Fixed one-byte gzip stream regression on Linux CI via bounded input coalescing; remote CI confirmation pending.",
  "next_action": "Root targeted regressions passed; awaiting exact candidate, real ZIP and Windows/Linux CI.",
  "allowed_paths": [
    "web/src/recording/recordingFile.ts",
    "server/test/recording-file.test.ts",
    "docs/work-items/tasks/REL-CI-GZIP.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-CI-GZIP.md"
    ],
    "reason": "模块文档 recording-file.md 记块=1约17s且缺合并缓冲说明，已过期，但不在本任务允许路径内，需集成人更新（见下）。"
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-02/review.json"
  ],
  "integration_ref": "295c79d85e32cd0835dba9b5f7d393cf70626d5f",
  "acceptance_ref": null
}
```

Worker report retained in verification/2026-09/REL-02.
