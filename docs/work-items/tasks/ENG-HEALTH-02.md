# ENG-HEALTH-02 工程健康检查与接续整理

```json
{
  "id": "ENG-HEALTH-02",
  "title": "工程健康检查、文档纠偏与过时跟踪分支清理",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ENG",
  "base_commit": "3b5fb110e506eb2e139f754c966cee3a64f55ea1",
  "summary": "核对本地 Git、GitHub Issue/PR/CI/保护/发布及文档现状；清理已失效的本地远端跟踪引用，修正当前流程和任务摘要，登记后续维护事项。保留用户未提交改动、正式证据和历史验收结论，不改产品代码或发布资产。",
  "next_action": "维护已通过 PR #48 合入；后续优先 RUNTIME-CANCEL-02 与 DEP-SEC-MINIMATCH-01，再组织 M9-04 整批候选并分诊 Issue #8 反馈；任务关闭仅表示维护交付，不代表产品验收或发布。",
  "allowed_paths": [
    "docs/README.md",
    "docs/status.md",
    "docs/verification/README.md",
    "docs/engineering/documentation.md",
    "docs/engineering/testing.md",
    "docs/engineering/parallel-development.md",
    "docs/engineering/git-workflow.md",
    "docs/engineering/ci.md",
    "docs/decisions/0002-git-governance.md",
    "docs/proposals/M9-04-formula-product-ui.md",
    "docs/work-items/README.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/milestones/DEV.md",
    "docs/work-items/milestones/M9.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/tasks/ENG-HEALTH-02.md",
    "docs/work-items/tasks/M9-04D.md",
    "docs/work-items/tasks/TEST-BUDGET-04.md",
    "docs/work-items/tasks/CHART-MEASURE-05.md",
    "docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md",
    "docs/work-items/tasks/RUNTIME-CANCEL-02.md",
    "docs/verification/2026-11/ENG-HEALTH-02/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/README.md", "docs/status.md", "docs/verification/README.md", "docs/engineering/documentation.md", "docs/engineering/testing.md", "docs/engineering/parallel-development.md", "docs/engineering/git-workflow.md", "docs/engineering/ci.md", "docs/decisions/0002-git-governance.md", "docs/proposals/M9-04-formula-product-ui.md", "docs/work-items/README.md", "docs/work-items/milestones/ENG.md", "docs/work-items/milestones/DEV.md", "docs/work-items/milestones/M9.md", "docs/work-items/milestones/GH-202611.md", "docs/work-items/tasks/M9-04D.md", "docs/work-items/tasks/TEST-BUDGET-04.md", "docs/work-items/tasks/CHART-MEASURE-05.md", "docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md", "docs/work-items/tasks/RUNTIME-CANCEL-02.md"],
    "reason": "维护轮只修正文档事实与入口、补任务追溯和待办；不改变运行行为、测试预算、CI 或依赖。"
  },
  "verification_refs": ["docs/verification/2026-11/ENG-HEALTH-02/README.md"],
  "integration_ref": "main@538d1b88ab2aaf3430cfa458ec8f9b17e522a803 (PR #48)",
  "acceptance_ref": null
}
```

## 边界

- 本轮仅文档与本地 Git 引用维护；行为矩阵、RED/GREEN 和产品视觉验收不适用，不据此声明产品通过整批验收。
- `desktop/build-resources/migration-export-inline.html` 为开工前已有改动；保留原始字节，不暂存、不还原。
- 仅清理 GitHub 当前分支全量清单中已不存在的本地 `refs/remotes/origin/*`；保留 main、HEAD 和开放 PR 分支，保存原 SHA 以便恢复。
- 不清理 dangling Git 对象、用户数据库、`.runs`、正式验证证据，不关闭尚有诉求的 Issue，不合并依赖升级或发布版本。
- 统一状态只对账当前相关任务；旧 v1.2.7 候选保留历史身份，不伪装成当前 HEAD 的候选证明。
