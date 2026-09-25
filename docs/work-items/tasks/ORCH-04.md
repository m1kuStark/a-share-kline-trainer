# ORCH-04 分类审查与路由效果验收

```json
{
  "id": "ORCH-04",
  "title": "分类审查与路由效果验收",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ORCH",
  "summary": "分类候选门禁与离线对照已完成本地验证：882单测、24项M2、72浏览器旅程和46项指标回归通过；最终证明绑定3623256。",
  "next_action": "用户已验收；转回产品任务，先DATA-05/TRAIN-02纯模块，再由主代理主导SETUP-01接线。",
  "allowed_paths": [
    "scripts/agent-routing/**",
    "scripts/worktree/**",
    "scripts/verify-candidate.ts",
    "server/test/**",
    "docs/engineering/**",
    "AGENTS.md",
    "docs/work-items/tasks/ORCH-04.md",
    "docs/verification/2026-09/ORCH-04/**",
    "scripts/worktree.ts",
    "docs/proposals/adaptive-model-routing.md",
    "docs/status.md",
    "docs/work-items/milestones/ORCH.md"
  ],
  "depends_on": [
    "ORCH-03"
  ],
  "docs_impact": {
    "update": [
      "docs/proposals/adaptive-model-routing.md",
      "docs/engineering/model-delegation.md",
      "docs/work-items/tasks/ORCH-04.md"
    ],
    "reason": "分批实现动态模型路由，区分当前可执行能力、受控验证和未来自动派发。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ORCH-04/start-baseline.md",
    "docs/verification/2026-09/ORCH-04/metrics-review.md",
    "docs/verification/2026-09/ORCH-04/gates-review.md",
    "docs/verification/2026-09/ORCH-04/metrics-acceptance.md",
    "docs/verification/2026-09/ORCH-04/final-report.md",
    "docs/verification/2026-09/ORCH-04/user-acceptance.md"
  ],
  "integration_ref": "3623256bdd93ec94f133f26162ac1d841af769b5",
  "acceptance_ref": "docs/verification/2026-09/ORCH-04/user-acceptance.md",
  "base_commit": "a3b140c6e726daf744f4e303b0cd9927c7266390"
}
```

设计：[自适应路由](../../proposals/adaptive-model-routing.md)。本任务允许范围是集成职责边界，实际worker按行为切片缩小独占范围。

验收：纯文档可明确visual不适用；UI不能自报免检；任务风险变化复核profile；旧证明保持旧门禁；绑定新候选验证后才依权限合入。对照包含成本、时延、返工、强模型介入与漏检，未知费用明确标注。
