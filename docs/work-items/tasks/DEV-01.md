# DEV-01 工作副本运行与测试资源隔离

```json
{
  "id": "DEV-01",
  "title": "工作副本运行与测试资源隔离",
  "owner": "integrator",
  "state": "active",
  "milestone": "DEV",
  "summary": "落实任务worktree、运行隔离、固定样本和候选集成门禁。",
  "next_action": "运行层和Git层并行实现，验证双实例与合并故障路径。",
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
    "docs/verification/architecture-audit-2026-09-17.json"
  ],
  "integration_ref": null,
  "acceptance_ref": null,
  "base_commit": "746a8f6a8cf6f6b413f80b71d4b17e08e3e3857f"
}
```

当前登记为后续任务，本轮文档迁移不实现其业务变更。
