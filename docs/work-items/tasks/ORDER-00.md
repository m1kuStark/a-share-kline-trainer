# ORDER-00 条件单实现调研与许可证核查

```json
{
  "id": "ORDER-00",
  "title": "条件单实现调研与许可证核查",
  "owner": "integrator",
  "state": "planned",
  "milestone": "V4",
  "summary": "核查 GitHub 开源条件单实现的许可证、撮合假设和数据模型，只提取适合日线训练器的可验证做法。",
  "next_action": "选取少量许可证清晰、测试可读的候选，记录来源、许可证、可复用边界和与本项目日线规则的差异。",
  "allowed_paths": [
    "docs/proposals/v0.4-training-clock-orders-notes.md",
    "docs/engineering/**",
    "docs/work-items/tasks/ORDER-00.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/proposals/v0.4-training-clock-orders-notes.md",
      "docs/work-items/tasks/ORDER-00.md"
    ],
    "reason": "外部实现只能作为参考；来源、许可证和日线撮合差异必须在采用前留下可审计记录。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

边界：

- 不复制未经核实许可证的代码、测试、资源或文档。
- 不把实时交易系统的盘中撮合语义直接移植到日线训练。
- 输出候选来源、许可证、采用/弃用理由、与 v0.4 固定规则的差异和需要自写的测试。
