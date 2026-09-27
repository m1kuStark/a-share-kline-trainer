# NOTE-01 B/S 标记理由与悬浮信息

```json
{
  "id": "NOTE-01",
  "title": "B/S 标记理由与悬浮信息",
  "owner": "integrator",
  "state": "planned",
  "milestone": "V4",
  "summary": "在图表下方 B/S 标记上提供交易理由入口，并支持悬停详情和固定浮层。",
  "next_action": "等待 REC-04 冻结 reason、tradePhase 和 executionType 后，改造 TradeMarkerRail 与训练/回放页面。",
  "allowed_paths": [
    "web/src/TradeMarkerRail.vue",
    "web/src/tradeMarkerLayout.ts",
    "web/src/components/KlineChart.vue",
    "web/src/views/Training.vue",
    "web/src/views/SessionReplay.vue",
    "web/src/api.ts",
    "web/src/recording/**",
    "server/test/**",
    "e2e/**",
    "docs/specs/recording.md",
    "docs/specs/chart/display.md",
    "docs/proposals/v0.4-training-clock-orders-notes.md",
    "docs/work-items/tasks/NOTE-01.md"
  ],
  "depends_on": [
    "REC-04"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/recording.md",
      "docs/specs/chart/display.md",
      "docs/proposals/v0.4-training-clock-orders-notes.md",
      "docs/work-items/tasks/NOTE-01.md"
    ],
    "reason": "B/S 标记从只读 title 提示变为可点击编辑、悬停查看和固定浮层，需要同步图表显示和回放规则。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

验收：

- 单笔 B/S 标记点击后打开对应交易的理由入口，保存长度上限为 500 字符。
- 聚合标记先列出笔次，选择后定位到具体成交；不把多笔理由混成一条。
- 悬停 K 线或标记显示日期、阶段、价格、股数、成交类型、理由和订单状态。
- 固定按钮锁定当前浮层；鼠标移开、窗口轻微移动和周期切换不丢失当前选择，关闭后恢复自动消失。
- 深浅主题、窄屏、键盘焦点和回放只读状态通过真实浏览器检查。
- 理由保存失败、过长、旧录像缺字段和交易已结束的只读限制都有明确反馈。

进展注记（2026-09-27）：只读详情子行为拆出 [NOTE-DETAIL-01](NOTE-DETAIL-01.md)（悬停/聚焦/点击详情浮层、聚合选笔、固定，仅展示现有 TradeView 字段：日期/买卖/序号/原始成交价/股数/金额/费用）。理由（reason）、阶段（tradePhase）、订单（executionType）的编辑与展示仍依赖 REC-04/TRAIN-03，本卡整体保持 planned，不因详情浮层视为完成。
