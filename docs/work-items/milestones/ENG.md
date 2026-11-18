# ENG · 工程基础设施

```json
{
  "id": "ENG",
  "title": "工程基础设施",
  "state": "active",
  "summary": "工程规范与操作门禁：Git 分支/提交/PR/发布规范、本地 hooks、CI required checks、main Ruleset、签名与追溯链。目标不是增加流程，而是让既有 task/verify 体系在 GitHub 上被强制并留下可审计记录。",
  "task_ids": [
    "ENG-GOV-01",
    "TEST-BUDGET-02",
    "CI-STABILITY-01",
    "ENG-GOV-03",
    "TEST-BUDGET-03",
    "TEST-BUDGET-04",
    "GOV-CLOSE-01",
    "DEP-POLICY-01",
    "ENG-HEALTH-02",
    "DEP-SEC-MINIMATCH-01",
    "RUNTIME-CANCEL-02",
    "ENG-PLAN-01"
  ],
  "verification_refs": [
    "docs/verification/2026-11/ENG-HEALTH-02/README.md",
    "docs/verification/2026-11/ENG-PLAN-01/reconciliation.md",
    "docs/verification/2026-11/RUNTIME-CANCEL-02/validation.md",
    "docs/verification/2026-11/DEP-SEC-MINIMATCH-01/integration.md"
  ],
  "acceptance_ref": null,
  "next_action": "PR50—52已合入并回填integration_ref，告警48自动fixed；PR43仍待当前主线与包验证。EMA已由PR54合入58ba0ff；M9整批候选、同提交Windows包及用户验收待完成，接续与失败历史见docs/verification/2026-11/M9-ENABLE-01/README.md；不发布。"
}
```

工程类任务的共同约束：只补执行层与规范，不移动既有 `docs/specs`、`docs/work-items`、`docs/verification` 目录；任何新门禁先在本任务自身跑通再推广。
