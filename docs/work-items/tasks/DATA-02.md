# DATA-02 个股覆盖与到期结算

```json
{
  "id": "DATA-02",
  "title": "个股覆盖与到期结算",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "R1",
  "summary": "用目标个股的实际日期覆盖判断训练能否推进或到期，区分停牌、非交易日、缺失和来源未就绪。",
  "next_action": "加入他股更新但目标漏数、结束日后有记录但中间漏数、非交易日和来源未就绪样例，再实现个股覆盖证明。",
  "allowed_paths": [
    "server/src/train/**",
    "server/test/train-engine.test.ts",
    "docs/work-items/tasks/DATA-02.md",
    "docs/specs/market-data/requirements.md",
    "server/src/train/docs/lifecycle.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/specs/market-data/requirements.md", "server/src/train/docs/lifecycle.md", "docs/work-items/tasks/DATA-02.md"],
    "reason": "训练推进与到期结算的覆盖判断改变时必须同步规格和生命周期说明。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

当前任务不实现 M4 排行和成绩单，也不写用户 7529 数据库或通达信目录。
