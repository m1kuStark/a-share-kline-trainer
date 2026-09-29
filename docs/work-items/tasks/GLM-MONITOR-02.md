# GLM-MONITOR-02 原生用量与任务看板

```json
{
  "id": "GLM-MONITOR-02",
  "title": "原生用量与任务看板",
  "owner": "integrator",
  "state": "review",
  "milestone": "DEV",
  "summary": "CLI native usage and official quota dashboard installed; 78 Python and 13 browser fixture checks plus live verification passed.",
  "next_action": "对账收编（2026-09-29）：已提交交付（CLI 原生用量＋官方额度看板＋本卡与 verification 记录）落自 3a3f463，实测为基线 5bf4484 祖先；续接改动仍在 trainer-worktrees/GLM-MONITOR-02（15 处未提交）与 GLM-MONITOR-UI（2 处未提交），两分支 tip 均为 af0efaf（本卡 base_commit，同为 5bf4484 祖先），等待原会话完成后再收编，本轮不收编。User acceptance; resume trainer product integration after this bounded maintenance task.",
  "allowed_paths": [
    "scripts/agent-monitor/**",
    "docs/work-items/tasks/GLM-MONITOR-02.md",
    "docs/proposals/delegate-usage-and-capacity.md",
    "docs/engineering/glm-observability.md",
    "docs/engineering/zcode-cli.md",
    "docs/engineering/README.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-09/GLM-MONITOR-02.md"
  ],
  "depends_on": [],
  "base_commit": "af0efafc48ce24e247f3c273b1ee4926be8765c5",
  "docs_impact": {
    "update": [
      "scripts/agent-monitor/README.md",
      "docs/proposals/delegate-usage-and-capacity.md"
    ],
    "reason": "仅展示原生统计与服务端额度；无本地费用估算，不重开ORCH。"
  },
  "verification_refs": [
    "docs/verification/2026-09/GLM-MONITOR-02.md"
  ],
  "integration_ref": "integration/product-integration-20260926@3a3f46362454b794a8812037414cf6f590d9c524",
  "acceptance_ref": null
}
```

合同：独立目标新会话，同一目标修复可续接；会话累计不会重复求和冒充单次任务消耗。未知不是零。远端额度与任务token分开，不换算费用或推测折扣；凭据仅供本机受支持读查询，不进入UI/日志/仓库。保留失败/重试历史和原有主工作区改动，不push或合入main。

验收：原生查询超时/异常/缺失值，缓存并发刷新，续接元数据、附件信息，真实CLI/远端查询，深浅主题及窄屏交互；安装后复核服务。若账户无适用额度，明确显示不可用，不伪造余额。

## 对账记录（CAND-04，2026-09-29，git 实测）

- 已提交交付：3a3f463「feat(monitor): add CLI native usage and quota dashboard (GLM-MONITOR-02)」（2026-09-25）新增 zcode_usage.py/quota.py 及配套测试、README/usage、本卡与 docs/verification/2026-09/GLM-MONITOR-02.md，实测为基线 5bf4484 祖先且在 integration/product-integration-20260926 上；其后 scripts/agent-monitor/ 的提交（214bd19…1fd5c19 等）属 GPT-WAKE/orch 等其他任务，非本卡范围。
- 未提交续接（本轮不收编）：task/GLM-MONITOR-02 与 task/GLM-MONITOR-UI 两分支 tip 均为 af0efaf（2026-09-23 v0.3.2 发布核验 docs 提交，即本卡 base_commit，实测 5bf4484 祖先），两工作树分别有 15/2 处未提交改动（未跟踪文件含与 3a3f463 同名者，是否分叉由原会话核对）；等待原会话完成后再收编，本轮只对账已提交内容。
- 用户验收仍未记录（acceptance_ref 保持 null），状态保持 review。
