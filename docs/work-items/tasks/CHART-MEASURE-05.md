# CHART-MEASURE-05 移除顶栏测量入口（保留 Shift 两点测量）

```json
{
  "id": "CHART-MEASURE-05",
  "title": "按用户验收反馈移除顶栏「测量」入口与测量模式（保留既有 Shift 两点测量）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "7687766",
  "summary": "用户 2026-11-13 验收反馈：顶栏新增的「测量」按钮/模式与既有 Shift+鼠标左键两次点击的区间测量功能重复（Issue #8 的需求源于对新功能不熟悉）。本任务回退 CHART-MEASURE-04 的入口与测量模式交互：删除顶栏按钮、measureMode/拖动建立/两次点击模式代码、测量模式提示与探针字段、对应 e2e 套件与文档说明；保留 CHART-MEASURE-02/03 既有 Shift+左键两点区间测量（数据窗口/可拖边界/镜像真实价/回放只读）零回归。其余 v1.3.7 验收内容（布局铺满、面板固定/调宽高）通过，本版本仅移除重复入口；按要求不发布。",
  "next_action": "PR #42 已合入 31455cb；保持暂不发布，后续候选核对 Shift 测量。",
  "allowed_paths": [
    "web/src/components/KlineChart.vue",
    "web/src/components/RangeMeasurement.vue",
    "web/src/views/Training.vue",
    "web/src/styles.css",
    "e2e/measure-tool.spec.ts",
    "e2e/journey.spec.ts",
    "e2e/chart-analysis.spec.ts",
    "e2e/README.md",
    "docs/specs/chart/interaction.md",
    "docs/user/chart-analysis.md",
    "web/src/components/README.md",
    "docs/work-items/tasks/CHART-MEASURE-04.md",
    "docs/work-items/tasks/CHART-MEASURE-05.md",
    "docs/work-items/tasks/REL-137.md",
    "docs/work-items/milestones/V137.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/engineering/release.md",
    "docs/status.md",
    "CHANGELOG.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "docs/verification/2026-11/CHART-MEASURE-04/**",
    "docs/verification/2026-11/CHART-MEASURE-05/**",
    "docs/verification/2026-11/REL-137/README.md",
    "docs/verification/2026-11/V137-user-acceptance/**"
  ],
  "depends_on": ["CHART-MEASURE-04"],
  "docs_impact": {
    "update": ["CHANGELOG.md", "README.md", "docs/engineering/release.md", "docs/specs/chart/interaction.md", "docs/user/chart-analysis.md", "web/src/components/README.md", "e2e/README.md", "docs/work-items/milestones/GH-202611.md", "docs/work-items/README.md"],
    "reason": "移除用户可见入口与测量模式：版本/更新记录、交互规格、用户指南、组件索引、e2e 套件表、批次与任务索引同步。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-MEASURE-05/README.md"],
  "integration_ref": "31455cb (PR #42)",
  "acceptance_ref": "docs/verification/2026-11/V137-user-acceptance/README.md"
}
```

## 冻结口径（用户 2026-11-13 验收反馈）

- 删除训练页顶栏「测量」按钮与 measureMode 测量模式（拖动/两次点击建立、模式提示、measureChange 事件、journey 探针 measure/measurementTool、对应样式）。
- **保留**既有 Shift+鼠标左键两次点击的区间测量与数据窗口（CHART-MEASURE-02/03）：字段、可拖边界、镜像真实价、只读回放、快捷键仲裁全部不变。
- 删除 e2e/measure-tool.spec.ts 与文档中的新入口说明；CHART-MEASURE-04 任务卡与验证记录作为历史保留并标注「已由本卡回退入口」。
- 其他 v1.3.7 内容（CHART-LAYOUT-01 图表铺满、UI-TOOLBAR-03 面板固定/调宽高）保持已验收状态，不改。
- 版本：1.3.8（v1.3.7 未发布，作为验收历史保留）；**不发布**：不打 tag、不发 GitHub Release、不移动更新 feed、不上传镜像。

## 行为

- 训练页顶栏只有「划线」入口，无「测量」按钮；图表默认手势与 Shift 测量与 v1.3.6 一致。
- 新增回归：顶栏无「测量」入口 + Shift 两次点击仍建立区间测量（chart-analysis）。

## 本轮交付

收据见[验证记录](../../verification/2026-11/CHART-MEASURE-05/README.md)，不替代用户验收。
