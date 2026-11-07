# UI-TOOLBAR-01 顶栏划线开关＋可拖拽图形化悬浮工具栏

```json
{
  "id": "UI-TOOLBAR-01",
  "title": "顶栏「划线」开关＋可拖拽图形化悬浮工具面板（hover 中文名称/描述）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "529105a",
  "summary": "Issue #8 工具栏布局（用户 2026-11-07 拍板 Q8）：顶栏新增「划线」开关；工具面板改为可拖拽悬浮层（默认停靠主图右侧账户区上方、不压价格轴），23 个工具以 SVG 图形化图标＋短标签 5 列网格呈现，1024×680 展开「其他工具」也无需纵向滚动；hover/键盘聚焦显示中文名称与一句具体用途描述；拖动位置持久化并钳制在视口内；常用工具自定义/拖入移出/排序/刷新恢复/折叠能力保留。纯 UI 编排：画线语义、点击取点、快捷键与录像均不变。",
  "next_action": "随本批整批验收；通过后合入 main 并推送。",
  "allowed_paths": [
    "web/src/drawTools.ts",
    "web/src/components/ToolGlyph.vue",
    "web/src/views/Training.vue",
    "web/src/styles.css",
    "server/test/draw-tool-descriptions.test.ts",
    "server/test/frontend-contract.test.ts",
    "e2e/toolbar-floating.spec.ts",
    "e2e/m3-feedback.spec.ts",
    "docs/specs/chart/display.md",
    "docs/user/README.md",
    "docs/work-items/tasks/UI-TOOLBAR-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/UI-TOOLBAR-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/user/README.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "画线工具入口从右栏常驻工具条改为顶栏开关＋可拖拽悬浮面板，新增图形图标与 hover 描述、位置持久化；显示规格与用户操作说明同步。"
  },
  "verification_refs": ["docs/verification/2026-11/UI-TOOLBAR-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-07 拍板）

- 顶栏「划线」开关显示/隐藏悬浮面板；默认显示。
- 图形化图标＋短中文标签；hover/聚焦显示名称＋一句用途描述。
- 可拖拽（标题栏拖动）；位置刷新后保持；越界钳制视口内；默认不压价格轴。
- 1024×680 下 23 工具全部可见、工具列表无纵向滚动。
- 常用工具自定义、其他工具折叠、保存状态栏与既有画线/快捷键语义保留。
