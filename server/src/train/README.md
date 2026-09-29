# 训练引擎与账户

`engine.ts` 直接编排数据库、TDX 行情、权息及账户计算；`account.ts` 提供不访问数据库的账户运算。命令、查询尚未拆成独立服务。

| 任务 | 先读 | 实现入口 |
|---|---|---|
| 新建、推进、结算、放弃训练 | [生命周期](./docs/lifecycle.md) | `createTraining/advanceTraining/settleTraining/abandonTraining`，位于 [engine.ts](./engine.ts) |
| 查询快照或分批行情 | [生命周期](./docs/lifecycle.md) | `trainingSnapshot/trainingBars/trainingBarsBefore/buildChartSpace` |
| 查询结算历史或只读成绩单 | [历史成绩单](./docs/history-report.md) | `historyList/historyReport`，位于 [history-report.ts](./history-report.ts) |
| 调整股数、费用、现金或成本 | [账户与成本](./docs/accounting.md) | [account.ts](./account.ts)、engine 中账户重放与权息入账 |
| 修改规则或判定完成范围 | [训练规格](../../../docs/specs/training/rules.md) | 规则冻结及 raw 权息缺口见 [TRAIN-01](../../../docs/work-items/tasks/TRAIN-01.md) |
| 调查数据尾或刷新后异常 | [数据发布](../data/docs/publication.md) | [TDX](../tdx/README.md)、[DATA-02](../../../docs/work-items/tasks/DATA-02.md) |

HTTP 参数、响应和错误映射在 [api.ts](../api.ts)，表结构与迁移在 [db.ts](../db.ts)。相关回归分布在 train-account、train-engine、rights-cost-basis、chart-cost-basis 和 full-acceptance 测试；执行要求见 [验证协议](../../../docs/engineering/testing.md)。
