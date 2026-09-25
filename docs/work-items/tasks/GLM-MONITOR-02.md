# GLM-MONITOR-02 原生用量与任务看板

```json
{
  "id": "GLM-MONITOR-02",
  "title": "原生用量与任务看板",
  "owner": "integrator",
  "state": "review",
  "milestone": "DEV",
  "summary": "CLI native usage and official quota dashboard installed; 78 Python and 13 browser fixture checks plus live verification passed.",
  "next_action": "User acceptance; resume trainer product integration after this bounded maintenance task.",
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
  "integration_ref": null,
  "acceptance_ref": null
}
```

合同：独立目标新会话，同一目标修复可续接；会话累计不会重复求和冒充单次任务消耗。未知不是零。远端额度与任务token分开，不换算费用或推测折扣；凭据仅供本机受支持读查询，不进入UI/日志/仓库。保留失败/重试历史和原有主工作区改动，不push或合入main。

验收：原生查询超时/异常/缺失值，缓存并发刷新，续接元数据、附件信息，真实CLI/远端查询，深浅主题及窄屏交互；安装后复核服务。若账户无适用额度，明确显示不可用，不伪造余额。
