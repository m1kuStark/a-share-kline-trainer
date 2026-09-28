# V1-INTEGRATE-01 V1已接受训练规则与成交详情组合候选验证

```json
{
  "id": "V1-INTEGRATE-01",
  "title": "V1已接受训练规则与成交详情组合候选验证",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "已接受NOTE和TRAIN相同代码在独立V1组合候选快进整合与完整门禁；不含停止的SETUP，不授权实现返修。",
  "next_action": "I1测试隔离限定返修（control-handoff-20260928-48）已实现并过有序回归；完整verify:candidate运行后待GPT一次限定复核；有效预算4/5。",
  "base_commit": "3f8c61246d5c057743fc312b07ebdd704d23658a",
  "source_commit": "52889a70b6bd3037339e3414adc47ccdad0d104f",
  "allowed_paths": [
    "docs/specs/chart/display.md",
    "docs/specs/recording.md",
    "docs/specs/training/rules.md",
    "docs/status.md",
    "docs/user/README.md",
    "docs/user/training-rules.md",
    "docs/verification/2026-09/NOTE-DETAIL-01/acceptance-42.md",
    "docs/verification/2026-09/NOTE-DETAIL-01/repair-39.md",
    "docs/verification/2026-09/NOTE-DETAIL-01/report.md",
    "docs/verification/2026-09/TRAIN-01/acceptance-45.md",
    "docs/verification/2026-09/TRAIN-01/m2/M2-e2e-report.md",
    "docs/verification/2026-09/TRAIN-01/report.md",
    "docs/verification/2026-09/V1-INTEGRATE-01/report.md",
    "docs/verification/2026-09/V1-INTEGRATE-01/repair-48.md",
    "docs/verification/README.md",
    "docs/work-items/current-feature.json",
    "docs/work-items/tasks/M5-01.md",
    "docs/work-items/tasks/NOTE-01.md",
    "docs/work-items/tasks/NOTE-DETAIL-01.md",
    "docs/work-items/tasks/TRAIN-01.md",
    "docs/work-items/tasks/V1-INTEGRATE-01.md",
    "e2e/m3-round3.spec.ts",
    "e2e/trade-marker-details.spec.ts",
    "e2e/training-range.spec.ts",
    "e2e/training-rules.spec.ts",
    "e2e/data-update.spec.ts",
    "server/src/api.ts",
    "server/src/db.ts",
    "server/src/docs/recording-context.md",
    "server/src/recording-context.ts",
    "server/src/settings/training.ts",
    "server/src/train/AGENTS.md",
    "server/src/train/account.ts",
    "server/src/train/docs/accounting.md",
    "server/src/train/engine.ts",
    "server/src/train/rules.ts",
    "server/test/chart-cost-basis.test.ts",
    "server/test/db-training-rules-migration.test.ts",
    "server/test/drawing-price-basis.test.ts",
    "server/test/recording-context.test.ts",
    "server/test/rights-cost-basis.test.ts",
    "server/test/settings-training.test.ts",
    "server/test/trade-marker-details.test.ts",
    "server/test/train-account.test.ts",
    "server/test/train-rules-snapshot.test.ts",
    "server/test/training-rules-frontend.test.ts",
    "web/src/App.vue",
    "web/src/TradeMarkerDetails.vue",
    "web/src/TradeMarkerRail.vue",
    "web/src/api.ts",
    "web/src/components/TrainingSettings.vue",
    "web/src/settingsPanel.ts",
    "web/src/tradeMarkerDetails.ts",
    "web/src/views/Training.vue"
  ],
  "depends_on": [
    "NOTE-DETAIL-01",
    "TRAIN-01"
  ],
  "docs_impact": {
    "update": [
      "docs/verification/2026-09/V1-INTEGRATE-01/report.md"
    ],
    "reason": "Integration inherited code is unchanged; only candidate identity, exact gate evidence and coexistence validation are new."
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

整合事实（control-handoff-20260928-46，分支 task/V1-INTEGRATE-01）：

- fast-forward：base 3f8c612 → HEAD 52889a7（TRAIN 代码 c0fa04c、NOTE 代码 6cbf7a6 均为祖先；已验不含 3875941/309e754 失败 SETUP 提交）。
- 继承范围：base..52889a7 恰为 49 个变更文件（inherited-paths.json），本卡 allowed_paths 逐一覆盖；不重实现、不改已接受行为。
- 组合门禁：verify:candidate --base 3f8c612 --task V1-INTEGRATE-01（docs/impact/unit/types/build/snapshot/M2/Journey retries=0）＋NOTE+TRAIN 共存 UI 语义检查。
- 边界：SETUP 严格排除；无实现修复授权；组合门禁若发现产品缺陷保存候选一次 needs_replan。
