# NOTE-DETAIL-01 成交标记详情与固定浮层（只读）

```json
{
  "id": "NOTE-DETAIL-01",
  "title": "成交标记详情与固定浮层（只读）",
  "owner": "worker",
  "state": "closed",
  "milestone": "V4",
  "summary": "只读成交详情四场景已通过GPT限定验收；F1-F4及防未来回归闭合，未集成或发布，NOTE-01整体仍planned。",
  "next_action": "保留6effeb3的已接受范围，等待集成侧串行整合及完整候选门禁；不重复派发本片返修。",
  "allowed_paths": [
    "web/src/TradeMarkerRail.vue",
    "web/src/TradeMarkerDetails.vue",
    "web/src/tradeMarkerDetails.ts",
    "web/src/tradeMarkerLayout.ts",
    "web/src/components/KlineChart.vue",
    "server/test/trade-marker-details.test.ts",
    "server/test/trade-marker-layout.test.ts",
    "server/test/frontend-contract.test.ts",
    "e2e/trade-marker-details.spec.ts",
    "e2e/m3-round3.spec.ts",
    "docs/specs/chart/display.md",
    "docs/status.md",
    "docs/work-items/tasks/NOTE-DETAIL-01.md",
    "docs/work-items/tasks/NOTE-01.md",
    "docs/verification/2026-09/NOTE-DETAIL-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/chart/display.md",
      "docs/work-items/tasks/NOTE-01.md"
    ],
    "reason": "成交标记从原生 title 提示升级为可键盘访问的只读详情浮层（悬停/点击/固定/关闭），图表显示规格与 NOTE-01 范围注记需同步。"
  },
  "verification_refs": [
    "docs/verification/2026-09/NOTE-DETAIL-01/report.md"
  ],
  "integration_ref": "v1-integration candidate 52889a70 (accepted code inherited unchanged)",
  "acceptance_ref": "docs/verification/2026-09/NOTE-DETAIL-01/acceptance-42.md"
}
```

验收（对齐冻结合同四集合）：

- DETAILS-single-and-cluster：真实点击与键盘从单笔/聚合进入准确成交；金额/费用按笔显示、不聚合；原始成交价正确；关闭/选另一笔可用。
- DETAILS-pin-lifecycle：固定后移开、周期切换、resize 仍显示仍存在的成交；解固定、Esc、关闭、卸载不残留；监听器全部卸载。
- DETAILS-replay-no-future：训练与离线回放均可查看；回放退至选中成交前立即清选择和固定；盲训文本/title/aria 不泄露真实日期；浮层内 Space/B/S/Delete/方向不触发交易、推进或画线；无业务写请求。
- DETAILS-visual-regression：深浅主题、840/1440px、密集 B/S 无重叠回归、面板不被 rail `overflow:hidden` 裁切、键盘焦点与 pageerror 干净。

边界：本卡只交付现有 TradeView 字段的只读详情；理由（reason）/阶段（tradePhase）/订单（executionType）编辑与展示仍依赖 REC-04/TRAIN-03，不占位虚构。固定仅页面内临时状态，不写数据库/录像/localStorage。
