# v2 紧凑编解码（compactTypes / compactCodec）

实现 [REC-01 v2紧凑存储合同](../../../docs/engineering/recording-v2-contract.md) 的「数据结构」与「纯codec接口」两节。本单元只做纯编解码：校验（compactValidation）、文件封装（gzip/JSON v1转换）、增量IndexedDB存储、CompactRecorder接线均为后续独立任务，此处不做。旧 types/recorder/storage/validation 与页面未改动。

## 文件

- `compactTypes.ts`：纯类型。`CompactRecordingFile`、`CompactResources`、`CompactCheckpoint`、`SeriesVersion`（base全量/upsert+remove增量）、`DrawingVersion`。复用 `types.ts` 的事件、gap、`ChartCaptureView`、`RecordingCheckpointUi`、`JsonValue` 与 api/drawingState 的值类型。
- `compactCodec.ts`：`CompactBuilder`（capture/getResources）、`compactRecording(v1)`、`CompactReader(checkpointAt)`。

## Builder 语义

- `new CompactBuilder(resources?, checkpointCount=0)`：构造即深拷贝传入资源并重建指纹索引/id计数器/链头；恢复后从 `checkpointCount` 续计 `firstCheckpoint`，并按追加序滚动重建内容索引与链深计数（series每周期、drawings各一份），保证恢复后去重、复用与链深判断和连续会话一致。`capture` 复制全部输入后持有，不修改调用者对象；`getResources()` 返回内部只读视图（调用方不得修改，供后续增量存储按数组尾部读取）。
- 内容去重表（trainingMeta/accounts/trades/contexts）：FNV-1a 32位指纹 + 长度仅作内存索引，桶只存资源id引用（不长期保存规范化串，恢复重建同样如此）；命中后临时规范化该条目并比较（对象键排序、数组保序）避免碰撞。短id前缀 `m/a/t/x/s/dw` + 递增序号，恢复时扫描既有id续号。成交按完整内容寻址：同seq不同 `chartPrice` 自然形成两个版本，不按seq覆盖。
- series/drawings 历史内容复用：先用本版本内容的指纹查桶（新→旧探测），候选版本做asOf/firstCheckpoint许可校验（已知截止不得引用null或更晚asOf；复用不产生新版本故firstCheckpoint天然满足），再临时展开候选内容（Builder内有界LRU，与Reader同算法，上限8）规范化比对防碰撞，完全相同才复用既有版本id。索引只存指纹与版本id，不保存全部展开历史或巨型字符串；恢复时按追加序逐版本规范化一次重建（series每周期滚动展开、drawings单链滚动展开，不保留中间展开态）。A→B→A回到历史内容时复用旧版本而不追加。
- series 按周期各持一条线性链；无历史复用命中时与链头展开态做日期键diff：
  - 内容完全相同：null截止直接复用；已知截止在 `head.asOf <= checkpoint.asOf` 时复用（保留更早已知asOf）；链头asOf不可引用时先查历史复用，仍无则未知→已知生成空增量新版本标注已知截止（不降格共享，同样受31层限制，超限改存新基础）；`head.asOf > checkpoint.asOf` 时另起新链存全量（已知截止不得引用更晚asOf）。
  - 内容变化：按「变化大于全量」比较**序列化字节**——增量字节（upsert规范化串+remove键）与新全量规范化总字节比较，字节更小、链增量 < 31层、且基础asOf不晚于派生asOf时存增量，否则存新全量基础。纯删除（remove键远小于全量）因此可走增量。同日期键不同OHLC（复权回改、周/月当前柱更新）按 upsert 处理。
  - 顺序保真：增量重构造（原位替换+尾部追加）的键序必须与输入完全一致，否则回退全量，保证 Reader 逐字节还原。
- drawings 单链，按 id upsert/remove。先做历史内容复用（同上，无asOf约束），再与链头diff。数组重构造定义为**按 id 码点规范序**（v1 `serializeDrawings` 即按 id 排序），输入本身无序时回退全量；工具、窗格、点、styles、extendData 原值保留。变化大于全量同样按序列化字节比较（实测例：删除一条画线增量仅存remove键 `"dw-a"` 6字节，全量含另一条长text画线约400字节，故走增量）。
- asOf 推导：currentDate 非空取 currentDate；非盲无 currentDate 取 startDate；training=null 或盲态隐藏当前日为 null。
- 画线链头状态恢复会话后惰性重建（base 原样、delta 规范序重放），避免恢复即全量。

## Reader 语义

- `checkpointAt(index)` 只展开目标检查点引用的版本；越界、引用缺失、基础链循环均抛中文可行动错误（含资源id/有效范围）。基础链迭代回放+visited集合，无递归；链展开算法（`expandVersionChain`）与Builder历史复用的临时展开共用同一实现。
- 内部各保留最多 8 个行情/画线还原版本（命中刷新的LRU）；返回深拷贝，调用者修改输出不影响缓存与历史。
- 从最近缓存的祖先版本开始重放增量，跨周期来回切换共享同一缓存池。

## 本轮不做

结构校验、引用/环/预算检查（compactValidation）、gzip与`.trainer-session.json.gz`封装、v1 JSON文件识别转换、IndexedDB增量存储、CompactRecorder与useRecording接线。输入由调用者校验，codec不重复旧validator限制。
