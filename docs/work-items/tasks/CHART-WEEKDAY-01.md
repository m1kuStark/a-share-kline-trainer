# CHART-WEEKDAY-01 星期显示（悬浮卡＋时间轴＋状态条）

```json
{
  "id": "CHART-WEEKDAY-01",
  "title": "日K 悬浮卡/时间轴/状态条显示中文星期（周月K不加、盲训遮蔽不泄露）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "dac4c95",
  "summary": "Issue #8-C（用户 2026-11-07 拍板：悬浮卡＋时间轴＋状态条）：日K 日期统一追加中文星期——悬停信息卡日期行、X 轴时间刻度、底部状态条「可见至/末根」与常驻行情条日期；周K/月K 不加（无单一日内星期语义）；随机时间遮蔽态仍只呈现星号，不泄露日期/星期。纯展示层：不改 K 线/交易/录像/持久数据，星期由 ISO 日期串按 UTC 日历纯函数计算，非法日历日不臆造。",
  "next_action": "随本批整批验收；通过后合入 main 并推送。",
  "allowed_paths": [
    "web/src/dateLabels.ts",
    "web/src/components/KlineChart.vue",
    "web/src/views/Training.vue",
    "server/test/date-labels.test.ts",
    "server/test/train-range-preview.test.ts",
    "e2e/weekday-display.spec.ts",
    "e2e/percent-hover.spec.ts",
    "e2e/random-mask-axis.spec.ts",
    "docs/specs/chart/display.md",
    "docs/user/chart-analysis.md",
    "docs/work-items/tasks/CHART-WEEKDAY-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-WEEKDAY-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/user/chart-analysis.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "日K 悬浮卡/时间轴/状态条日期呈现口径新增中文星期，周月K与盲训遮蔽语义不变；显示规格与用户图表说明同步。全量并行门禁发现既有 train-range-preview 并发用例默认 5s 预算不足（真实 SQLite 双请求竞争），按既有先例放宽到 20s，断言不变。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-WEEKDAY-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-07 拍板）

- 呈现位置：悬浮信息卡日期行、X 轴时间刻度、底部状态条「可见至/末根」、常驻行情条日期。
- 仅日K追加中文星期；周K/月K 不加。
- 随机时间遮蔽态：仍为星号（不显示星期，不泄露日期）；揭示态按既有常量差换算真实日期后再加星期。
- 纯展示层：交易、结算、录像、画线持久面零改动。
