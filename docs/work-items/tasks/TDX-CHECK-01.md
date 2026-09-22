# TDX-CHECK-01 候选通达信目录诊断

```json
{
  "id": "TDX-CHECK-01",
  "title": "候选通达信目录诊断",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "M5",
  "summary": "为SETUP-01提供只读候选验证，区分未安装、空日线和缺配套数据。",
  "next_action": "只检查给定候选，不扫整盘、不接原生窗口或API。",
  "allowed_paths": [
    "server/src/tdx/inspect.ts",
    "server/test/tdx-inspect.test.ts",
    "docs/work-items/tasks/TDX-CHECK-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/TDX-CHECK-01.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。
