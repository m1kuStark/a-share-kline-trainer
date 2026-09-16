# TDX 目录与行情格式

本页描述解析与目录缓存。权息格式见 [adjustment](./adjustment.md)，刷新过程见 [数据发布](../../data/docs/publication.md)。

## 路径和代码

[discover.ts](../discover.ts) 要求至少一个 `vipdoc/{sh,sz,bj}/lday` 含 .day 文件，且 `T0002/hq_cache` 存在。[config.ts](../../config.ts) 优先用 `TDX_ROOT`，否则查默认候选目录；发现安装目录不等于 gbbq 文件可读或数据完整。

日线为 `vipdoc/<market>/lday/<market><code>.day`；权息为 `T0002/hq_cache/gbbq`。`symbol.ts` 接受显式市场前缀或六位代码；裸 6 开头归 sh，4/8/92 开头归 bj，其余归 sz。0003 开头的基准指数必须显式指定市场，避免与股票混淆。A 股目录筛选由 `stocks.ts` 的 `isAShareCode` 决定，代码解析本身不证明标的是 A 股。

## .day 二进制记录

[dayfile.ts](../dayfile.ts) 按小端读取，每条 32 字节；空文件返回空序列，非整条长度报错。

| 字节偏移 | 类型 | 含义 |
|---|---|---|
| 0 | int32 | YYYYMMDD；解析校验真实日期及 1990～2100 范围 |
| 4/8/12/16 | int32 | 开/高/低/收，除以 100 得价格 |
| 20 | float32 | 成交额 amount |
| 24 | int32 | 成交量 volume；当前保留文件数值 |
| 28 | 4 字节 | 当前忽略 |

`readDayFileRange` 先读整文件并解析，再按日期二分切片，from/to 均包含边界；它不是按字节范围只读取所选日期。二分查找依赖源记录日期有序，当前解析不校验排序、重复日期、OHLC 关系或区间完整性。`readLastDayDate` 只读末条记录日期，不能证明中间无漏数。

## 名称与目录缓存

名称读取在 [names.ts](../names.ts)，目录缓存由 [catalog.ts](../catalog.ts) 写 stocks。目录扫描失败会重试一次；ENOENT 且该市场没有旧缓存时记 absentMarkets，其余目录故障记 failures 并保留该市场缓存。文件级失败丢弃该市场本次待写集合；成功市场可更新。

成功扫描的市场变更与删除集中在 catalog 自己的事务中提交。既有调用方有的只使用 stocks 而忽略 failures，因此返回旧股票集合不代表刷新完整成功。整批一致性缺口见 [DATA-01](../../../../docs/work-items/tasks/DATA-01.md)。

## 聚合

[kline.ts](../kline.ts) 支持 1D/1W/1M。周键为周一日期，月键为 YYYY-MM；开盘取首根、收盘取末根、高低取极值、量额求和。聚合只处理输入记录，不补停牌或缺失交易日。

训练先截断再复权再聚合，形成中周/月线只包含推进日之前的已知日线；周键不等于该周最后数据日期。显示与查询口径见 [训练生命周期](../../train/docs/lifecycle.md)。

验证入口：[dayfile.test.ts](../../../test/dayfile.test.ts)、[discover.test.ts](../../../test/discover.test.ts)、[symbol.test.ts](../../../test/symbol.test.ts)、[names.test.ts](../../../test/names.test.ts)、[catalog-protection.test.ts](../../../test/catalog-protection.test.ts)、[kline.test.ts](../../../test/kline.test.ts)。
