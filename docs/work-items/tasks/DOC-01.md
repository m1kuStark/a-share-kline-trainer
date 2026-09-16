# DOC-01 文档架构迁移与开发基线冻结

```json
{
  "id": "DOC-01",
  "title": "文档架构迁移与开发基线冻结",
  "owner": "integrator",
  "state": "closed",
  "milestone": "DOC",
  "summary": "已获用户授权；迁移分层入口、规格、任务和证据，增加检查命令并提交开发基线。",
  "next_action": "以本提交为后续开发文档基线；业务架构任务按各自任务卡推进。",
  "allowed_paths": [
    "AGENTS.md",
    "README.md",
    ".gitignore",
    "docs/**",
    "server/**",
    "web/**",
    "e2e/**",
    "scripts/**",
    "package.json",
    "package-lock.json",
    "playwright.config.ts",
    "tsconfig.json"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "AGENTS.md",
      "README.md",
      "docs/README.md",
      "docs/engineering/documentation.md",
      "docs/engineering/testing.md"
    ],
    "reason": "本次迁移文档治理并收录工作树已有M3/R0/R1成果；文件指纹用于区分既有功能与本轮变更。"
  },
  "verification_refs": [
    "docs/verification/architecture-audit-2026-09-17.json",
    "docs/verification/2026-09/DOC-01-baseline/browser-results.json",
    "docs/verification/2026-09/DOC-01-baseline/M2-report.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/verification/2026-09/DOC-design-acceptance/record.json",
  "base_commit": "43982ea2d0df72162eb078005b57dc624e705cb5"
}
```

## 验收条件

- 分层规则和索引可导航，旧规则有明确归属。
- 现行规格、提案、历史、任务与证据分开，不降低现有产品与测试要求。
- 文档检查、影响核对和状态生成可执行，故障场景有回归。
- 验证完整功能基线，清理临时材料并提交审核后的训练器成果。

## 执行记录

- 用户确认文档架构并授权实施、清理及 Git Commit；不等于 M3/R1 产品验收通过。
- 原 HEAD 为 `43982ea`；已有功能尚未提交，按文件所有权在开发分支就地迁移，避免从旧 HEAD 创建缺少功能的副本。
- 旧文档/证据已备份至全局 Headroom 缓存；记录了93个源码、测试与配置文件的指纹。
- 分工：后端文档、前端/e2e文档、文档工具独立实现；集成人负责中央文档、阶段及最终验收。
