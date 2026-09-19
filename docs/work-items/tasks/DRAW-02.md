# DRAW-02 修复前复权推进时画线价格漂移

```json
{
  "id": "DRAW-02",
  "title": "修复前复权推进时画线价格漂移",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "REC",
  "summary": "价格基准修复已合入ACCEPT-01。",
  "next_action": "Integrated and engineering-reviewed; overall user acceptance pending.",
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
      "docs/work-items/tasks/DRAW-02.md",
      "web/src/components/docs/drawing-persistence.md"
    ],
    "reason": "任务卡记录实现与验证；DRAWING-PERSISTENCE 补充 priceBasis 元数据语义（规格正文由集成人统一更新）。"
  },
  "verification_refs": [
    "docs/verification/2026-09/ACCEPT-01-release/report.md"
  ],
  "integration_ref": "c0ad1112f9f6d98df9acd3c6d5c6446ac54480b4",
  "acceptance_ref": null
}
```

模块交付细节与原始告警陈述见[worker记录](../../verification/2026-09/ACCEPT-01-review/draw-02-worker.md)，集成人的复核与实际集成结论见[复核报告](../../verification/2026-09/ACCEPT-01-review/report.md)。告警数量以明确扫描证据为准。
