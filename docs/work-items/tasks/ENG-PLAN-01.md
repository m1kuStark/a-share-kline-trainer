# ENG-PLAN-01 首批计划批准记录与任务事实对账

```json
{
  "id": "ENG-PLAN-01",
  "title": "保存首批开发批准范围并校准旧任务集成事实",
  "owner": "integrator",
  "state": "review",
  "milestone": "ENG",
  "base_commit": "2c66477f0c4875ac3a100338fdbc42b4878dadd8",
  "summary": "阶段0纯文档维护：保存2026-11-18首批0—2开发范围/顺序与三内置公式默认停用的批准来源，对账已实现能力、集成提交、后继任务和验收证据，纠正旧任务下一步。保留原状态和历史证据，不改变产品、测试或发布资产。",
  "next_action": "交root审查本地文档提交；共享统一状态、最终status生成、后续PR/合并由root处理。本轮不据静态对账推断产品通过、用户验收或发布。",
  "allowed_paths": [
    "docs/work-items/tasks/ENG-PLAN-01.md",
    "docs/work-items/tasks/TRAIN-03.md",
    "docs/work-items/tasks/ORDER-01.md",
    "docs/work-items/tasks/TRAIN-FEE-01.md",
    "docs/work-items/tasks/SETUP-PASTE-01.md",
    "docs/work-items/tasks/CHART-WEEKDAY-01.md",
    "docs/work-items/tasks/CHART-ZOOM-01.md",
    "docs/work-items/tasks/CHART-PAN-01.md",
    "docs/work-items/tasks/UI-TOOLBAR-01.md",
    "docs/work-items/tasks/UI-TOOLBAR-02.md",
    "docs/work-items/tasks/M7-*.md",
    "docs/work-items/tasks/PACK-*.md",
    "docs/work-items/tasks/UPD-*.md",
    "docs/work-items/tasks/E2E-*.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/milestones/V4.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/milestones/M7.md",
    "docs/work-items/milestones/PACK.md",
    "docs/work-items/milestones/UPD.md",
    "docs/work-items/milestones/M5.md",
    "docs/work-items/README.md",
    "docs/proposals/README.md",
    "docs/proposals/development-plan-2026-11.md",
    "docs/proposals/development-batch-2026-11.md",
    "docs/README.md",
    "docs/verification/README.md",
    "docs/verification/2026-11/ENG-PLAN-01/**"
  ],
  "depends_on": [
    "ENG-HEALTH-02"
  ],
  "docs_impact": {
    "update": [
      "docs/proposals/development-batch-2026-11.md",
      "docs/proposals/development-plan-2026-11.md",
      "docs/proposals/README.md",
      "docs/README.md",
      "docs/verification/2026-11/ENG-PLAN-01/approval.md",
      "docs/verification/2026-11/ENG-PLAN-01/e2e-static.md",
      "docs/verification/2026-11/ENG-PLAN-01/README.md",
      "docs/verification/2026-11/ENG-PLAN-01/reconciliation.md",
      "docs/verification/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/work-items/milestones/M5.md",
      "docs/work-items/milestones/M7.md",
      "docs/work-items/milestones/PACK.md",
      "docs/work-items/milestones/UPD.md",
      "docs/work-items/milestones/V4.md",
      "docs/work-items/README.md",
      "docs/work-items/tasks/CHART-PAN-01.md",
      "docs/work-items/tasks/CHART-WEEKDAY-01.md",
      "docs/work-items/tasks/CHART-ZOOM-01.md",
      "docs/work-items/tasks/E2E-BASELINE-01.md",
      "docs/work-items/tasks/E2E-SPEC-SYNC-01.md",
      "docs/work-items/tasks/ENG-PLAN-01.md",
      "docs/work-items/tasks/M7-01.md",
      "docs/work-items/tasks/M7-02.md",
      "docs/work-items/tasks/ORDER-01.md",
      "docs/work-items/tasks/PACK-01.md",
      "docs/work-items/tasks/PACK-02.md",
      "docs/work-items/tasks/PACK-03.md",
      "docs/work-items/tasks/PACK-04.md",
      "docs/work-items/tasks/PACK-05.md",
      "docs/work-items/tasks/SETUP-PASTE-01.md",
      "docs/work-items/tasks/TRAIN-03.md",
      "docs/work-items/tasks/TRAIN-FEE-01.md",
      "docs/work-items/tasks/UI-TOOLBAR-01.md",
      "docs/work-items/tasks/UI-TOOLBAR-02.md",
      "docs/work-items/tasks/UPD-01.md",
      "docs/work-items/tasks/UPD-02.md",
      "docs/work-items/tasks/UPD-BUSY-HEAL-01.md",
      "docs/work-items/tasks/UPD-NSIS-RETRY-01.md"
    ],
    "reason": "仅校准任务集成事实、下一步及批准入口；旧状态和用户验收结论不批量改写。共享.control与status生成由root单写，本树只作允许缺状态的有限文档检查。"
  },
  "verification_refs": [
    "docs/verification/2026-11/ENG-PLAN-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 边界

- [批准记录](../../verification/2026-11/ENG-PLAN-01/approval.md)只证明首批开发与示例启停口径获准，不证明本任务已验收、M9现有限制获接受或获准发布。
- 现有相关任务的 `state`、`acceptance_ref` 保持原值；未记录的验收不得补造。历史验证不改成当前提交的动态结果。
- 本轮旧E2E逐项静态核对，不跑产品构建、全量测试或浏览器；行为矩阵与产品RED/GREEN不适用。
- 不写工作区 `.control`、共享矩阵或最终 `docs/status.md`；不复制或暂存主检出的 `desktop/build-resources/migration-export-inline.html`。
