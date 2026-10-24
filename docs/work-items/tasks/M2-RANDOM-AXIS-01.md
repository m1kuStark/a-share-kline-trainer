# M2-RANDOM-AXIS-01 随机模式日期揭示与交易日对齐

```json
{
  "id": "M2-RANDOM-AXIS-01",
  "title": "定位并修复：随机时间模式揭示的真实日期落在非交易日",
  "owner": "integrator",
  "state": "review",
  "milestone": "RF",
  "summary": "用户 2026-10-19 批复 4（原 G3 待复核项就此定案为真缺陷）：random_time 模式眼睛揭示出的真实日期经会话常量偏移反推，落在周末/节假日（实证：揭示标签 2005-05-10 反推 2005-05-07=周六），与该 K 线真实交易日不对应。任务=先定位（反推换算与数据锚定两源不一致的根因），再修复为以该 bar 实际交易日为锚。矩阵行 RANDOM-REVEAL-TRADING-DAY 已 root 预登记（random-training-mode.yaml，worker 不得编辑矩阵）。既有失败用例：random-mask-axis.spec.ts（RF2-02/03 轮曾 3/3 过，窗口相关）。",
  "next_action": "修复已接入 codex/builder-review-followup 隔离候选，交易日单测与随机模式 Journey 通过；见 BUILDER-REVIEW-01 验收记录。尚未合主仓库或用户验收。",
  "allowed_paths": [
    "web/src/**",
    "server/test/**",
    "e2e/**",
    "docs/verification/**",
    "docs/work-items/tasks/M2-RANDOM-AXIS-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/M2-RANDOM-AXIS-01.md"
    ],
    "reason": "定位结论与修复证据承载。"
  },
  "verification_refs": [
    "docs/verification/2026-10/E2E-BASELINE-01/README.md",
    "docs/verification/2026-10/BUILDER-REVIEW-01/README.md"
  ],
  "integration_ref": "6251f4b（builder-review-followup 候选，未合主仓库）",
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- 定位结论写清根因（为何反推会偏移到非交易日——如掩码轴生成与真实日历不同源）。
- 修复后：揭示日期恒等于该 bar 真实交易日（工作日用例＋跨节假日用例）。
- 既有 random-mask-axis/random-mode 相关用例回归全绿；遮蔽与眼睛揭示交互不破坏。
- e2e 浏览器运行等 root 串行信号（另一 worker 占用中）。
