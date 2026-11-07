# CHART-PAN-01 时间轴拖动平移

```json
{
  "id": "CHART-PAN-01",
  "title": "底部时间轴普通左键拖动平移（独占时间轴手势，回放可用）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "4a8f44e",
  "summary": "Issue #8-D（M 半，计划拍板：时间轴拖动平移）：底部 x_axis_pane 上的普通左键拖动平移视窗——拖右看更早、拖左看更新，同屏根数不变，悬停显示抓手/拖动中 grabbing；与图表区左键框选、Shift 测量、Ctrl/Alt/Meta 组合、绘图取点、多选、分隔条/价格轴缩放互斥（时间轴独占本次手势）；只读回放沿用同一路径。",
  "next_action": "随本批整批验收；通过后合入 main 并推送。",
  "allowed_paths": [
    "web/src/components/KlineChart.vue",
    "web/src/components/docs/interaction.md",
    "server/test/frontend-contract.test.ts",
    "server/test/recording-chart-actions.test.ts",
    "server/test/worktree-tools.test.ts",
    "server/vitest.config.ts",
    "e2e/chart-time-axis-pan.spec.ts",
    "docs/specs/chart/display.md",
    "docs/specs/chart/interaction.md",
    "docs/user/README.md",
    "docs/work-items/tasks/CHART-PAN-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-PAN-01/**"
  ],
  "depends_on": ["CHART-ZOOM-01"],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/specs/chart/interaction.md",
      "docs/user/README.md",
      "web/src/components/docs/interaction.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "新增时间轴拖动平移手势及其与既有框选/测量/多选/轴缩放的优先级；用户图表操作说明与事件仲裁文档同步。全量并行门禁在 Windows/Node24 下偶发既有 hook 超时/子进程清理 flaky：放宽 worktree-tools hook 预算（30s→90s）并把 vitest maxWorkers 收紧到 2，断言与测试集合不变。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-PAN-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-07 拍板）

- 时间轴（x_axis_pane）普通左键拖动平移；拖右＝看更早、拖左＝看更新；同屏根数不变、无惯性。
- 悬停时间轴 cursor=grab，拖动中 grabbing；离开恢复。
- 修饰键（Shift/Ctrl/Alt/Meta）、绘图取点、多选模式下不启动；图表区框选/Shift 测量/分隔条/价格轴缩放优先级不变。
- 只读回放同一路径可用；平移按用户导航上报录像视窗。
