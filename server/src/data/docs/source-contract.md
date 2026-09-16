# 日线来源合约

[source.ts](../source.ts) 定义当前接口，面向刷新扫描；训练行情尚未通过它读取。产品要求见 [数据要求](../../../../docs/specs/market-data/requirements.md)。

## 接口与选择

`DailySource` 暴露 `kind`（tdx/online）、中文 `name`、廉价 `available()` 和 `scan(previous?)`。`available` 不应全量扫描；`scan` 遇文件级失败须抛出带文件位置的中文原因，不返回部分结果。

`ScanOutcome` 返回本次全部文件状态、股票数量、全市场最大日期及 added/removed/revised/baseline。单个文件状态为 path、size、mtimeMs、maxDate、rows。它不包含日线序列、权息事件、交易日历、个股区间完整性证明或可恢复的内容版本。

[selection.ts](../selection.ts) 优先选可用 TDX，其次按注册顺序选择可用在线源；均不可用时为 none。`registerOnlineSource` 按名称注册，同名覆盖；返回的注销函数只移除其注册实例。当前没有真实在线源。

## 本地扫描实际做什么

[tdxSource.ts](../tdxSource.ts) 先检查 `vipdoc` 可访问，再扫描 sh/sz/bj 市场的 A 股 `.day` 文件。市场目录整体不存在时跳过；市场目录存在但 lday 不可读时失败。这里的判断与 [catalog.ts](../../tdx/catalog.ts) 根据旧缓存区分缺席/故障的处理并不完全相同。

对每个文件，size+mtime 与基线相同就复用上次元数据。变化时校验长度为 32 字节倍数，读末条日期，并比较读取前后的 size/mtime；失败重试一次，仍失败则整次扫描报错。这只验证读取期间的文件状态和尾记录，不能证明中间记录无缺失或内容未被同尺寸改写。

增量比较规则：新路径计 added；已有文件 maxDate 前移也计 added；尾日期未前移而 size/mtime 变化计 revised；旧路径消失计 removed。空基线视为首扫，三类计数为零。正常追加同时修改历史记录的情况，当前比较不能可靠区分。

## 接入来源时必须面对的边界

`DailySource` 注册成功只意味着刷新协调器能扫描。当前 [api.ts](../../api.ts) 和 [train/engine.ts](../../train/engine.ts) 仍依赖 `tdxRoot`、`.day` 路径及 TDX 权息缓存。在线来源尚不能独立支撑训练；统一读取合约见 [DATA-04](../../../../docs/work-items/tasks/DATA-04.md)，历史修订与版本保护见 [DATA-03](../../../../docs/work-items/tasks/DATA-03.md)。

扫描元数据不能替代个股区间完整性，结算守卫见 [DATA-02](../../../../docs/work-items/tasks/DATA-02.md)。提交成功也不能替代整批版本发布，事务说明见 [publication](./publication.md)。

实现测试入口为 [data-refresh.test.ts](../../../test/data-refresh.test.ts)；格式边界见 [TDX 格式](../../tdx/docs/formats.md)。
