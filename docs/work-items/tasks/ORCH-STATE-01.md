# ORCH-STATE-01 统一工作状态文件

```json
{
  "id": "ORCH-STATE-01",
  "title": "统一 GPT/GLM/zcode/Git 状态记录",
  "owner": "integrator",
  "state": "active",
  "milestone": "ORCH",
  "summary": "以工作空间外部 trainer-state.json 作为任务、候选、作业、产物和验收的唯一当前状态源；任务卡保留静态契约，其他面板只做视图或证据。",
  "next_action": "完成状态库、CLI、candidate/GLM/DWF 适配和状态漂移回归，再接入产品任务。",
  "allowed_paths": [
    "scripts/workflow/**",
    "scripts/worktree/**",
    "scripts/agent-monitor/**",
    "scripts/docs/**",
    "scripts/docs.ts",
    "package.json",
    "server/test/workflow-state.test.ts",
    "docs/engineering/controller-loop.md",
    "docs/engineering/worker-contract.md",
    "docs/work-items/tasks/ORCH-STATE-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/status.md",
      "docs/engineering/controller-loop.md",
      "docs/engineering/worker-contract.md"
    ],
    "reason": "统一状态源改变任务、候选、作业和验收事实的归属，必须同步控制循环和文档状态生成规则。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 当前实现边界

- 状态文件位于工作空间外部 `.control/trainer-state.json`，不进入 Git、安装包或公开仓库。
- `scripts/workflow/state.ts` 负责 schema、文件锁、版本递增、幂等事件和原子替换；CLI 负责人工/控制器调用。
- 后续适配器必须把真实提交、树、worktree 别名、run、artifact 和验收状态写入同一文件；无法证明的状态进入 `waiting_control`。

