# GPT-WAKE-02 控制器 gpt_direct 自动派发

```json
{
  "id": "GPT-WAKE-02",
  "title": "控制器 gpt_direct 自动派发（pinned Codex 会话）",
  "owner": "integrator",
  "state": "review",
  "milestone": "DEV",
  "summary": "gpt.runner_entry/gpt.cli 已入 runner_file_hashes、gpt.home 外置校验、--cli 移回顶层并加真实 parser 合同测试、registry sessionId 与 pinned 会话强校验；agent-routing 266 项绿。",
  "next_action": "User acceptance; 与 GPT-WAKE-01 一并由集成人复核修复批次。",
  "allowed_paths": [
    "scripts/agent-routing/controller_loop.py",
    "scripts/agent-routing/controller_runner.py",
    "scripts/agent-routing/test_controller_loop.py",
    "scripts/agent-routing/test_controller_runner.py",
    "scripts/agent-monitor/run_codex.py",
    "scripts/agent-monitor/test_run_codex.py",
    "docs/engineering/codex-cli.md",
    "docs/engineering/controller-loop.md",
    "docs/engineering/model-delegation.md",
    "docs/work-items/tasks/GPT-WAKE-02.md",
    "docs/status.md",
    "docs/verification/2026-09/GPT-WAKE-02/**"
  ],
  "depends_on": [
    "GPT-WAKE-01"
  ],
  "base_commit": "2612fa3",
  "docs_impact": {
    "reason": "承接用户 2026-09-25 授权的强模型自动唤醒链路（不重开 ORCH 阶段）；把 controller-loop.md 的'无GPT adapter则不编造调用'边界改写为真实入口＋双旗标 opt-in 约束。",
    "update": [
      "docs/engineering/controller-loop.md",
      "docs/engineering/model-delegation.md",
      "docs/engineering/codex-cli.md"
    ]
  },
  "verification_refs": [
    "docs/verification/2026-09/GPT-WAKE-02/report.md",
    "docs/verification/2026-09/GPT-WAKE-02/integrator-review-20260926.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 设计

- **双旗标 opt-in**：pinned policy 增加可选 `gpt_dispatch: true`，pinned runner config v2 增加可选 `gpt` 段（runner_entry=run_codex.py、home=桥 home、session_id=中枢会话、sandbox=workspace-write 或 danger-full-access、timeout_minutes）。两者皆缺省时行为与 v1 完全一致（gpt_direct 仍 waiting_control）。
- **同一 attempt 机制**：execution_started 事件（route=gpt_direct）、build_prompt 合同简报（REPORT 协议）、owned 进程派发、jobs 注册表归属校验（id/worktree/logPath）、outcome.json、独立验证与收据全部复用；run_codex 新增 `--log`（对齐 run_glm 归属契约）与 `--add-dir`（GPT 写控制区 job_dir 的报告）。
- **GPT worker 语义**：gpt_direct worker 报告 `assessment=continuous_judgment` 合法（它就是该路由的执行者），不再触发为 GLM 设计的 worker_escalation 自升级；needs_replan/scope 扩张仍照常升级控制层。
- **失败降级**：写入者锁忙（exit 3）、超时（exit 4）、注册表不一致、dirty/越界等一切异常仍走原有 waiting_control/fault 路径，不重试不抢锁。
- **resume --verify-only**：工作已提交到 expected_commit 而验证未跑时，操作者显式授权后跳过重派、直接对最后一份报告跑独立验证（演练实测发现的先于 GPT 的结构缺口）。
