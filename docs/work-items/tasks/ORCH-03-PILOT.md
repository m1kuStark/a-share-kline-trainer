# ORCH-03-PILOT GLM闭环试点

```json
{
  "id": "ORCH-03-PILOT",
  "title": "GLM闭环真实机械任务试点",
  "owner": "controller",
  "state": "closed",
  "milestone": "ORCH",
  "summary": "同一task保留3次尝试（2次GLM、1次GPT Direct），最终认证verified且重复run不新增任何job/attempt/receipt。",
  "next_action": "用户已完成本批工程验收；按ORCH-04推进分类审查和效果评估。",
  "allowed_paths": [
    "scripts/release/trainer.config.example.json",
    "docs/work-items/tasks/ORCH-03-PILOT.md",
    "docs/verification/2026-09/ORCH-03/**"
  ],
  "depends_on": [
    "ORCH-03"
  ],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/ORCH-03-PILOT.md"
    ],
    "reason": "试点只修正配置说明，不改变产品运行行为；验收证据按控制层运行保存。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ORCH-03/final-report.md",
    "docs/verification/2026-09/ORCH-03/pilot-proof.json"
  ],
  "integration_ref": "f56c9ef95bcfc618b9c1101582271120794d7a7a",
  "acceptance_ref": "docs/verification/2026-09/ORCH-03/user-acceptance.md",
  "base_commit": "5d4fe1e005ac0b15417aa85c326be2930d25fafa"
}
```

独立候选包含当前工作空间的示例配置说明；控制器、policy与合同在候选之外。正常路径无需GPT逐次派发或代写。评估记录实际GLM次数、修复数、人工介入及是否发出verified；不由小任务推导成本节省比例。试点子任务的代码范围仅一个配置说明文件。
