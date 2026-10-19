# REPLAY-VIEWPORT-01 回放按日推进主图视口大平移修复

```json
{
  "id": "REPLAY-VIEWPORT-01",
  "title": "回放推进到特定交易日时主图右侧空白突变致画面大规模平移（齐心集团 2026-9-15→9-16）",
  "owner": "zcode:replay-viewport",
  "state": "planned",
  "milestone": "R5",
  "summary": "用户验收 v1.3.3 报告：齐心集团训练录像回放中，显示 2026-9-15 按空格推进到 9-16 时主图大规模移动——右侧黑色空白空间突然出现（回退 9-14 空白消失）。疑点区：SessionReplay 按日推进 feed 数据 + KlineChart replayView 按时间戳恢复右侧锚点机制在跨日边界的视口计算。",
  "next_action": "bug-loop 三步：复现（本机用户录像只读/或特征数据构造）→RED 回归→修复；矩阵行 REPLAY-VIEWPORT-STEADY-ADVANCE 已预登记 planned。",
  "allowed_paths": [
    "web/src/views/SessionReplay.vue",
    "web/src/components/KlineChart.vue",
    "web/src/chartNavigation.ts",
    "web/src/recording/",
    "server/test/recording-daily-replay.test.ts",
    "server/test/recording-compact-replay.test.ts",
    "server/test/recording-replay.test.ts",
    "docs/work-items/tasks/REPLAY-VIEWPORT-01.md",
    "docs/verification/2026-10/REPLAY-VIEWPORT-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [],
    "reason": "纯 bug 修复，行为回到既有契约（视口跨日稳定）。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

用户原话（oracle）：「按空格显示下一根 K 线，即 2026-9-16 这根 K 线的时候……主图画面进行了大规模的移动……主图右侧的黑色空白空间突然出现……我认为这是画面显示 bug……请你定位并解决这个问题」（2026-10-13 第五轮任务 2）。

## 2026-10-20 元数据修复

旧状态 `queued` 规范为 `planned`；仅对齐既有工作流枚举，不新增实现或用户验收结论。
