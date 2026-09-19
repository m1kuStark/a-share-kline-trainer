# REC-01 v2紧凑存储合同

2026-09-19用户已确认紧凑方案并授权实施。此合同供分块开发；完成状态以REC-01任务/证据为准。保留[既有v1合同](recording-contract.md)用于导入兼容，v1导出不是新实现目标。禁止自动停录。

## 数据结构

新增`web/src/recording/compactTypes.ts`，复用types.ts中的事件、gap、app/environment、ChartCapture、RecordingCheckpoint输入；不更改旧类型和旧模块以免迁移中破坏接口。

`CompactRecordingFile = Omit<RecordingFile,'schemaVersion'|'checkpoints'> & {schemaVersion:2; checkpoints:CompactCheckpoint[]; resources:CompactResources}`。

`CompactResources`包含以下只追加数组，所有id为非空字符串、各表内唯一：

- `series: SeriesVersion[]`：`{id,timeframe,asOf:string|null,firstCheckpoint:number,base:null,bars:Bar[]}`或`{id,timeframe,asOf:string|null,firstCheckpoint:number,base:string,upsert:Bar[],remove:string[]}`。同周期基础引用必须较早，最长31层增量；第32版本或变化大于全量时存新基础。asOf为观察截止日，不含之后行情。
- `drawings: DrawingVersion[]`：`{id,base:null,items:Drawing[]}`或`{id,base:string,upsert:Drawing[],remove:string[]}`。相同对象内容复用，创建/更改/删除按ID变化，最多31层增量。工具、窗格、点、样式及文字原样保留。
- `trainingMeta: Array<{id,value:TrainingMeta}>`、`accounts: Array<{id,value:AccountView}>`、`trades: Array<{id,value:TradeView}>`、`contexts: Array<{id,value:JsonValue}>`。按完整内容去重，成交只新增观察到的版本，不能按seq覆盖旧值；context的观察时间也是实际值，不能擅自删字段。

`CompactCheckpoint`保留id/afterSeq/segmentId/capturedAt/ui；`training:null|{metaRef,accountRef,tradeRefs:string[]}`；`chart:null|{timeframe,seriesRef,drawingsRef,view,costPrice}`；`contextRef:string|null`。资源引用必须存在，checkpoint afterSeq顺序不变，事件checkpointId必须匹配其seq，不将未来数据引用回填早期步骤。

行情截止：训练currentDate非空时取currentDate；非盲训练尚无currentDate时取startDate；training=null或盲训练隐藏当前日时asOf=null并保留未知，不从月/周键猜截止。已知截止的检查点不得引用asOf=null或更晚asOf；基础已知asOf不得晚于派生asOf。每个行情版本firstCheckpoint为首次出现的检查点数组下标，引用检查点的下标必须≥它，基础的首次下标不得晚于派生；这也保护未知截止时不引用未来步骤的版本。复用完全相同内容可保留更早已知asOf；从未知截止切到已知时生成带已知截止的新版本，不能降格共享。

内容指纹仅用于内存查找，命中后比较规范化内容避免碰撞；不要把巨大的JSON键永久重复保存。资源跨时间共用完全相同内容，但每个检查点仍独立记录时间位置。asOf变化可共享更早且内容相同的数据；绝不共用内容已变化的旧价格。按需还原时返回深拷贝，不把可变缓存交给图表。

## 纯codec接口

`compactCodec.ts`提供：

- `new CompactBuilder(resources?:CompactResources, checkpointCount=0)`：继续已有紧凑资源。恢复时传入已保存checkpoint数，维护firstCheckpoint；输入视作自有不可变版本/复制后持有，不能修改调用者对象。
- `capture(checkpoint:RecordingCheckpoint):CompactCheckpoint`：完整输入变轻量引用，向resources追加必要版本；`getResources():CompactResources`提供只读视图（调用方不得修改）；`reset`不必新增。
- `compactRecording(file:RecordingFile):CompactRecordingFile`：v1兼容迁移，保留全部事件/检查点/缺口。不调用旧25MiB序列化入口；当前v1语义检查与预算耦合，后续validator任务提供迁移预算以支持至20000检查点，codec本轮假定输入已通过结构检查。旧大于2000检查点的存库数据不能套旧阈值直接拒绝。v1明文导入暂给256MiB迁移预算（覆盖已测171.92MiB旧语料），迁移前仍检查事件/嵌套/数组预算，不承诺处理无限大旧文件。
- `new CompactReader(file:CompactRecordingFile)`；`checkpointAt(index:number):RecordingCheckpoint`按需解码单个；内部最多缓存8个还原行情版本和8个画线版本。越界抛可行动错误，不能展开全会话完整图表。公开缓存诊断不是必要接口。

价格不四舍五入，不重跑交易/复权引擎。删除、撤销/重做由观察到的对象状态变化还原。月键YYYY-MM接受；检查时归一月初，仅用于比较。

## 校验、文件封装

`compactValidation.ts`提供`validateCompactRecording(unknown):CompactRecordingFile`。复用v1校验逻辑时只能逐检查点/资源做有界校验，不能构造全部展开v1文件。检查JSON安全、事件配对、gap与segment、资源ID与引用、无环且基础较早、链深、日期排序、有限数值、工具白名单、未来行情与异常引用，输入无效必须显式拒绝。

`recordingFile.ts`提供`readRecordingFile(blob:Blob):Promise<CompactRecordingFile>`、`writeRecordingFile(file:CompactRecordingFile,compressed=true):Promise<Blob>`；默认gzip(JSON v2)，扩展名`.trainer-session.json.gz`，可读JSON选项保留。按magic识别gzip，支持旧JSON v1并转换；未知schema拒绝。

校验资源预算初值：压缩输入25MiB、v2解压/JSON128MiB（v1迁移256MiB）、50000事件、20000轻量检查点、每个series最多20000 bars、全资源最多100万Bar条目、还原检查累计遍历最多500万Bar条目、单对象点256/图形500；引用链31层。遍历预算按唯一行情版本计费，每个版本只验证一次，后续checkpoint仅查引用/截止摘要；10000个视窗检查点引用同一series不能重复收取1040×10000预算。这些是导入资源保护而非录制时停机条件；正常两年场景（含交易/画线）若不够，按实测优化表示/校准预算。解压流计数越界立即取消，不先完整解压再检查。

## 录制与持久化迁移

CompactRecorder、CompactRecordingStorage及增量事务/CAS约束见[持久化端口](recording-v2-storage-contract.md)。并行开发的固定接口、v1保留与跨标签冲突处理以该页为准。

## 页面接线与验收顺序

1. codec和v1迁移逐检查点往返 → 校验/压缩 → recorder/增量storage → App/useRecording/SessionReplay一次统一迁移。
2. 回放按seq选轻量checkpoint，再reader单个还原；当前账户真实结果及gap保持。操作列表按窗口/分页呈现，不能一次渲染50000项。
3. API、图表captureState/operation及账户引擎不变；真实用户动作仍是唯一驱动入口。
4. 单测先失败后修复，冻结样本跨四除权日、周月当前柱、画线/撤销/暂停恢复；浏览器验证旧/新导入、gzip导出、刷新与失败重试、离线只读、深浅主题。
5. 实际两年录制跑完整推进，包含交易/拒单/画线与周期切换；量化文件大小、导出导入耗时、检查点还原与未来隔离。完整candidate unit/types/build/M2/Journey及主代理视觉通过后提交用户验收。
