# DRAW-02 修复前复权推进时画线价格漂移

```json
{
  "id": "DRAW-02",
  "title": "修复前复权推进时画线价格漂移",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REC",
  "summary": "修复前复权推进时画线价格漂移",
  "next_action": "按返修合同和专属Prompt实现，定向测试后提交集成人审查。",
  "allowed_paths": [
    "server/src/api.ts",
    "server/src/drawings.ts",
    "server/src/train/drawing-price-basis.ts",
    "server/test/drawing-price-basis.test.ts",
    "server/test/drawings.test.ts",
    "web/src/api.ts",
    "web/src/drawingState.ts",
    "web/src/drawingPriceBasis.ts",
    "web/src/drawingOutbox.ts",
    "web/src/components/KlineChart.vue",
    "web/src/components/docs/drawing-persistence.md",
    "server/test/drawing-state.test.ts",
    "docs/work-items/tasks/DRAW-02.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/DRAW-02.md"
    ],
    "reason": "依据用户阶段反馈实施，集成人统一更新规格与证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[返修合同](../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。
