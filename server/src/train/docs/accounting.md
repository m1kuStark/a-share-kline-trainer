# 账户、权息与图表成本

产品口径见 [训练规则](../../../../docs/specs/training/rules.md)。纯计算在 [account.ts](../account.ts)，持久化、重放和图表换算在 [engine.ts](../engine.ts)。

## 交易计算

账户由 cash、shares、costTotal 组成；权益为现金加持仓按当前收盘计算的市值，持仓成本价为 costTotal/shares，清仓返回 null。

买入比例按总权益计算目标金额，向下取整到 100 股，再按可用现金和费用逐手缩减。卖出可按股数或可卖持仓比例计算；显式卖出全部可卖整数股时允许零股。T+1 开启时，可卖股数是持仓减去当天买入股数。交易价格取训练记录的 current_close，不读取下一根价格。

买入增加取得成本及费用；卖出按卖出股数占原持仓比例减少成本，现金增加成交额减费用。现金分红不冲减取得成本。

当前费用默认关闭；开启后佣金万分之 2.5、最低 5 元，卖出另收万分之 5 印花税。费用总额保存于成交记录 fee，重放沿用实际记录。`feeConfigOf/t1Enabled` 每次读取全局 settings，尚未冻结为训练创建时的规则；缺口见 [TRAIN-01](../../../../docs/work-items/tasks/TRAIN-01.md)。

## 权息入账与重放

推进到权息事件当天，`applyPositionEvents` 按事件前持股计算现金分红与送转股。配股在现金加当次分红足够时自动足额认购，不足则放弃；没有部分缴款。实际配股缴款进入取得成本，并记录 `position_events.cost_delta`，无缴款的新事件明确记 0。

账户重放按日期升序合并成交与 position_events，同日先权息后成交，同类按 seq。`account.ts` 的 `replayAccount` 只重放成交，不能独立重建含权息的训练账户。

旧 position_events 的 cost_delta 为 NULL 时，只有权息因子、实际新增股数和净现金同时匹配才恢复缴款成本；不改写旧行。已有明确数值的事件以流水为准，不随权息缓存刷新重新猜测。

当前 `advanceTraining` 仅在 adjust_mode=forward 时调用权息入账，raw 路径存在权益缺口；显示复权方式不应改变真实现金和持股要求，统一跟踪于 [TRAIN-01](../../../../docs/work-items/tasks/TRAIN-01.md)。目前只处理推进到的日线日期上的事件，也不能把实现描述成完整交易所权息清算系统。

## 成交标记与当前成本

历史成交的 price 始终保存原始成交价。forward 图表按推进日有效权息段，将历史成交换算成 chartPrice，供 B/S 标记使用。

当前成本来自含权息的账户重放；前复权当前基准日价格等于原始价，所以当前成本不再复权。禁止把历史买价先复权，再按原成交股数重放成本，这会漏掉送转及配股增加的股数。raw 或无有效权息时，chartCostPrice 返回 null，由前端回退账户成本。

买卖、推进返回账户快照后，前端必须立即同步成本；清仓不能等下一次行情请求成功才移除成本线。图表行为见 [交互规格](../../../../docs/specs/chart/interaction.md)。

## 验证入口

[train-account.test.ts](../../../test/train-account.test.ts) 检查整手、现金、费用和比例；[train-engine.test.ts](../../../test/train-engine.test.ts) 检查 T+1 与推进入账；[rights-cost-basis.test.ts](../../../test/rights-cost-basis.test.ts) 检查配股、旧 NULL 和流水顺序；[chart-cost-basis.test.ts](../../../test/chart-cost-basis.test.ts) 检查成本显示来源。通过这些用例不表示 TRAIN-01 已关闭。
