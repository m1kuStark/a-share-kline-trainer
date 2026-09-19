# DEV-01 工作副本运行与测试资源隔离

```json
{
  "id": "DEV-01",
  "title": "工作副本运行与测试资源隔离",
  "owner": "integrator",
  "state": "closed",
  "milestone": "DEV",
  "summary": "本地Git工作副本、独立运行、候选门禁已实现并通过真实集成流程。",
  "next_action": "后续任务从main创建worktree；录像机按REC-01另行实施。",
  "allowed_paths": [
    "scripts/**",
    "server/src/config.ts",
    "server/src/index.ts",
    "server/test/**",
    "web/vite.config.ts",
    "e2e/**",
    "playwright.config.ts",
    "package.json",
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "docs/**",
    "web/AGENTS.md",
    "web/README.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/engineering/parallel-development.md",
      "docs/engineering/testing.md",
      "e2e/README.md",
      "scripts/README.md"
    ],
    "reason": "运行路径和候选门禁改变，文档需明确已实施能力及自动化证据边界。"
  },
  "verification_refs": [
    "docs/verification/2026-09/DEV-01-parallel/report.md"
  ],
  "integration_ref": "4a257c7ebf6a1665ed70d6f533113ebe1a96186c",
  "acceptance_ref": null,
  "base_commit": "746a8f6a8cf6f6b413f80b71d4b17e08e3e3857f"
}
```

工作副本、运行隔离和候选门禁已交付；使用方式见[并行协议](../../engineering/parallel-development.md)。
