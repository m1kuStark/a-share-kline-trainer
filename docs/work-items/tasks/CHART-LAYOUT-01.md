# CHART-LAYOUT-01 训练页图表铺满可用高度

```json
{
  "id": "CHART-LAYOUT-01",
  "title": "训练页图表铺满可用高度（消除底部空白行）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "7895a22",
  "summary": "修复用户 2026-11-10 反馈的底部空白：实测 1366×705 下 .chart-frame 网格为 auto minmax(0,1fr) 40px，ChartQuote 被 Teleport 到状态条后 Grid 仍保留 29px 空行，成交标记带被挤入中间行并溢出，图表宿主高度小于面板可用高度。改为图表宿主占满「面板高度−成交标记带」，主图/副图/时间轴重新分配；切换指标、拖动分隔条、窗口 resize、窗格最大化后仍铺满。保持 paneHeights 录像语义、成交标记带 40px 与既有图表交互零回归。",
  "next_action": "已合入 main（8eec4cf）并集成 v1.3.7（REL-137）；审查整改见验证记录；用户验收随 v1.3.7 人工验收节点。原计划：先写 RED 几何回归（layout-fill 三尺寸）→ 重构容器布局 → 三尺寸双主题 + resize/指标切换/最大化 GREEN → 定向 journey、verify:fast、docs:impact、binding 严格门禁 → 证据、提交、draft PR。",
  "allowed_paths": [
    "web/src/components/KlineChart.vue",
    "web/src/styles.css",
    "e2e/layout-fill.spec.ts",
    "e2e/compact-chart.spec.ts",
    "e2e/README.md",
    "docs/specs/chart/display.md",
    "docs/work-items/tasks/CHART-LAYOUT-01.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-LAYOUT-01/**"
  ],
  "depends_on": ["UI-TOOLBAR-02"],
  "docs_impact": {
    "update": ["docs/specs/chart/display.md", "e2e/README.md"],
    "reason": "图表容器改为铺满可用高度，显示规格补充布局约束；新增 layout-fill 套件写入 e2e 索引。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-LAYOUT-01/README.md"],
  "integration_ref": "8eec4cf",
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-10 反馈）

- 图表面板内不得出现固定空白行/空白带：图表宿主高度＝面板内容高度 − 成交标记带高度；主图、VOL/MACD/KDJ 副图、时间轴全部分配到该高度。
- 根因已实测（1366×705，v1.3.6 main）：`.chart-frame` 的 grid 首行 auto 在 ChartQuote 被 Teleport 后未被回收，实测行高 `536px 29px 40px`，成交标记带落在 29px 中间行并溢出到第三行，面板底部剩 29px 空白；`.chart-frame`/`.chart-wrap` 不得依赖「引子在流内」的旧假设。
- 修复方向不限定实现（flex 列或按 Teleport 状态切换 grid 行均可），但必须同时覆盖：Quote 内联（无 Teleport 目标，如回放页）与 Quote Teleport 两种形态。
- 成交标记带保持 40px 功能带（B/S 标记），不作为空白删除；缩窗/最大化/切换指标后不得出现滚动或页面溢出。
- 不改 paneHeights 捕获/回放语义（值随实际高度自然变化）、不改画线/手势/快捷键语义。

## 行为

- 1024×680、1366×705、1440×900 三尺寸：frame 无空余网格行，frame 底边与 chart-panel 内容底边对齐（±1px），host 高度 + 分隔/时间轴/标记带之和等于 frame 高度。
- 切换 VOL/MACD/KDJ、拖动窗格分隔条、双击副图最大化/还原、窗口 resize 后同一组几何不变量成立。
- 深浅主题、Quote 内联形态（回放页复用 KlineChart）均无空白行、无 pageerror、无横向溢出。

## 本轮交付

- 根因（2026-11-12 旧实现实测）：`.chart-frame` 的 3 行 grid 在训练页 ChartQuote 被 Teleport 后仍保留 auto 首行；首行由图表内容撑成自指固定点（主图 207＋VOL/MACD/KDJ 100×3＋分隔条 3＋时间轴 26＝536px），成交标记带落入 1fr 中间行并溢出到 40px 第 3 行，底部残留空白（1024×680 4px / 1366×705 29px / 1440×900 224px，host 恒 536px）。
- 改动（`web/src/components/KlineChart.vue`）：`.chart-frame` 改 flex 纵向列；`.chart-wrap` 由 `height:100%` 改 `flex:1 1 0; min-height:0`。训练页 Teleport 与回放页内联行情条共用同一规则；未改 paneHeights 捕获/回放语义、成交标记带 40px 与手势/画线/快捷键。
- 测试：新增 `e2e/layout-fill.spec.ts` 3 用例先 RED（run-966fc58e-40d0-4af9-8dcb-8cca9a4aa3bb，2 失败 1 通过＝回放内联兼容守卫）后 GREEN（run-68c3e4a6-8850-47dc-a3f8-3e51c3e59140，3 passed）；既有 compact-chart/uiux-training/pane-resize/chart-toggles/chart-analysis 回归 run-77b24bae-740f-421d-aec9-fc79986d41d1 22 passed。
- 证据：`docs/verification/2026-11/CHART-LAYOUT-01/README.md`（含门禁收据、三尺寸双主题截图 11 张与 RED 失败截图 2 张）。
