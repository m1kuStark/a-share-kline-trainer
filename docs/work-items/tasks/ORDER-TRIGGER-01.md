# ORDER-TRIGGER-01 条件单触发语义修订（到价才触发）

```json
{
  "id": "ORDER-TRIGGER-01",
  "title": "条件单触发语义修订：到价才触发（V1.2.5）",
  "owner": "integrator",
  "state": "closed",
  "milestone": "V4",
  "summary": "用户验收 v1.2.4 发现市价上方挂买入限价会在推进时立即成交（经典限价矩阵的立即可成交语义）。V1.2.5 修订为：触发方向挂单时按触发价与阶段价相对位置冻结（up/down），到价才触发；限价按触发价成交（跳空不可成交保持挂单），止损按收盘价成交；旧行 NULL 按经典矩阵兼容。",
  "next_action": "用户验收通过（随 V1.2.6 包，2026-10-02）；无后续动作。",
  "allowed_paths": [
    "server/src/**",
    "server/test/**",
    "web/src/**",
    "e2e/**",
    "docs/proposals/v0.4-training-clock-orders-notes.md",
    "docs/verification/**",
    "docs/work-items/tasks/ORDER-TRIGGER-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/proposals/v0.4-training-clock-orders-notes.md",
      "docs/work-items/tasks/ORDER-TRIGGER-01.md"
    ],
    "reason": "条件单撮合语义是产品规则变化：设计文档语义表、CHANGELOG 与回归用例必须与实现同源。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.5-order-semantics/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## bug 回流反思

- 该问题由用户人工测试发现：服务端旧测试（full-acceptance）恰恰把"市价上方挂买入限价立即成交"当作预期行为断言——测试隐性依赖了被用户否定的语义，属于"测试可能隐性依赖 bug 行为"的又一实例（与 9-28 I1 教训同类）。教训：撮合类语义测试的期望值必须来自用户口径的规格评审，不能从实现反推。
- 回归沉淀：conditional-orders.test.ts 重写为 7 例，显式锁定"到价才触发"（上触/下触两向）、限价跳空保护、止损收盘价口径与遗留数据兼容；e2e 补触发方向提示断言。
