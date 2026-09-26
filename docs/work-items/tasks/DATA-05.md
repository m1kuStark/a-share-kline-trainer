# DATA-05 数据新鲜度与盘后状态

```json
{
  "id": "DATA-05",
  "title": "数据新鲜度与盘后状态",
  "owner": "integrator",
  "state": "active",
  "milestone": "R1",
  "summary": "FRESH-01 integrated; coordinator freshness + offline SSE 2026 calendar + home tri-state UI implemented in worktree.",
  "next_action": "Implementation complete on task/DATA-05-integration (see docs/verification/2026-09/DATA-05/report.md); GPT-WAKE-02 convergence fixes (poll order, Launcher guard, source readability probe) applied per docs/verification/2026-09/GPT-WAKE-02/report.md; integration gate + independent product review pending.",
  "base_commit": "af0efafc48ce24e247f3c273b1ee4926be8765c5",
  "allowed_paths": [
    "server/src/data/**",
    "server/test/data-refresh.test.ts",
    "server/test/data-freshness.test.ts",
    "web/src/dataStatus.ts",
    "web/src/App.vue",
    "web/src/api.ts",
    "e2e/data-update.spec.ts",
    "docs/work-items/tasks/DATA-05.md",
    "docs/work-items/prompts/DATA-05-integration.md",
    "docs/verification/2026-09/DATA-05/**",
    "web/src/views/Launcher.vue",
    "server/test/data-status-store-order.test.ts",
    "server/test/frontend-data-status-contract.test.ts",
    "docs/verification/2026-09/GPT-WAKE-02/**"
  ],
  "depends_on": [
    "FRESH-01"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/market-data/requirements.md"
    ],
    "reason": "实施需同步最近已收盘交易日、新鲜度未知及本地扫描的区别。"
  },
  "verification_refs": [
    "docs/verification/2026-09/START-01/report.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[Implementation contract](../prompts/DATA-05-integration.md). Existing pure module is authoritative; do not replace it with the alternative desktop branch.

允许路径末三项（web/src/views/Launcher.vue、server/test/data-status-store-order.test.ts、server/test/frontend-data-status-contract.test.ts、docs/verification/2026-09/GPT-WAKE-02/**）由控制层派发 control-handoff-20260926-05（GPT-WAKE-02 收敛修复）授权扩入，详见该验证目录 report.md。
