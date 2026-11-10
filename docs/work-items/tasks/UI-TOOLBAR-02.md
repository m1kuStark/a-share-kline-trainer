# UI-TOOLBAR-02 画线工具面板紧凑化

```json
{
  "id": "UI-TOOLBAR-02",
  "title": "画线工具面板紧凑化（Issue #8 2026-11-11 反馈）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "e37234e",
  "summary": "用户 2026-11-11 反馈 v1.3.6 悬浮工具面板：自定义常用工具较多时仍需纵向滚动、图标/按钮偏大、遮挡画面。按用户要求做紧凑图标优先方案：glyph 20→16px、按钮高 44→36px、5 列→6 列自适应、默认展开常用+其他工具、1024×680/1366×705 下工具列表无纵向滚动；保留拖拽/位置记忆、hover 名称/描述与常用工具自定义语义。",
  "next_action": "定向 journey 7/7、verify:fast、uiux-workbench binding RED=0 已过（证据 docs/verification/2026-11/UI-TOOLBAR-02）；用户验收随整批；resize/pin 留后续辅助项。",
  "allowed_paths": [
    "web/src/views/Training.vue",
    "web/src/styles.css",
    "web/src/components/ToolGlyph.vue",
    "e2e/toolbar-floating.spec.ts",
    "e2e/m3-feedback.spec.ts",
    "e2e/uiux-training.spec.ts",
    "docs/specs/chart/display.md",
    "docs/user/README.md",
    "docs/work-items/tasks/UI-TOOLBAR-02.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/UI-TOOLBAR-02/**"
  ],
  "depends_on": ["UI-TOOLBAR-01"],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/user/README.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "画线悬浮面板改为紧凑图标优先网格、默认展开全部工具；用户文档与显示规格同步。"
  },
  "verification_refs": ["docs/verification/2026-11/UI-TOOLBAR-02/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-11 拍板）

- 图标/按钮变小：glyph 16px、按钮高约 36px、6 列自适应、标签 9px；面板宽度约 284px，默认不遮挡价格轴关键区域。
- 默认展开“常用工具”和“其他工具”，23 个工具一眼可见；工具列表在 1024×680/1366×705 默认无纵向滚动。
- 常用工具自定义（拖入/移出/排序/刷新恢复）、hover/键盘名称与用途、位置拖拽与持久化保持不变。
- 画线语义、点击取点、快捷键、录像均不变。
- resize/pin 为后续辅助项，不在本卡首批实现（如实现需另补验收）。

## 行为

- 打开训练页后面板默认展示全部 23 个工具（常用区 + 其他区），无需点击“其他工具”才能看到全部。
- 常用工具 0/5/10/23 个时，面板内容均不产生纵向滚动（工具总数固定 23）。
- 紧凑尺寸下 hover/focus 提示仍显示中文名称与具体用途。
- 位置拖拽、刷新恢复、越界钳制保持既有行为。
- 面板内容高度变化（折叠/展开/自定义）时位置自动重新钳制在视口内。

## 本轮交付（2026-11-11）

- 紧凑样式：glyph 16px、按钮高 36px、6 列自适应、标签 9px、面板宽 284px；默认展开常用+其他工具；默认停靠主图左下；内容变化时重新钳制位置。
- 测试：e2e/toolbar-floating.spec.ts 重写为“默认展开+常用 0/5/10/23 无滚动+紧凑尺寸”；m3-feedback/uiux-training 的默认折叠断言按拍板行为更新；新增矩阵行 UIUX-TOOLBAR-COMPACT-DEFAULT/SIZE。
- 证据：docs/verification/2026-11/UI-TOOLBAR-02/README.md（RED run `run-310b52d5`，GREEN run `run-46d15cb7` 7 passed，verify:fast PASS，binding RED=0）。
