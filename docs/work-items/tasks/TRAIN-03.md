# TRAIN-03 两阶段训练时钟与数据库兼容

```json
{
  "id": "TRAIN-03",
  "title": "两阶段训练时钟与数据库兼容",
  "owner": "integrator",
  "state": "planned",
  "milestone": "V4",
  "summary": "默认close_only与显式open_close阶段时钟、形成中K线及数据库迁移已有实现；旧planned标签不表示功能缺失，完整录制/理由与旧数据验收沿后继任务核实。",
  "next_action": "阶段时钟与形成中K线已进入main；close_only/open_close及迁移入口当前仍在。原planned保留为工作流历史，不再从零实现；按V4-01及REC-04/NOTE-01确认录制、理由和旧数据残项。本轮未动态复验。",
  "allowed_paths": [
    "server/src/db.ts",
    "server/src/train/**",
    "server/src/api.ts",
    "server/test/**",
    "web/src/api.ts",
    "web/src/views/Launcher.vue",
    "web/src/views/Training.vue",
    "web/src/components/**",
    "docs/specs/training/rules.md",
    "docs/specs/recording.md",
    "docs/proposals/v0.4-training-clock-orders-notes.md",
    "docs/work-items/tasks/TRAIN-03.md"
  ],
  "depends_on": [
    "TRAIN-02"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/training/rules.md",
      "docs/specs/recording.md",
      "docs/proposals/v0.4-training-clock-orders-notes.md",
      "docs/work-items/tasks/TRAIN-03.md"
    ],
    "reason": "阶段状态、成交时点、形成中 K 线和 equity_curve 主键都会改变训练与录制语义。"
  },
  "verification_refs": ["docs/verification/2026-11/ENG-PLAN-01/reconciliation.md"],
  "integration_ref": "main@784a4d2e9e9afec6bd23ce585592e9817a2ec060",
  "acceptance_ref": null
}
```

实现范围：

- trainings.current_phase、current_open 及 trades.trade_phase、execution_type、reason、order_id 字段；equity_curve 迁移为 training_id + date + phase。
- 新训练按 clock_mode 选择起点：close_only 从完整起始日开始，open_close 从起始日 open 开始；旧行默认 close_only/close。两种模式的 /api/trainings/:id/next 都必须幂等。
- /trade 在 open 使用当天 open，在 close 使用当天 close；服务端决定阶段和执行类型。
- open 图表只允许形成中柱体，收盘型指标只基于完成 K 线；close 才公开完整 OHLC。
- 提前结算在 open 阶段拒绝，T+1 仍按交易日而不是阶段计算。
- 创建表单和训练快照冻结 clock_mode；默认 close_only，用户明确打开开盘交易后才允许 open 成交。

验收必须覆盖：迁移回滚、旧训练读取、阶段重复请求、open/close 价格、close 后进入下一日 open、无未来 high/low/close、形成中周期图表、同日买入不可卖出和旧 API 客户端兼容。
