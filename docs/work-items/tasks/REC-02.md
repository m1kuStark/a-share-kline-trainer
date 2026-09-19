# REC-02 录制有效操作及结束保留选择

```json
{
  "id": "REC-02",
  "title": "录制有效操作及结束保留选择",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REC",
  "summary": "录制有效操作及结束保留选择",
  "next_action": "按返修合同和专属Prompt实现，定向测试后提交集成人审查。",
  "allowed_paths": [
    "web/src/recording/useRecording.ts",
    "web/src/recording/compactStorage.ts",
    "web/src/recording/businessEvents.ts",
    "server/test/recording-business-events.test.ts",
    "server/test/recording-compact-removal.test.ts",
    "docs/work-items/tasks/REC-02.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REC-02.md"
    ],
    "reason": "依据用户阶段反馈实施，集成人统一更新规格与证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[返修合同](../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。
