# 任务简报：M9-ENABLE-01（生成于 2026-11-17T18:04:26.698Z）
- 标题：修复公式启停保存并准备 M9 整批验收候选
- 状态：planned
- base_commit：2c66477f0c4875ac3a100338fdbc42b4878dadd8
- 集成引用：未记录
- 验收参考：未记录

## next_action
在维护基线稳定后执行 RED→GREEN；核验真实设置交互、图表刷新、M9 全批回归及主代理深浅主题检查。用户验收和发布均未授权。

## allowed_paths（写文件前逐条对照）
- web/src/components/FormulaSettings.vue
- web/src/api.ts
- server/src/formulas/seed.ts
- server/test/formulas/formula-storage.test.ts
- server/test/formula-library-api.test.ts
- e2e/formula-enable.spec.ts
- e2e/README.md
- docs/specs/formulas.md
- docs/specs/README.md
- docs/proposals/M9-04-formula-product-ui.md
- docs/work-items/tasks/M9-ENABLE-01.md
- docs/work-items/tasks/M9-04B.md
- docs/work-items/tasks/M9-04C.md
- docs/work-items/tasks/M9-04D.md
- docs/work-items/milestones/M9.md
- docs/work-items/README.md
- docs/status.md
- docs/release/M9-ENABLE-01.md
- docs/verification/2026-11/M9-ENABLE-01/**
- CHANGELOG.md
- docs/work-items/tasks/ENG-PLAN-01.md
- docs/work-items/tasks/RUNTIME-CANCEL-02.md
- docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md
- docs/work-items/milestones/ENG.md
- docs/work-items/milestones/GH-202611.md
- docs/proposals/development-batch-2026-11.md
- docs/proposals/development-plan-2026-11.md
- server/test/formula-seed.test.ts

## docs_impact.update（必须同步）
- docs/specs/formulas.md
- docs/specs/README.md
- docs/proposals/M9-04-formula-product-ui.md
- docs/work-items/tasks/M9-04B.md
- docs/work-items/tasks/M9-04C.md
- docs/work-items/tasks/M9-04D.md
- docs/work-items/milestones/M9.md
- docs/work-items/README.md
- docs/status.md
- e2e/README.md

## 行为矩阵（第 3 步用；改动相关模块先跑 check-binding）
- matrix/account-odometer.yaml
- matrix/candle-percent-hover.yaml
- matrix/chart-analysis.yaml
- matrix/chart-gestures.yaml
- matrix/chart-invert.yaml
- matrix/chart-measurement.yaml
- matrix/chart-toggles.yaml
- matrix/chart-weekday.yaml
- matrix/conditional-orders.yaml
- matrix/data-archive.yaml
- matrix/desktop-app.yaml
- matrix/diagnostics-oplog.yaml
- matrix/drawing-persistence.yaml
- matrix/formula-agent.yaml
- matrix/formula-chart.yaml
- matrix/formula-cross-period.yaml
- matrix/formula-engine.yaml
- matrix/formula-library.yaml
- matrix/formula-market-context.yaml
- matrix/formula-ui.yaml
- matrix/kdj-subchart.yaml
- matrix/launcher-lifecycle.yaml
- matrix/local-http-origin.yaml
- matrix/ma-settings.yaml
- matrix/migration-inline.yaml
- matrix/migration-tool-v127.yaml
- matrix/random-training-mode.yaml
- matrix/rankings.yaml
- matrix/recording-bulk.yaml
- matrix/recording-collections.yaml
- matrix/recording-order-actions.yaml
- matrix/replay-period.yaml
- matrix/report-layout.yaml
- matrix/runtime-cancellation.yaml
- matrix/tdx-path-settings.yaml
- matrix/tdx-settings.yaml
- matrix/trade-execution.yaml
- matrix/training-fees.yaml
- matrix/uiux-workbench.yaml
- matrix/updater.yaml

## 依赖
- RUNTIME-CANCEL-02
- DEP-SEC-MINIMATCH-01
- M9-04D

## 锚点问题（回答进会话，未答不得动代码）
- A1: 本任务 allowed_paths 的第 4 项是什么？（逐字）
- A2: 本任务 base_commit 是什么？当前 HEAD 与它的关系？
- A3: docs_impact 要求同步更新哪些文件？

> 纪律：写文件前对照 allowed_paths；声明完成前跑第 4 步门禁；needs_user_decision/proposed_default 矩阵行不得实现。
