# NOTE-DETAIL-01 成交标记详情与固定浮层（只读）

```json
{
  "id": "NOTE-DETAIL-01",
  "title": "成交标记详情与固定浮层（只读）",
  "owner": "worker",
  "state": "review",
  "milestone": "V4",
  "summary": "B/S 标记悬停/聚焦/点击打开只读详情浮层：单笔直显、聚合列笔次选笔、固定、Esc 关闭；仅展示 TradeView 已有事实，理由/阶段/订单字段待 TRAIN-03。",
  "next_action": "F1-F4 限定返修已交付（control-handoff-20260927-39：标题响应 props、焦点事件转发、固定离屏保留渲染、深色列表可读），待 GPT 限定复核；通过后由集成侧串行整合并运行完整发布门禁。",
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
  "integration_ref": null,
  "acceptance_ref": null
}
```

验收（对齐冻结合同四集合）：

- DETAILS-single-and-cluster：真实点击与键盘从单笔/聚合进入准确成交；金额/费用按笔显示、不聚合；原始成交价正确；关闭/选另一笔可用。
- DETAILS-pin-lifecycle：固定后移开、周期切换、resize 仍显示仍存在的成交；解固定、Esc、关闭、卸载不残留；监听器全部卸载。
- DETAILS-replay-no-future：训练与离线回放均可查看；回放退至选中成交前立即清选择和固定；盲训文本/title/aria 不泄露真实日期；浮层内 Space/B/S/Delete/方向不触发交易、推进或画线；无业务写请求。
- DETAILS-visual-regression：深浅主题、840/1440px、密集 B/S 无重叠回归、面板不被 rail `overflow:hidden` 裁切、键盘焦点与 pageerror 干净。

边界：本卡只交付现有 TradeView 字段的只读详情；理由（reason）/阶段（tradePhase）/订单（executionType）编辑与展示仍依赖 REC-04/TRAIN-03，不占位虚构。固定仅页面内临时状态，不写数据库/录像/localStorage。
