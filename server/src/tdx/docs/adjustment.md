# 权息缓存与前复权

本模块负责价格变换；真实现金、持股与取得成本入账由 [训练账户](../../train/docs/accounting.md) 负责。两条链不能互相替代。

## gbbq 解码与事件

[gbbq.ts](../gbbq.ts) 将文件头 4 字节读为记录数，严格校验总长度为 `4 + 29 × 记录数`。每条记录前 24 字节分三块解密，其余字节按原位复制；只接收 category=1 的有效市场、六位代码、日期及有限数值事件。

事件保存 dividend、rightsPrice、bonusShares、rightsShares。分红、送转及配股数量按每 10 股口径换算，计算：

```text
m = (10 + bonusShares + rightsShares) / 10
c = (dividend - rightsPrice × rightsShares) / 10
一次除权对历史价的变换：P' = (P - c) / m
```

`buildForwardAdjustmentSegments` 按事件日期从近到远合成 `a × P + b` 区段。事件当日属于已经除权后的区段，早于事件日的价格才应用该事件。

## 基准与成交量

`applyForwardAdjustment` 只纳入 `event.date <= baseDate` 的事件，变换 OHLC，成交量与成交额保持输入数值。调用方必须给出正确基准：普通行情用源文件末日，训练用当前推进日，不能把未来权息提前加入训练。

训练的处理顺序是先截断日线、再复权、后聚合；末个推进日价格因此与原始价格一致。历史 B/S 另用相同区段换算 chartPrice，当前持仓成本直接来自含权息的账户。具体合同见 [accounting](../../train/docs/accounting.md)。

## 缓存范围

[adjustment-cache.ts](../adjustment-cache.ts) 以 gbbq 的 size 与 mtime ISO 字符串组成指纹；相同则复用 adj_factors。变化时读取并解析文件，以 market+code+date 比较事件，删除消失项、更新变化项，再与指纹一起在独立事务提交。

该指纹没有内容哈希，读取前后也没有完整的稳定性对照；它不是可恢复的历史版本。权息缓存事务不包含股票目录或文件快照，且训练/普通行情查询仍可独立刷新缓存。整批发布与统一入口见 [DATA-01](../../../../docs/work-items/tasks/DATA-01.md)、[DATA-04](../../../../docs/work-items/tasks/DATA-04.md)，读侧版本隔离见 [DATA-03](../../../../docs/work-items/tasks/DATA-03.md)。

raw 图表不做价格复权，但账户仍应反映真实权息；当前 raw 推进漏入账是 [TRAIN-01](../../../../docs/work-items/tasks/TRAIN-01.md) 的已知缺口。

验证入口：[gbbq.test.ts](../../../test/gbbq.test.ts)、[adjustment-cache.test.ts](../../../test/adjustment-cache.test.ts)、[chart-cost-basis.test.ts](../../../test/chart-cost-basis.test.ts)；真实数据对照见 [scripts](../../../../scripts/README.md)。
