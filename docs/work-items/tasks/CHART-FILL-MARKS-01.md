# CHART-FILL-MARKS-01 可选主图 B/S 成交位置标记，保留底部逐笔明细

```json
{
  "title": "可选主图 B/S 成交位置标记，保留底部逐笔明细",
  "summary": "Issue #8 后续反馈：在真实成交所属 K 线、图表空间成交价上显示只读 B/S 标记。不开第二套成交业务，不替代底部聚合与详情。",
  "integration_ref": null,
  "id": "CHART-FILL-MARKS-01",
  "verification_refs": ["docs/verification/2026-11/CHART-FILL-MARKS-01/README.md"],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/work-items/tasks/CHART-FILL-MARKS-01.md",
      "docs/work-items/README.md",
      "docs/status.md",
      "web/src/components/docs/interaction.md",
      "web/src/components/docs/library-adapter.md"
    ],
    "reason": "明确主图价位与底部原始成交明细的区别。"
  },
  "acceptance_ref": null,
  "milestone": "M6",
  "owner": "integrator",
  "depends_on": [],
  "allowed_paths": [
    "docs/work-items/tasks/CHART-FILL-MARKS-01.md",
    "web/src/overlays.ts",
    "web/src/components/KlineChart.vue",
    "web/src/tradeMarkerLayout.ts",
    "server/test/fill-marker.test.ts",
    "e2e/fill-marker.spec.ts",
    "docs/specs/chart/display.md",
    "web/src/components/docs/interaction.md",
    "web/src/components/docs/library-adapter.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-FILL-MARKS-01/**"
  ],
  "state": "active",
  "next_action": "先验证旧图层不出图；实现局部显示开关和精确锚点；复核实际绘图及底部详情。",
  "base_commit": "fdd4441adf8f39141492adef1a1dd051b43ca85f"
}
```
