# ORDER-01 价格型条件单与确定性撮合

```json
{
  "id": "ORDER-01",
  "title": "价格型条件单与确定性撮合",
  "owner": "integrator",
  "state": "planned",
  "milestone": "V4",
  "summary": "实现单有效订单、限价/止损四种价格行为、跳空成交、取消过期和拒单记录。",
  "next_action": "TRAIN-03 与 REC-04 完成后，先实现限价单，再补止损单和订单生命周期回归。",
  "allowed_paths": [
    "server/src/db.ts",
    "server/src/train/**",
    "server/src/api.ts",
    "server/test/**",
    "web/src/api.ts",
    "web/src/views/Training.vue",
    "web/src/components/**",
    "docs/specs/training/rules.md",
    "docs/specs/recording.md",
    "docs/proposals/v0.4-training-clock-orders-notes.md",
    "docs/work-items/tasks/ORDER-01.md"
  ],
  "depends_on": [
    "TRAIN-03",
    "REC-04",
    "ORDER-00"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/training/rules.md",
      "docs/specs/recording.md",
      "docs/proposals/v0.4-training-clock-orders-notes.md",
      "docs/work-items/tasks/ORDER-01.md"
    ],
    "reason": "订单意图与成交流水分离，且日线 OHLC 触发规则、跳空价、T+1 和拒单语义需要进入现行规格。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

实现范围：

- 新增 orders 表和 /api/trainings/:id/orders、订单查询、取消接口；每个训练最多一个 pending 订单。只有训练快照 ordersEnabled=true 时开放。
- 支持 side=buy/sell 与 order_type=limit/stop 的四种组合；固定股数、全成全拒、训练结束过期。
- open 入口检查已有订单跳空；open 新挂订单可在当日 close 用 high/low 检查；close 新挂订单从下一交易日 open 生效。
- 买入限价、卖出限价、买入止损、卖出止损的成交价严格按 v0.4 设计表执行。
- 触发时重新检查现金、可卖股数、整手和 T+1；失败写 rejected 及原因，不自动缩量。
- trigger_price_raw 用于撮合，trigger_price_chart 只用于显示和复权后的条件线。
- close_only 模式只在完整 K 线公开后的 close 阶段处理触发；open_close 模式才在 open 阶段处理跳空。

验收必须覆盖：四种订单、向有利方向跳空、止损跳空、盘中触发、未触发留存、单订单约束、取消/过期/拒单、T+1、现金不足、重复推进和网络重试幂等。
