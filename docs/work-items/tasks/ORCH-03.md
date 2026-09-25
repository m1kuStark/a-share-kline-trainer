# ORCH-03 动态派发与强模型接管

```json
{
  "id": "ORCH-03",
  "title": "动态派发与强模型接管",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ORCH",
  "summary": "控制器206项回归完成（203通过、3跳过）；真实试点经2次GLM及GPT Direct人工收尾达到verified，复核收据和重复run幂等通过。",
  "next_action": "用户已完成本批工程验收；按ORCH-04推进分类审查和效果评估。",
  "allowed_paths": [
    "scripts/agent-routing/**",
    "scripts/agent-monitor/**",
    "docs/engineering/**",
    "docs/proposals/adaptive-model-routing.md",
    "docs/status.md",
    "docs/work-items/tasks/ORCH-03.md",
    "docs/work-items/tasks/ORCH-03-PILOT.md",
    "docs/verification/2026-09/ORCH-03/**",
    "docs/work-items/milestones/ORCH.md"
  ],
  "depends_on": [
    "ORCH-02"
  ],
  "docs_impact": {
    "update": [
      "docs/proposals/adaptive-model-routing.md",
      "docs/engineering/model-delegation.md",
      "docs/work-items/tasks/ORCH-03.md"
    ],
    "reason": "分批实现动态模型路由，区分当前可执行能力、受控验证和未来自动派发。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ORCH-03/timeout-replan.md",
    "docs/verification/2026-09/ORCH-03/state-review.md",
    "docs/verification/2026-09/ORCH-03/state-acceptance.md",
    "docs/verification/2026-09/ORCH-03/loop-replan.md",
    "docs/verification/2026-09/ORCH-03/controller-acceptance.md",
    "docs/verification/2026-09/ORCH-03/mimosa-resolution.md",
    "docs/verification/2026-09/ORCH-03/resume-acceptance.md",
    "docs/verification/2026-09/ORCH-03/final-report.md"
  ],
  "integration_ref": "3e2b2141752fdbaeb65902de6ab3454d9b7d79d0",
  "acceptance_ref": "docs/verification/2026-09/ORCH-03/user-acceptance.md",
  "base_commit": "f823c6f"
}
```

设计：[自适应路由](../../proposals/adaptive-model-routing.md)。本任务允许范围是集成职责边界，实际worker按行为切片缩小独占范围。

验收：新job不重置同一任务repair计数；重复完成事件幂等；无已验证GPT适配器则waiting_control，不能冒称已接管；行为相交阻止并行；已知长模型请求不误杀；保留max思考档和用户通知偏好。

