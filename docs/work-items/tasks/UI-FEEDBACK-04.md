# UI-FEEDBACK-04 v1.2.3 后续界面反馈

```json
{
  "id": "UI-FEEDBACK-04",
  "title": "统一阶段价位线、更新反馈与排行层级",
  "owner": "integrator",
  "state": "review",
  "milestone": "V4",
  "summary": "用户确认已完成 v1.2.3 集成发布与验收；本轮处理价位线重复标价、训练页更新状态与反馈、排行层级三个新问题。",
  "next_action": "V1.2.4 包已构建后交用户验收；保留全量测试的11项存量失败边界。",
  "base_commit": "5dd01e8ffaf5e5564e95eb79dd0d05b2970af312",
  "allowed_paths": ["package.json", "package-lock.json", "CHANGELOG.md", "README.md", "web/**", "server/test/**", "e2e/**", "docs/specs/**", "docs/verification/**", "docs/work-items/**", "docs/status.md"],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/specs/chart/display.md", "docs/specs/market-data/requirements.md", "docs/specs/training/rankings.md", "web/README.md", "web/src/views/README.md", "web/src/components/docs/library-adapter.md", "e2e/README.md", "docs/work-items/tasks/UI-FEEDBACK-04.md"],
    "reason": "同步阶段线显示、官方交易日历判断和更新结果反馈、训练周期排行子列表的用户可见规则与回归证据。"
  },
  "verification_refs": ["docs/verification/2026-10/UI-FEEDBACK-04/report.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

实施位置：`trainer-wt/int-v1`，分支 `wt/integration/v1`；主仓库仍为旧版本，本轮不修改该树。

根因：阶段 overlay 在主图内绘制价格，收盘又叠加库内置最新价线；训练页更新按钮仍依赖节假日可能误报的 `needsUpdate`，忽略 `unchanged` 结果并漏显更新错误；自定义区间被误放在顶层排行导航。

用户对 v1.2.3 已发布并验收的确认来自 2026-10-02 本聊天，公开发布资产尚未独立查询。新修订的工程验证和用户验收分别记录。
