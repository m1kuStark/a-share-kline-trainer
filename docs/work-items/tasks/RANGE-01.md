# RANGE-01 训练范围纯规划模块

```json
{
  "id": "RANGE-01",
  "title": "训练范围纯规划模块",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "M5",
  "summary": "为TRAIN-02提供自然月、到末日和日K根数的范围计划。",
  "next_action": "只用日期元信息实现纯函数，不接引擎/数据库/录制。",
  "allowed_paths": [
    "server/src/train/range.ts",
    "server/test/train-range.test.ts",
    "docs/work-items/tasks/RANGE-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/RANGE-01.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。
