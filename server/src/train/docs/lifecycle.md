# 训练生命周期与可见行情

现行产品口径见 [训练规则](../../../../docs/specs/training/rules.md)。本页映射 [engine.ts](../engine.ts) 的实际调用，不承诺尚未实现的数据版本或规则快照。

## 命令与状态

新建时校验训练周期、初始资金、代码、日期与复权方式，只允许一个 running 训练。先刷新权息及股票目录，再读该股日线；起始日落到所选日期之前最近的交易日，plannedEnd 按 1/3/6/12/24 个月计算并钳制月末。默认资金 100 万、forward 复权；创建当前收盘价与初始权益记录。

V1 页面不启用盲测；引擎仍接受 blind 并保留遮蔽逻辑供存量兼容。不能据此把真盲测列为当前 V1 已开放功能。

| 命令 | 前置状态 | 当前效果 |
|---|---|---|
| `advanceTraining` | running | 取 currentDate 后、plannedEnd 内第一条日线；处理权息后写推进日、原始收盘和权益点 |
| `tradeTraining` | running | 以缓存的当前收盘计算并记录成交，更新当天权益点 |
| `settleTraining` | running | 在当前日标 settled、early_settle=1；不自动平仓 |
| `abandonTraining` | running | 标 abandoned 并保留历史记录 |

训练结束后推进和交易返回 409。查询已结束训练不重开记录，更新行情也不延长原 plannedEnd。当前多条业务 SQL 并未统一包在命令事务中；文档不把一次命令描述为已具备完整原子提交。

## 数据尾与结算缺口

找不到下一根时，自然结算只认两种可证明的完整覆盖：推进日已到 plannedEnd（待覆盖区间为空），或剩余日期逐日核对全部为周六/周日（A 股周末从无日线）。其余情况返回 409“等待日线数据”，保持 running：个股日线止于尾日但区间含工作日时，等待原因列出尾日与计划结束，并注明其间可能为节假日、停牌或数据缺口；结束日之后有记录但区间内无日线时，明确无法区分长期停牌与区间数据缺口。用户可更新数据后继续推进，或提前结算。

全市场尾与他股更新不参与判定。停牌复牌发生在区间内部时，推进按下一根落在复牌日静默跳过停牌日，不算缺失也不等待。上述覆盖证明由 [DATA-02](../../../../docs/work-items/tasks/DATA-02.md) 引入；旧“全市场尾推断停牌”行为已移除，train-engine 回归覆盖他股更新但目标漏数、结束日后有记录但区间有缺口、停牌复牌与周末桥样例。

## 查询与防未来

`buildTrainingSeries` 当前读取整份本地日线，再按推进日截断 → 仅纳入推进日及以前权息的前复权 → 日/周/月聚合。截断顺序同样适用于形成中的周月 K 线。这里保证的是返回的可见行情无未来价格，不代表底层没有读取完整文件。

`trainingBars` 首次返回最多 1040 根，含 840 根可见上限与 200 根均线暖机余量。`trainingBarsBefore` 返回严格早于 before 的最近 count 根及 hasMore；840 限制同屏显示，不限制全部历史载入量。API 默认历史批量 300、允许 1～1000。

`trainingSnapshot` 从流水重建账户；bars 响应另经 `buildChartSpace` 补图表成交价与成本。running 时 [api.ts](../../api.ts) 关闭 `/api/kline/:code`，避免前端旁路取得普通行情。

读查询仍可能刷新权息，且日线直接读 TDX 文件；历史修订隔离见 [DATA-03](../../../../docs/work-items/tasks/DATA-03.md)，统一读取合约见 [DATA-04](../../../../docs/work-items/tasks/DATA-04.md)，刷新副作用见 [数据发布](../../data/docs/publication.md)。

## 验证入口

[train-engine.test.ts](../../../test/train-engine.test.ts) 覆盖日期、状态、推进、分批加载与防未来；[full-acceptance.test.ts](../../../test/full-acceptance.test.ts) 覆盖接口旁路限制。账户对账继续读 [accounting](./accounting.md)，整体交付按 [验证协议](../../../../docs/engineering/testing.md)。
