# DEP-POLICY-01 Dependabot 大版本忽略策略

```json
{
  "id": "DEP-POLICY-01",
  "title": "Dependabot 大版本忽略与依赖更新策略",
  "owner": "integrator",
  "state": "review",
  "milestone": "ENG",
  "base_commit": "bdea4c6",
  "summary": "Dependabot 在治理收尾后再次生成 pinia/@types/node/vite 等 major PR；为避免重复噪声，dependabot.yml 改为全局忽略所有 major（npm 与 github-actions），保留 klinecharts 钉定依赖全忽略；日常只自动分组 minor/patch，major 必须专项任务。记录 #29 合并、#30-33 关闭处置；产品代码零改动。",
  "next_action": "PR 门禁合并；用户验收后关闭。后续 major 升级需按专项任务处理。",
  "allowed_paths": [
    ".github/dependabot.yml",
    "docs/engineering/ci.md",
    "docs/work-items/tasks/DEP-POLICY-01.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/DEP-POLICY-01/**"
  ],
  "depends_on": ["GOV-CLOSE-01"],
  "docs_impact": {
    "update": [
      "docs/engineering/ci.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "依赖更新策略变化，需在 CI 文档与任务/阶段索引记录；只改依赖机器人配置与文档，不改产品代码。"
  },
  "verification_refs": ["docs/verification/2026-11/DEP-POLICY-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 口径

- npm/github-actions 的 major 一律 ignored；需要升级时立专项任务并临时移除忽略。
- klinecharts 全部更新 ignored（10.0.3 钉定）。
- minor/patch 仍走分组 PR，需过 docs/verify/pr-policy。
- 本批 #29 已合并；#30（vitest 补丁冲突）/#31 pinia major/#32 @types/node major/#33 vite major 已关闭并留理由。