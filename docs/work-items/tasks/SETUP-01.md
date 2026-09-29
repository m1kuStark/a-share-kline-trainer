# SETUP-01 首次接入与通达信发现

```json
{
  "id": "SETUP-01",
  "title": "首次接入与通达信发现",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "用户已接受接入方案；自动发现、确认、原生选目录、保存生效已在 wt/B-SETUP-01 实现（含隐私路径清理），待集成审查与真实 Windows/用户验收。",
  "next_action": "集成串行合入 wt/B-SETUP-01 候选；跑受影响回归与真实浏览器首次接入 journey（发现→确认→训练→退出→再启动），原生选目录与受控重启需真实 Windows 验证；临时目录单/多安装、空目录、中文空格路径、权限/缺数据、取消、保存重启、旧配置兼容回归在 server/test（discover/setup-onboarding/release-launcher/data-refresh）。",
  "allowed_paths": [
    "server/src/config.ts",
    "server/src/tdx/discover.ts",
    "server/src/api.ts",
    "server/src/data/refresh.ts",
    "scripts/release/launcher.cjs",
    "scripts/runtime.ts",
    "scripts/runtime/snapshot.ts",
    "scripts/release/trainer.config.example.json",
    "tools/diagnostics/**",
    "server/test/discover.test.ts",
    "server/test/release-launcher.test.ts",
    "server/test/api.test.ts",
    "server/test/data-refresh.test.ts",
    "web/src/api.ts",
    "web/src/App.vue",
    "docs/user/install.md",
    "docs/proposals/tdx-onboarding.md",
    "docs/work-items/tasks/SETUP-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/proposals/tdx-onboarding.md",
      "docs/user/install.md",
      "docs/work-items/tasks/SETUP-01.md"
    ],
    "reason": "接入设计已获用户接受；本任务同时处理默认候选的隐私边界、用户引导发现和配置生效，具体代码写范围在每个子任务派发前冻结。"
  },
  "verification_refs": [],
  "integration_ref": "worktree trainer-wt/wt-B，分支 wt/B-SETUP-01（基线 5bf4484）",
  "acceptance_ref": "docs/verification/2026-09/SETUP-design-acceptance/record.json"
}
```
