# REC-03 按交易日回放与独立观察控制

```json
{
  "id": "REC-03",
  "title": "按交易日回放与独立观察控制",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REC",
  "summary": "按交易日回放与独立观察控制",
  "next_action": "按返修合同和专属Prompt实现，定向测试后提交集成人审查。",
  "allowed_paths": [
    "web/src/views/SessionReplay.vue",
    "web/src/recording/dailyReplay.ts",
    "server/test/recording-daily-replay.test.ts",
    "e2e/recording-daily.spec.ts",
    "docs/work-items/tasks/REC-03.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REC-03.md"
    ],
    "reason": "依据用户阶段反馈实施，集成人统一更新规格与证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[返修合同](../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。
