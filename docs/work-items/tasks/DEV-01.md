# DEV-01 工作副本运行与测试资源隔离

```json
{
  "id": "DEV-01",
  "title": "工作副本运行与测试资源隔离",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "DEV",
  "summary": "固定端口、个人默认库及共享构建/报告使并行验收不安全。",
  "next_action": "独立端口、数据库、静态目录、报告和进程身份；两个工作副本互不污染。",
  "allowed_paths": [
    "scripts/**",
    "server/src/config.ts",
    "server/src/index.ts",
    "e2e/**",
    "playwright.config.ts",
    "web/vite.config.ts",
    "package.json",
    "server/test/**",
    "docs/work-items/tasks/DEV-01.md",
    "docs/engineering/parallel-development.md",
    "e2e/README.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/engineering/parallel-development.md",
      "e2e/README.md"
    ],
    "reason": "未来实施时按实际diff同步行为和边界。"
  },
  "verification_refs": [
    "docs/verification/architecture-audit-2026-09-17.json"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

当前登记为后续任务，本轮文档迁移不实现其业务变更。
