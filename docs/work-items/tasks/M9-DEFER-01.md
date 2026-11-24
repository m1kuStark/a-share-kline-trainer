# M9-DEFER-01 验收分支隔离

```json
{
  "milestone": "M9",
  "summary": "用户不在家，明确延后 M9 验收；完整候选独立保存在 task/M9-ACCEPT-HOLD，不发布。",
  "verification_refs": ["docs/verification/2026-11/M9-DEFER-01/README.md"],
  "base_commit": "fe0989736ebf7428deb6dafcf1dbba992c2b50dc",
  "next_action": "在独立 PR 核验公式 UI/API/打包接线撤出、存量 DB 不破坏与普通训练/回放回归；门禁与检查通过前不改 main。",
  "state": "active",
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/M9-DEFER-01.md",
      "docs/work-items/milestones/M9.md",
      "docs/status.md"
    ],
    "reason": "保留 M9 原证据与用户验收空值；状态与代码所在分支分别表述。"
  },
  "owner": "integrator",
  "integration_ref": null,
  "allowed_paths": [
    "web/src/formula-engine/**",
    "web/src/chartPaneLayout.ts",
    "desktop/electron-builder.yml", "desktop/test/m9-package-isolation.test.ts", "docs/specs/README.md",
    "server/test/chart-pane-layout.test.ts",
    "e2e/m9-deferred.spec.ts",
    "web/src/components/FormulaSettings.vue",
    "web/src/components/KlineChart.vue",
    "web/src/components/TrainingSettings.vue",
    "web/src/components/docs/**",
    "web/src/formulaIndicators.ts",
    "web/src/api.ts",
    "web/src/views/Training.vue",
    "web/src/views/SessionReplay.vue",
    "web/README.md",
    "server/src/formulas/**",
    "server/src/api.ts", "server/src/tdx/industry.ts",
    "server/src/index.ts",
    "server/src/db.ts",
    "server/test/formula*",
    "server/test/formulas/**",
    "server/test/formula-engine/**",
    "server/test/frontend-contract.test.ts",
    "server/test/recording-chart-capture.test.ts",
    "server/test/m9-deferred.test.ts",
    "server/README.md",
    "package.json",
    "package-lock.json",
    "scripts/build/formula-engine-bundle.mjs",
    "scripts/formula-agent.mjs",
    "scripts/runtime/run.ts",
    "e2e/formula-*.spec.ts",
    "e2e/README.md",
    "docs/work-items/tasks/M9-DEFER-01.md",
    "docs/work-items/milestones/M9.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/engineering/formula-agent-api.md",
    "docs/specs/formulas.md",
    "docs/verification/2026-11/M9-DEFER-01/**"
  ],
  "title": "M9 候选留分支，主线撤出公式模块",
  "id": "M9-DEFER-01",
  "acceptance_ref": null,
  "depends_on": []
}
```
