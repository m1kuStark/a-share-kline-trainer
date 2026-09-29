# 日线来源合约

[source.ts](../source.ts) 定义当前接口，面向刷新扫描；训练行情尚未通过它读取。产品要求见 [数据要求](../../../../docs/specs/market-data/requirements.md)。

## 接口与选择

`DailySource` 暴露 `kind`（tdx/online）、中文 `name`、廉价 `available()` 和 `scan(previous?)`。`available` 不应全量扫描；`scan` 遇文件级失败须抛出带文件位置的中文原因，不返回部分结果。

`ScanOutcome` 返回本次全部文件状态、股票数量、全市场最大日期及 added/removed/revised/baseline。单个文件状态为 path、size、mtimeMs、maxDate、rows；DATA-03 起全量读取的文件还携带整文件 SHA-256（`sha256`），以及相对上一版本前 `rows` 条记录的前缀哈希（`prefixSha256`/`prefixRows`，瞬态证据，不入主库）。它仍不包含日线序列、权息事件、交易日历或个股区间完整性证明；内容版本保护见下节。

[selection.ts](../selection.ts) 优先选可用 TDX，其次按注册顺序选择可用在线源；均不可用时为 none。`registerOnlineSource` 按名称注册，同名覆盖；返回的注销函数只移除其注册实例。当前没有真实在线源。

## 本地扫描实际做什么

[tdxSource.ts](../tdxSource.ts) 先检查 `vipdoc` 可访问，再扫描 sh/sz/bj 市场的 A 股 `.day` 文件。市场目录整体不存在时跳过；市场目录存在但 lday 不可读时失败。这里的判断与 [catalog.ts](../../tdx/catalog.ts) 根据旧缓存区分缺席/故障的处理并不完全相同。

对每个文件，上一版本已有内容指纹且 size+mtime 未变才复用上次元数据（含沿用指纹）；基线尚无指纹时全量读取一次以建立指纹（迁移时基线只贵一次）。全量读取为单次快照：校验长度为 32 字节倍数，一次读入全部字节同时取末条日期、计算整文件 SHA-256 与相对上一版本的前缀哈希，并比较读取前后的 size/mtime；失败重试一次，仍失败则整次扫描报错。读取期间的快照一致性仍不能证明文件此后不被改写——改写检测依赖下一次扫描的指纹比对。

增量比较规则：新路径计 added；已有文件 maxDate 前移也计 added；尾日期未前移而 size/mtime 变化计 revised；旧路径消失计 removed。空基线视为首扫，三类计数为零。DATA-03 修漏报：两侧都有内容指纹时，maxDate 前移的文件按前缀哈希重分类——前缀逐字节等于上一版本整文件哈希计 added（纯追加），对不上计 revised（追加同时改写历史）；任一侧无指纹保持元数据口径，不虚构结论。

## 历史版本保护（DATA-03）

[history/](../history/) 为独立于主库的侧车 SQLite（`history.sqlite`，模块自有 schema，不改 [db.ts](../../db.ts) 兼容迁移），生产位置派生自 `TRAINER_DB` 同目录 `history-versions/`；主库为 `:memory:` 时禁用版本记录，测试可注入实例。打开或记账失败使刷新任务明确失败，不静默放弃版本记录。

职责分三层：

- 市场版本 lineage：刷新协调器在主库整批提交成功后调用 `recordMarketVersion` 记录一个市场版本（id 与 `cache_meta` 批次标识一致；保护库建立后第一个版本即迁移基线）。逐文件按内容证据分类 baseline/added/appended/rewritten/removed/unverified，未变文件只计数不落行；单写者＝刷新协调器，其余入口全部只读。
- 文件指纹层：每路径最近一次记录的 `{rows, sha256}`，下一次扫描叠加进基线做内容校验；已移除路径的指纹保留（present=0），供文件再现时校验改写。
- 保留版存储：按需保留个股 `.day` 原始字节与权息事件（`retainStockVersion`），保留时点固定，之后现势文件如何被改写都不影响这份副本。

对读取方（训练、结算、复盘）的只读契约：`readRetainedStock` 返回可读取的旧版行情；没有保留版时返回 `unavailable` 并给出中文原因，调用方必须明确阻断，不得以现势数据顶替（那是改写语义）。`verifyRetainedStock` 只读比对现势文件与保留版指纹，漂移即报 drifted，不换数据。市场版本 lineage 读取（`listMarketVersions`/`getMarketVersion`）同样只读。本层不负责按版本恢复训练读取——统一行情读取入口归 [DATA-04](../../../../docs/work-items/tasks/DATA-04.md)。

实现测试入口为 [data-refresh.test.ts](../../../test/data-refresh.test.ts) 与 [history-protection.test.ts](../../../test/history-protection.test.ts)；格式边界见 [TDX 格式](../../tdx/docs/formats.md)。

## 接入来源时必须面对的边界

`DailySource` 注册成功只意味着刷新协调器能扫描。当前 [api.ts](../../api.ts) 和 [train/engine.ts](../../train/engine.ts) 仍依赖 `tdxRoot`、`.day` 路径及 TDX 权息缓存。在线来源尚不能独立支撑训练；统一读取合约见 [DATA-04](../../../../docs/work-items/tasks/DATA-04.md)，历史修订与版本保护见 [DATA-03](../../../../docs/work-items/tasks/DATA-03.md)（已实施，见上节）。

扫描元数据不能替代个股区间完整性，结算守卫见 [DATA-02](../../../../docs/work-items/tasks/DATA-02.md)。提交成功也不能替代整批版本发布，事务说明见 [publication](./publication.md)。

实现测试入口为 [data-refresh.test.ts](../../../test/data-refresh.test.ts)；格式边界见 [TDX 格式](../../tdx/docs/formats.md)。
