# CHART-ZOOM-01 Ctrl+滚轮缩放＋平移快捷键

```json
{
  "id": "CHART-ZOOM-01",
  "title": "Ctrl+滚轮缩放＋Shift+←/→ 平移快捷键（普通滚轮/价格轴既有行为不变）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "7affecb",
  "summary": "Issue #8-D（S 半，计划拍板）：主图 Ctrl+滚轮缩放，复用键盘 zoomBy 口径（视图右端为锚；deltaY<0 放大、>0 缩小）；普通滚轮保持平移、价格轴滚轮保持原生纵轴缩放；新增 Shift+←/→ 平移快捷键（按当前柱宽移动整数根、可按住连发、默认不与交易/推进/缩放热键冲突），设置面板可改键，顶部帮助文案可见；键盘/滚轮均按既有用户导航路径上报录像视窗。",
  "next_action": "随本批整批验收；通过后合入 main 并推送。",
  "allowed_paths": [
    "web/src/keyboardShortcuts.ts",
    "web/src/components/KlineChart.vue",
    "web/src/views/Training.vue",
    "web/src/components/docs/library-adapter.md",
    "server/src/settings/shortcuts.ts",
    "server/test/keyboard-shortcuts.test.ts",
    "server/test/settings-shortcuts.test.ts",
    "server/test/frontend-contract.test.ts",
    "server/test/recording-chart-capture.test.ts",
    "server/test/review-profile.test.ts",
    "e2e/chart-pan-zoom.spec.ts",
    "docs/specs/chart/display.md",
    "docs/specs/chart/interaction.md",
    "docs/user/README.md",
    "docs/work-items/tasks/CHART-ZOOM-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-ZOOM-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/specs/chart/interaction.md",
      "docs/user/README.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "主图新增 Ctrl+滚轮缩放与 Shift+←/→ 平移快捷键；普通滚轮平移、价格轴纵轴缩放与录像视窗上报口径不变；显示/交互规格与用户快捷键表同步。全量并行门禁发现既有 review-profile beforeEach 真实磁盘 I/O 超出 15s hook 预算，按既有先例放宽到 45s，断言不变。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-ZOOM-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径

- Ctrl+滚轮缩放：复用键盘 ↑/↓ 的 zoomBy，右端锚定；deltaY<0 放大、>0 缩小；价格轴区域仍走原生纵轴缩放。
- 普通滚轮：保持既有平移（deltaY>0＝向历史）。
- Shift+←/→：按当前柱宽平移整数根，可按住连发；默认绑定不与既有 13 个动作冲突。
- 录像视窗：沿用 scheduleViewportOperation 用户导航上报；初始化/程序化复位不冒充用户操作。
