# TRAIN-01 冻结训练规则并统一权息入账

```json
{
  "id": "TRAIN-01",
  "title": "冻结训练规则并统一权息入账",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "已交付：设置默认费用/T+1 API与局部面板、创建规则快照（rules_json v1）与旧局不漂移、新raw/forward权息一致入账、推进短事务状态重查、旧训练迁移幂等与legacy raw只读保护、录像规则接本局快照；待GPT集中验收。",
  "next_action": "control-handoff-20260928-43 五场景（RULES-defaults-current-next/persistence-create/corporate-accounting/legacy-safe/recording-ui-regression）待GPT验收；未验收不集成。",
  "allowed_paths": [
    "server/src/db.ts",
    "server/src/train/**",
    "server/src/settings/**",
    "server/src/api.ts",
    "server/src/recording-context.ts",
    "server/src/docs/recording-context.md",
    "server/test/**",
    "web/src/api.ts",
    "web/src/App.vue",
    "web/src/views/Launcher.vue",
    "web/src/views/Training.vue",
    "web/src/components/TrainingSettings.vue",
    "web/src/settingsPanel.ts",
    "e2e/training-rules.spec.ts",
    "docs/specs/training/rules.md",
    "docs/specs/recording.md",
    "docs/user/training-rules.md",
    "docs/user/README.md",
    "docs/work-items/tasks/TRAIN-01.md",
    "docs/work-items/tasks/M5-01.md",
    "docs/status.md",
    "docs/verification/2026-09/TRAIN-01/**",
    "server/src/train/docs/accounting.md"
  ],
  "depends_on": [
    "REC-01",
    "TRAIN-02"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/training/rules.md",
      "docs/specs/recording.md",
      "docs/user/training-rules.md",
      "server/src/train/docs/accounting.md"
    ],
    "reason": "TRAIN-01 行为交付：快照冻结、设置API、raw权息一致、legacy保护与录像接线。"
  },
  "verification_refs": [
    "docs/verification/2026-09/TRAIN-01/report.md"
  ],
  "integration_ref": "not integrated; task/TRAIN-01 candidate pending GPT review (control-handoff-20260928-43)",
  "acceptance_ref": null
}
```

实现事实（control-handoff-20260928-43，分支 task/TRAIN-01，基线 645ad6c）：

- 规则快照：`trainings.rules_json`（version=1 不可变 JSON），迁移新增列+旧训练回填同事务（幂等、失败回滚、旧行逐字段不变）；旧训练按迁移时点观察值冻结（origin=legacy-migration），legacy raw 记 `legacy-raw-unverified` 并只读保护（409 `LEGACY_RAW_ACCOUNTING_UNVERIFIED`）。
- 设置 API：`GET/PUT /api/settings/training`（`server/src/settings/training.ts`），两布尔严格校验、同事务整体更新、进入 drain 门闩；UI 局部弹层 `web/src/components/TrainingSettings.vue`（不卸载录制中训练、热键隔离经 `web/src/settingsPanel.ts`）。
- 创建冻结：`commitTrainingCreation` 在 BEGIN IMMEDIATE 内读默认并与训练行/初始权益同事务；旧五档与 RANGE 同口径。
- 本局只读快照：交易/可卖数量/recording-context 均读快照；损坏 409 `TRAIN_RULES_UNREADABLE` 零副作用。
- 推进：async 行情读取后短事务重查 status/current_date（409 `TRAIN_STATE_CHANGED`），事务内重放最新余额，权息+推进日+权益点同事务；raw 新训练与 forward 同权息口径。
