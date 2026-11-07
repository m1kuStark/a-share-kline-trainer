# TRAIN-FEE-01 个性化佣金费率（训练默认设置）

```json
{
  "id": "TRAIN-FEE-01",
  "title": "训练默认设置支持个性化佣金/最低佣金/卖出印花税率",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "79b0f8a",
  "summary": "Issue #8-A（用户 2026-11-07 拍板推荐口径）：训练默认设置新增可配费率三项——佣金率、最低佣金（0＝免 5）、卖出印花税率；佣金与印花税各自四舍五入到分；单一当前费率不按历史日期回溯；暂不设过户费、排行不按费率分组。新训练创建时把数值冻结进 rules_json 快照，修改默认只影响新训练；旧两布尔/四字段客户端 PUT 兼容且不改写已存费率；损坏费率键 409 TRAINING_DEFAULTS_UNREADABLE 可行动报错。",
  "next_action": "随本批整批验收；通过后合入 main 并推送。",
  "allowed_paths": [
    "server/src/settings/training.ts",
    "server/src/settings/creation-defaults.ts",
    "server/src/settings/fee-defaults.ts",
    "server/src/train/rules.ts",
    "server/src/train/account.ts",
    "server/src/train/engine.ts",
    "server/src/train/docs/accounting.md",
    "server/test/settings-training.test.ts",
    "server/test/training-fees.test.ts",
    "server/test/train-account.test.ts",
    "web/src/api.ts",
    "web/src/components/TrainingSettings.vue",
    "web/src/components/HistoryReport.vue",
    "web/src/views/Training.vue",
    "web/src/styles.css",
    "e2e/training-fees.spec.ts",
    "e2e/training-defaults.spec.ts",
    "e2e/training-rules.spec.ts",
    "docs/specs/training/rules.md",
    "docs/user/training-rules.md",
    "docs/work-items/tasks/TRAIN-FEE-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TRAIN-FEE-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/training/rules.md",
      "docs/user/training-rules.md",
      "server/src/train/docs/accounting.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "训练默认设置新增可编辑费率三项、费用取整口径与快照冻结语义；用户说明与后端会计说明同步。"
  },
  "verification_refs": ["docs/verification/2026-11/TRAIN-FEE-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-07 拍板）

- 可配字段：佣金率、最低佣金（0＝免 5）、卖出印花税率；**不设过户费**。
- 费用取整：佣金与印花税各自四舍五入到 0.01 元后相加。
- 单一当前费率：不按成交日期回溯历史费率；排行不按费率分组。
- 快照：创建时写入本局 `rules_json`（version 1，数值域同 TRAIN-01 解析器）；已结算训练与录像回放读冻结值，零影响。
- 兼容：旧两布尔/四字段 PUT 保持 200 且不改写已存费率；损坏费率键列表化 409，不自动修复。

## 验收（整批）

见批次验收清单与本卡验证记录 `docs/verification/2026-11/TRAIN-FEE-01/README.md`；用户验收统一在本批整批验收记录。
