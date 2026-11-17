# ENG · 工程基础设施

```json
{
  "id": "ENG",
  "title": "工程基础设施",
  "state": "active",
  "summary": "工程规范与操作门禁：Git 分支/提交/PR/发布规范、本地 hooks、CI required checks、main Ruleset、签名与追溯链。目标不是增加流程，而是让既有 task/verify 体系在 GitHub 上被强制并留下可审计记录。",
  "task_ids": ["ENG-GOV-01", "TEST-BUDGET-02", "CI-STABILITY-01", "ENG-GOV-03", "TEST-BUDGET-03", "TEST-BUDGET-04", "GOV-CLOSE-01", "DEP-POLICY-01", "ENG-HEALTH-02", "DEP-SEC-MINIMATCH-01", "RUNTIME-CANCEL-02"],
  "verification_refs": ["docs/verification/2026-11/ENG-HEALTH-02/README.md"],
  "acceptance_ref": null,
  "next_action": "Git 治理、发布追溯和 desktop 测试预算已合入；ENG-HEALTH-02 核对现状。优先按 RUNTIME-CANCEL-02 定位本地门禁失败，DEP-SEC-MINIMATCH-01 独立处理构建依赖告警；全面安全审计尚未排期，不引用不存在的 ENG-GOV-04。"
}
```

工程类任务的共同约束：只补执行层与规范，不移动既有 `docs/specs`、`docs/work-items`、`docs/verification` 目录；任何新门禁先在本任务自身跑通再推广。
