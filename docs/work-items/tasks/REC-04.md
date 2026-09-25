# REC-04 成交理由与订单事件录制回放

```json
{
  "id": "REC-04",
  "title": "成交理由与订单事件录制回放",
  "owner": "integrator",
  "state": "planned",
  "milestone": "V4",
  "summary": "为手动成交和条件单增加可选理由，并在录制、导入和回放中保留阶段、模式与订单事件顺序。",
  "next_action": "等待 TRAIN-03 冻结阶段快照，再扩展 v2 可选资源和动作白名单；旧 v1/v2 文件继续可读。",
  "allowed_paths": [
    "web/src/api.ts",
    "web/src/recording/**",
    "web/src/views/Training.vue",
    "web/src/views/SessionReplay.vue",
    "server/test/**",
    "e2e/**",
    "docs/engineering/recording-contract.md",
    "docs/engineering/recording-v2-contract.md",
    "docs/specs/recording.md",
    "docs/proposals/v0.4-training-clock-orders-notes.md",
    "docs/work-items/tasks/REC-04.md"
  ],
  "depends_on": [
    "TRAIN-03"
  ],
  "docs_impact": {
    "update": [
      "docs/engineering/recording-contract.md",
      "docs/engineering/recording-v2-contract.md",
      "docs/specs/recording.md",
      "docs/proposals/v0.4-training-clock-orders-notes.md",
      "docs/work-items/tasks/REC-04.md"
    ],
    "reason": "新增 reason、阶段、订单状态和 order.place/cancel/fill 会改变事件白名单、快照资源和回放顺序。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

实现范围：

- reason 为可空、最多 500 字符的纯文本；手动成交写入 trades，挂单写入 orders，条件单成交复制到 trades。
- v1/v2 导入保持兼容；v2 新增字段和订单资源使用可选形状，旧文件按 close、空订单、空理由解释。
- 增加 order.place、order.cancel、order.fill，并把 training.advance 的阶段转换写入参数。
- checkpoint 保存阶段、形成中柱体状态、成交和订单引用；回放按“挂单→触发→成交”恢复。
- 理由在成交后不可原地编辑；超长文本、异常 JSON、悬空引用和未来检查点必须拒绝。

验收必须覆盖：旧文件导入、v2 新文件往返、理由长度和纯文本校验、动作配对、订单状态回放、暂停恢复、重复事件、gzip 导出和离线回放。
