# CHART-CONTRAST-01 修复浅色主题内置 MACD / KDJ 线条与图例对比度

```json
{
  "id": "CHART-CONTRAST-01",
  "title": "修复浅色主题内置 MACD / KDJ 线条与图例对比度",
  "state": "review",
  "milestone": "M6",
  "owner": "integrator",
  "base_commit": "fdd4441adf8f39141492adef1a1dd051b43ca85f",
  "summary": "#8：内置副图首线目前在浅底仍为白色。主题切换、重挂与回放同源；个人均线、画线、指标计算和 M9 均不在范围。",
  "next_action": "按本卡收据复核，单独提 PR；不关闭整个 #8，不打包或替代维护者验收。",
  "allowed_paths": [
    "docs/work-items/tasks/CHART-CONTRAST-01.md",
    "web/src/components/KlineChart.vue",
    "web/src/indicators.ts",
    "web/src/theme.ts",
    "server/test/frontend-contract.test.ts",
    "e2e/indicator-contrast.spec.ts",
    "docs/specs/chart/display.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-CONTRAST-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/CHART-CONTRAST-01.md",
      "docs/work-items/README.md",
      "docs/status.md",
      "docs/specs/chart/display.md"
    ],
    "reason": "#8：内置副图首线目前在浅底仍为白色。主题切换、重挂与回放同源；个人均线、画线、指标计算和 M9 均不在范围。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-CONTRAST-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```
