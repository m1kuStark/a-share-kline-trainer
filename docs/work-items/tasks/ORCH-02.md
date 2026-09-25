# ORCH-02 独立机器验证与失败证据

```json
{
  "id": "ORCH-02",
  "title": "独立机器验证与失败证据",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ORCH",
  "summary": "独立验证器和认证收据已实现；干净候选108项测试完成（3跳过），路由可据有效结果提出修复或审查。",
  "next_action": "已随ORCH已交付工程完成用户验收；转入产品任务并继续保留现有回归与证据边界。",
  "allowed_paths": [
    "scripts/agent-routing/**",
    "scripts/verify-candidate.ts",
    "scripts/worktree/evidence.ts",
    "server/test/**",
    "docs/engineering/**",
    "docs/proposals/adaptive-model-routing.md",
    "docs/status.md",
    "docs/work-items/tasks/ORCH-02.md",
    "docs/verification/2026-09/ORCH-02/**"
  ],
  "depends_on": [
    "ORCH-01"
  ],
  "docs_impact": {
    "update": [
      "docs/proposals/adaptive-model-routing.md",
      "docs/engineering/model-delegation.md",
      "docs/work-items/tasks/ORCH-02.md"
    ],
    "reason": "分批实现动态模型路由，区分当前可执行能力、受控验证和未来自动派发。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ORCH-02/report.md",
    "docs/verification/2026-09/ORCH-02/controller-report.json",
    "docs/verification/2026-09/ORCH-04/user-acceptance.md"
  ],
  "integration_ref": "0e4bd3e1bdb5c9f565337877222b9b5ec9de22f3",
  "acceptance_ref": "docs/verification/2026-09/ORCH-04/user-acceptance.md",
  "base_commit": "b72df51"
}
```

设计：[自适应路由](../../proposals/adaptive-model-routing.md)。本任务允许范围是集成职责边界，实际worker按行为切片缩小独占范围。

验收：worker伪造passed、移除断言、修改命令注册表、缺日志、旧commit/tree、数据指纹不匹配均不能放行；新增回归允许，降低既有门禁需升级。合并后的新代码组合另验。
