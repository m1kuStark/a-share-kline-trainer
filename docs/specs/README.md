# 产品规格

| 主题 | 何时读 |
|---|---|
| [公式指标](formulas.md) | 公式启停与权限、公共 EMA 暖机、M9 验收边界 |
| [训练与账户](training/rules.md) | 创建、推进、交易、权息、结算 |
| [结算历史与成绩单](training/history.md) | 历史列表、只读事实成绩单与防未来守卫；已交付 |
| [五档排行与成绩单入口](training/rankings.md) | 排行分组、冻结指标口径与成绩单入口；K 线复盘展示暂缓 |
| [图表与工具](chart/interaction.md) | 显示、周期、手势、画线与保存 |
| [行情与更新](market-data/requirements.md) | 来源、覆盖、历史修订和更新入口 |
| [后续范围](roadmap.md) | M4/M5/R2与V2 |
| [操作录制](recording.md) | 默认开启、开关、状态提示、导出分享与回放；已交付并验收 |
| [v0.4 设计提案](../proposals/v0.4-training-clock-orders-notes.md) | 开盘/收盘训练时钟与价格型条件单已在 v1.2.7 部分交付；成交理由和完整回放兼容仍待实现 |

规则定义应有行为；实现缺口见[任务](../work-items/README.md)。既有M0/M1/M2验收见[基线阶段](../work-items/milestones/BASE.md)。

公式启停的当前验证缺口见[公式规格](formulas.md)与[M9-ENABLE-01证据](../verification/2026-11/M9-ENABLE-01/README.md)：保存与EMA专项已有收据，完整候选失败仍待复跑，不能据专项宣告整个公式系统验收通过。


## 当前接续（2026-11-18）

PR54公共EMA修复已合入main58ba0ff，启停6/6及种子/存储/API专项13/13通过。f701371完整Journey为229通过、18失败、1跳过、13未运行，整批仍active，待新冻结后完整复跑。夹具RED/GREEN后8项及另4项通过仅属定向；PS1仅补BOM，待真实Windows包验证。同候选实包、录像回放和用户整批验收未完成，不发布。当前收据见[M9验证记录](../verification/2026-11/M9-ENABLE-01/README.md)；此前失败正文保留其历史结论。
