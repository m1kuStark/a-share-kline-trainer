# ORCH-01 版本化合同与四路影子路由

```json
{
  "id": "ORCH-01",
  "title": "版本化合同与四路影子路由",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ORCH",
  "summary": "版本化合同与四路影子路由已提交并作为后续控制器基线交付；不等于全部四路自动执行。",
  "next_action": "已随ORCH已交付工程完成用户验收；转入产品任务并继续保留现有回归与证据边界。",
  "allowed_paths": [
    "scripts/agent-routing/**",
    "scripts/README.md",
    "scripts/agent-monitor/README.md",
    "AGENTS.md",
    "docs/engineering/**",
    "docs/proposals/**",
    "docs/work-items/**",
    "docs/status.md",
    "docs/verification/2026-09/ORCH-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/proposals/adaptive-model-routing.md",
      "docs/engineering/model-delegation.md",
      "docs/work-items/tasks/ORCH-01.md"
    ],
    "reason": "分批实现动态模型路由，区分当前可执行能力、受控验证和未来自动派发。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ORCH-01/report.md",
    "docs/verification/2026-09/ORCH-01/checks.json",
    "docs/verification/2026-09/ORCH-04/user-acceptance.md"
  ],
  "integration_ref": "b72df5180756e359bb5b998be4b5b3c1ef3e7126",
  "acceptance_ref": "docs/verification/2026-09/ORCH-04/user-acceptance.md",
  "base_commit": "af0efafc48ce24e247f3c273b1ee4926be8765c5"
}
```

设计：[自适应路由](../../proposals/adaptive-model-routing.md)。本任务允许范围是集成职责边界，实际worker按行为切片缩小独占范围。

验收：纯规则重放一致；实际文件越界优先于自评；已批准迁移不循环升级；首次失败与两次repair区分；跨attempt同因累计；环境失败单独分类；影子模式不执行命令或合入。
