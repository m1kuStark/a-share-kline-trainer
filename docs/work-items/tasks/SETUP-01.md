# SETUP-01 首次接入与通达信发现

```json
{
  "id": "SETUP-01",
  "title": "首次接入与通达信发现",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "用户已接受接入方案；自动发现、确认、原生选目录及保存生效待实施，并需移除开发者电脑路径泄露。",
  "next_action": "实现有限通用候选、进程/快捷方式/用户选择发现和保存重启；默认候选不得包含个人绝对路径，API/发布文档不返回或记录完整本机路径。",
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
  "integration_ref": null,
  "acceptance_ref": "docs/verification/2026-09/SETUP-design-acceptance/record.json"
}
```
