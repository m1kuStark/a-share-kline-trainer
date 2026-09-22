# REL-03 v0.3.2接入与训练体验发布

```json
{
  "id": "REL-03",
  "title": "v0.3.2接入与训练体验发布",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "用户授权实施DATA-05、SETUP-01、TRAIN-02、UI-02与受控退出，验收后公开发布v0.3.2。",
  "next_action": "首批模块、取消回收、录像入口和回放测试已集成；候选门禁需在精确提交上完成全量单测、M2、Journey与发布前检查。",
  "allowed_paths": [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "package.json",
    "package-lock.json",
    ".gitignore",
    ".gitattributes",
    ".github/**",
    "server/**",
    "web/**",
    "e2e/**",
    "scripts/**",
    "docs/**",
    "assets/**",
    "third-party/**",
    "tools/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-03.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-03/runtime-cancel-review.json",
    "docs/verification/2026-09/REL-03/ui-02-journey.json",
    "docs/verification/2026-09/REL-03/recording-daily-journey.json"
  ],
  "integration_ref": "3e4f012",
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。
