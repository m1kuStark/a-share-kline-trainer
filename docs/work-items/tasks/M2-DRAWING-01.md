# M2-DRAWING-01 画线持久化三缺陷修复（撤销史/样式/录像）

```json
{
  "id": "M2-DRAWING-01",
  "title": "修复画线三真缺陷：推进清撤销历史、恢复覆盖自定义样式、录像丢画线",
  "owner": "integrator",
  "state": "review",
  "milestone": "RF",
  "summary": "用户 2026-10-19 批复 1/2/3（E2E-BASELINE-01 桶A-①②④，全部带 G3 探针实证）：①feedData 每次推进无条件 drawingHistory.reset([]) 违背 drawing-persistence.md「推进不清撤销历史」；②restoreDrawings 用 configuredOverlayStyle 覆盖 item.styles 致自定义样式在编辑/撤销/重做/刷新后丢失；③周期过滤渗入 captureState 致录像回放丢画线（隔离口径=显示层过滤，用户已拍板，持久面不得过滤）。RED 已由 G3 线上失败提供（drawing-basis/m3-round3/m3-tools D26-D29/D28/recording 各用例）。矩阵 drawing-persistence.yaml 三行已 root 预登记（worker 不得编辑矩阵）。",
  "next_action": "bug-loop：先逐缺陷读码确认根因（分类报告证据为假设待核实）→修复→受影响 e2e 转绿；禁止为绿弱化既有断言；画线隔离口径（E2E-SPEC-SYNC-01 刚定案）不得回退。",
  "allowed_paths": [
    "web/src/**",
    "server/test/**",
    "e2e/**",
    "docs/verification/**",
    "docs/work-items/tasks/M2-DRAWING-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/M2-DRAWING-01.md"
    ],
    "reason": "M2 修复轮证据承载；E2E-BASELINE-01 分类账本由本任务收尾时同步。"
  },
  "verification_refs": [
    "docs/verification/2026-10/E2E-BASELINE-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- 三缺陷各自先有针对性复现（可单测/探针/e2e 既有失败引用），修复后受影响 e2e 全绿：drawing-basis、m3-round3（诅咒线 50% 射线）、m3-tools D26-D29/D28、recording 默认录制。
- 撤销历史跨推进保留；样式跨恢复保留；录像含全周期画线且回放呈现。
- 隔离口径不回退：周/月视图仍不显示他周期画线（E2E-SPEC-SYNC-01 断言仍绿）。
- 禁止为绿改断言；若修复中 discovers 断言本身另有过时处，单独呈报不混入。
