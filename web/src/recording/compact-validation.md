# v2 紧凑校验（compactValidation）与 v1 迁移预算

实现 [REC-01 v2紧凑存储合同](../../../docs/engineering/recording-v2-contract.md) 的「校验、文件封装」节中的纯校验部分。本单元只做结构/预算/引用校验并原样返回有效数据：不构造展开的 v1 会话、不重算业务、不执行输入中的任何代码或 URL。gzip/`.trainer-session.json.gz` 文件封装、v1 JSON 识别转换、IndexedDB 存储、CompactRecorder 接线均为后续独立任务。旧 [v1 校验](./validation.ts) 默认行为不变（58 个既有测试保持通过）。

## 接口

- `validateCompactRecording(unknown): CompactRecordingFile`：失败抛中文可行动错误（`录制文件校验失败：…`，复用 v1 `fail` 文案），通过则返回输入对象本身（不重排、不克隆、不修改输入）。
- `validateRecording(value, options?: { maxCheckpoints?: number })`：v1 校验新增可选迁移预算，仅供旧大文件迁移（v2 任务建议传 20000）。缺省保持旧 2000；**该参数只能由调用方传入，绝不从导入文件内容读取**。`parseRecording`/`exportRecording` 仍固定 25MiB/2000，新预算由后续文件模块处理。

## 校验范围

- JSON 安全：全树有限数值、无 undefined/函数/非纯对象、嵌套 ≤ 40 层（复用 v1 `assertJson`）。
- 顶层：`format='trainer-session'`、`schemaVersion=2`、sessionId/createdAt/app/environment/trainingKey/complete。
- 事件：≤ 50000，seq 连续、动作白名单、source/phase/outcome、elapsedMs 全局单调、started/finished 配对（复用 v1 `assertEvent`/`assertEventPairing`）；事件 `checkpointId` 引用存在且不指向未来快照。
- 轻量 checkpoint：≤ 20000，id 唯一、afterSeq ∈ 0..事件数且非递减、segmentId 可证实（afterSeq=0 允许独立）、capturedAt、ui 四字段；`training.metaRef/accountRef/tradeRefs`、`chart.seriesRef/drawingsRef`、`contextRef` 引用必须存在于对应资源表。
- gaps：与 v1 同语义（afterSeq 严格递增、范围合法、未闭合 gap 必须在末尾且禁 complete）。
- 资源表（trainingMeta/accounts/trades/contexts）：id 非空且表内唯一，value 复用 v1 旧语义（训练元数据/账户/成交逐字段、context 自由 JsonValue——纯 JSON 无外部执行/读路径，无额外白名单）。
- series 版本：id 唯一、timeframe 枚举、asOf 为日期或 null、`firstCheckpoint` 必须是检查点数组下标；base 必须存在且**下标更早**（两遍扫描：先收全 id 再判引用，因此前向引用与循环引用均被拒绝）、同周期、链深 ≤ 31 层；base 已知 asOf 不得晚于派生 asOf；bar 有效日期（1M 月键归月初）与有限值，还原后日期必须严格递增（新键尾插、按日期键覆写与 remove 语义与 codec `applyDelta` 一致）；asOf 非空的版本还原后不得包含晚于 asOf 的 bar（周/月键归一期初后同样不得越过）。
- drawings 版本：id 唯一、base 存在且更早、链深 ≤ 31；items/upsert ≤ 500 且逐条走 v1 `assertDrawing`（drawTools 注册白名单，engine 内置 bsMark/costLine 排除；窗格白名单；点 ≤ 256 且有限）；remove 键非空且不重复。还原顺序无语义（Reader 按 id 规范序重放），不做排序约束。
- asOf 与检查点截止：检查点截止按 codec `deriveAsOf` 同一规则从引用的训练元数据推导（currentDate 优先，非盲无 currentDate 用 startDate，盲态隐藏当前日或 training=null 为未知）。**已知截止的检查点不得引用 asOf=null 或 asOf 晚于截止的版本**；未知截止的检查点不施加 asOf 约束（版本自身的 firstCheckpoint 方向限制已防未来回填）。检查点引用的版本 `firstCheckpoint ≤ 该检查点下标`，防晚版本回填早步骤。

## 性能预算（合同初值）

| 预算 | 值 |
| --- | --- |
| 检查点 | 20000（事件沿用 v1 50000） |
| 单个行情版本 bar 数组（base.bars / upsert） | 20000 |
| 全资源 Bar 条目（base.bars + 全部 upsert） | 1,000,000 |
| 校验期唯一版本累计还原遍历 | 5,000,000 |
| 画线 items/upsert | 500（点 256 沿旧） |
| 增量链深 | 31 层 |
| 嵌套深度 | 40 层（沿旧） |

设计：**每个行情版本只还原一次**。按数组顺序增量解析（base 必然更早），已解析状态仅在仍被后续版本引用时保留（引用计数释放，峰值 = 单条链路径）；每次还原按状态长度计入 5,000,000 条预算，越界立即拒绝。之后 checkpoint 阶段只查摘要（asOf/firstCheckpoint）与引用存在性，O(1) 每检查点——10000 个视窗检查点共用同一 series 不会重复收取还原预算。数组长度先于遍历检查。

## 本轮不做

gzip 封装与 magic 识别、v1 JSON 文件识别转换（迁移时先 `validateRecording(v, {maxCheckpoints: 20000})` → `compactRecording` → 本校验）、解压流式计数、IndexedDB 增量存储、CompactRecorder/useRecording 接线、25MiB/128MiB/256MiB 字节预算（属文件模块）。
