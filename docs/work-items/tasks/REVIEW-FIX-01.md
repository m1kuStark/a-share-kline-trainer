# REVIEW-FIX-01 整批代码审查整改

```json
{
  "id": "REVIEW-FIX-01",
  "title": "整批代码审查整改：创建态费率损坏阻断＋4 份证据门禁收据补实＋测试预算真改＋回归细节",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "9bd598d",
  "summary": "整批代码审查（F1~F7，79b0f8a..4c7f328/9bd598d）裁决 CHANGES REQUIRED 后的整改：① engine 创建入口补损坏费率键 409 零写（此前仅 GET 阻断）并补创建态单测；② 五份验证记录门禁表补真实退出码；③ vitest maxWorkers 4→2 真正落盘（此前证据声称但未改文件）；④ data-update e2e 恢复 dialog 监听（恒真断言）；⑤ sellFee 最终结果再取整；⑥ 修 CSS 重复选择器/尾部换行；⑦ frontend-contract 收紧精确类名；⑧ m3-feedback 恢复 fibonacciLine 取点覆盖；⑨ KlineChart onMounted 注释归位＋时间轴 pointercancel/blur 兜底；⑩ TRAIN-FEE 证据数字更正。",
  "next_action": "重跑 verify:baseline 全绿后随整批验收。",
  "allowed_paths": [
    "server/src/train/engine.ts",
    "server/src/train/account.ts",
    "server/vitest.config.ts",
    "server/test/training-fees.test.ts",
    "server/test/frontend-contract.test.ts",
    "web/src/components/KlineChart.vue",
    "web/src/styles.css",
    "e2e/data-update.spec.ts",
    "e2e/m3-feedback.spec.ts",
    "docs/verification/2026-11/TRAIN-FEE-01/README.md",
    "docs/verification/2026-11/CHART-WEEKDAY-01/README.md",
    "docs/verification/2026-11/CHART-ZOOM-01/README.md",
    "docs/verification/2026-11/CHART-PAN-01/README.md",
    "docs/verification/2026-11/UI-TOOLBAR-01/README.md",
    "docs/verification/2026-11/F7-DEPS-01/README.md",
    "docs/verification/2026-11/REVIEW-FIX-01/**",
    "docs/work-items/tasks/REVIEW-FIX-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md"
  ],
  "depends_on": ["TRAIN-FEE-01", "CHART-WEEKDAY-01", "CHART-ZOOM-01", "CHART-PAN-01", "UI-TOOLBAR-01", "F7-DEPS-01", "TEST-BUDGET-01"],
  "docs_impact": {
    "update": [
      "docs/verification/2026-11/TRAIN-FEE-01/README.md",
      "docs/verification/2026-11/CHART-WEEKDAY-01/README.md",
      "docs/verification/2026-11/CHART-ZOOM-01/README.md",
      "docs/verification/2026-11/CHART-PAN-01/README.md",
      "docs/verification/2026-11/UI-TOOLBAR-01/README.md",
      "docs/verification/2026-11/F7-DEPS-01/README.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "代码审查整改：修正验证记录中缺失/失实门禁收据、补创建态费率损坏阻断实现与测试、修正 vitest 并发配置与若干回归细节；不改产品规格语义。"
  },
  "verification_refs": ["docs/verification/2026-11/REVIEW-FIX-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 审查依据

- 审查范围：79b0f8a..9bd598d（F1~F7 + 门禁预算修正），五维清单＋三级严重度。
- 裁决：CHANGES REQUIRED（3 major / 7 minor）；本卡逐项整改并由 verify:baseline 全绿收口。
