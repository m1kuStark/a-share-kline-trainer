# DATA-02 个股覆盖与到期结算

```json
{
  "id": "DATA-02",
  "title": "个股覆盖与到期结算",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "R1",
  "summary": "用目标个股的实际日期覆盖判断训练能否推进或到期，区分停牌、非交易日、缺失和来源未就绪。",
  "next_action": "已合入并通过R1完整基线门禁；后续来源版本与统一读取契约分别由DATA-03/DATA-04负责。",
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
  "verification_refs": ["server/test/train-engine.test.ts", "docs/verification/2026-09/DATA-02-review.json"],
  "integration_ref": "9e53982",
  "acceptance_ref": null
}
```

实现与证据（分支 `task/DATA-02`，基线 75bce95）：

- `advanceTraining` 自然到期收窄为两种可证明覆盖：推进日已达 plannedEnd（区间为空）或剩余日期逐日全为周六/周日；移除"全市场尾/他股尾推断停牌"。等待 409 按情形给出原因：个股尾日早于计划结束（其间可能为节假日、停牌或数据缺口），或结束日后有记录但区间内无日线（无法区分长期停牌与数据缺口），均附"更新后继续或提前结算"。
- 失败回归先于实现观察 RED：他股更新但目标停在尾日（旧实现自动结算，期望等待）、结束日后有记录但区间有缺口（旧实现按尾日覆盖结算，期望等待）。
- 定向测试 `npm test -- server/test/train-engine.test.ts`：20/20 通过（含停牌复牌静默跳过、周末桥到期、已结算不动、防未来等既有用例）；`npm test -- server/test/train-account.test.ts server/test/api.test.ts server/test/full-acceptance.test.ts server/test/rights-cost-basis.test.ts server/test/chart-cost-basis.test.ts` 33/33 通过；`npm run build:server` 通过。仅合成临时日线与 SQLite 夹具，未触真实 TDX 目录与个人库。

剩余不确定性：本地无节假日历，法定节假日与停牌、数据缺口在尾段不可区分，一律保守等待（由周末桥与提前结算兜底）；本任务未证明全市场目录覆盖，目录级覆盖证明仍归 DATA-04。

当前任务不实现 M4 排行和成绩单，也不写用户 7529 数据库或通达信目录。
