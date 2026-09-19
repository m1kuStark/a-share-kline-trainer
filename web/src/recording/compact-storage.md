# v2 增量持久化（compactTypes / compactStorage）

实现 [REC-01 v2紧凑存储合同](../../../docs/engineering/recording-v2-contract.md)「录制与持久化迁移」中的存储部分：`CompactRecordingStorage` 端口 + `MemoryCompactStorage`（测试/无持久化环境）+ `IndexedDbCompactStorage`（生产）。本单元不做校验（compactValidation）、文件封装（gzip）、v1→v2 迁移转换与 CompactRecorder 接线；`loadLegacy` 只原样返回旧 sessions 原始值，转换属后续接线。旧 types/recorder/storage/validation 与页面未改动；不导入 codec/validation。

## 库与 store 布局

- 沿用 `storage.ts` 的 `RECORDING_DB_NAME='trainer-recordings'`，版本升到 2（`RECORDING_DB_VERSION`）。升级保留旧 `sessions`（v1，keyPath `sessionId`）；全新库也建出该 store 以支持 `loadLegacy`/`list`。
- `compactSessions`（keyPath `sessionId`）：header，含会话元信息（sessionId/createdAt/app/environment/trainingKey）、`gaps`/`complete`、`counts`（events/checkpoints 与六张资源表长度）、`revision`、`batchId`（最后提交批次身份）。
- `compactRecords`（keyPath `[sessionId, kind, index]`）：不可变追加行，`kind ∈ event|checkpoint|series|drawings|trainingMeta|accounts|trades|contexts`，`value` 为对应表内原始条目。行按 kind+index 连续，`load` 按序重组为 `CompactRecordingFile`，不展开行情（还原留给 CompactReader）。

## save：增量 + 事务 + revision

- 实例内 save 经队列串行化；先对照本地已提交状态（`computeBatch`）算出新增事件/检查点/资源条目与 header 是否变化。已提交前缀**缩短或条目不一致均拒绝**（引用相同走快路径，重建数组时逐条内容深比，不能只比长度）；输入条目按调用者不可变契约处理，只做浅切片。
- 单事务（`compactSessions`+`compactRecords`，readwrite）内：读持久 header 决策 → 只 put 新增行 + header → complete 才 resolve。gaps/complete/元信息变化允许空记录批次仅写 header（如 resume 补 `resumedAtSeq`）。
- **批次身份（`batchId`）**：base revision + 新增行 + 被保存 header 全部内容（除系统字段 revision/batchId 外逐项纳入 sessionId/createdAt/app/environment/trainingKey/gaps/complete/counts）的键排序规范化 JSON + FNV-1a 指纹。仅作碰撞预筛，**不作唯一证据**。
- 持久 revision 比对：实例 `load` 时缓存 `expectedRevision`；
  - 未 load 的实例对已存在会话 save → 拒绝（禁止未确认直接覆盖）；
  - revision 匹配 → 写入并把 revision+1；空批次且 header 未变 → no-op（幂等，0 写入）；
  - revision 恰好 +1 且 `batchId` 吻合 → 读回该批记录行与持久 header 做**采纳核实**：header 除 revision/batchId 外逐字段深等（空记录批次同样不可绕过）+ 记录行逐条深比，全部一致才**采纳为已提交**（崩溃/双实例重试同一成功批次），0 写入；任一不符视为分叉冲突拒绝；
  - 其余 → 冲突拒绝（同 revision 等长不同内容、同 revision 仅 header 分叉如 app/environment/createdAt 各改各的，必拒），保留本实例内存数据，不自动抢锁或覆盖。
- 仅在事务 complete 后更新本地游标/已提交条目；abort/error 不推进状态，重试重新提交完整批次。

## load / list / loadLegacy

- `load`：单事务读 header + 该会话全部记录行（`IDBKeyRange.bound([id,''],[id,'\uffff'])`），组装返回并缓存为已提交状态；不存在返回 null。header.gaps 在本地状态中深拷贝，以感知调用者就地补 gap。
- **损坏检测（`assemble`，存储层自检，不依赖 validator）**：对每 kind 校验行下标连续 `0..counts-1`、条目身份合法（event 用 `opId`、其余表用 `id`，非空字符串）、行数与 `header.counts` 精确一致；缺行/多行/重复行/未知 kind/非法 id 均明确抛「持久记录损坏」拒绝加载，不静默返回部分录制。行 value 直接引用 `getAll` 结果（IDB 已结构化克隆），**不添加全录制深拷贝**。
- `list`：单事务读 compactSessions 与旧 sessions，合并 `RecordingSummary`，同 id **优先 v2**；从不删除旧库。v2 save 路径也不写 sessions。
- `loadLegacy(id)`：返回旧 sessions 原始 `RecordingFile`，不做语义校验或 codec 转换。

## 连接生命周期

与 v1 `IndexedDbRecordingStorage` 相同：open 失败不缓存 rejected promise，下次访问重试；close/versionchange 清缓存并关闭连接；onblocked 定案拒绝后迟到的 onsuccess 关闭失效连接。会话级已提交状态跨 close 保留，靠 revision 比对保证不覆盖外部推进。

## Memory 实现的保存瞬间语义

`MemoryCompactStorage` 持久化时对 header 可变部分（app/environment/gaps）做结构化克隆快照：save 完成后调用者就地更新（如 resume 补 `gaps[i].resumedAtSeq`）不改写已持久镜像，与生产 IDB put 的结构化克隆语义对齐；再次 save 才把就地变化作为 header 批次提交。事件/资源条目按调用者不可变契约共享引用，不做全历史深拷贝；`load` 返回 `structuredClone` 副本，模拟 IDB 读取边界。

## 测试

`server/test/recording-compact-storage.test.ts`：Memory 侧验证首次保存/深等、精确增量、幂等、前缀缩短与同长不同内容拒绝、失败注入后游标不推进、save 后就地改 gaps/app 不改持久镜像；IDB 侧用 `server/test/helpers/compact-idb.ts` 最小异步 stub（写入缓冲到 complete 才应用并计数，abort 丢弃）验证 put 增量证据、abort 无 partial、双实例 revision 冲突与相同批次采纳（含 header-only 批次）、未 load 拒覆盖、旧 v1 保留/摘要去重/loadLegacy、连接生命周期、header 三字段（app/environment/createdAt）分叉后写者拒绝、直接改写持久行模拟损坏（缺行/counts 不符/下标断档/多行/未知 kind/非法 id）时 load 明确拒绝。运行：`npm test -- server/test/recording-compact-storage.test.ts --maxWorkers=2`。

## 本轮不做

结构校验与引用/预算检查（compactValidation）、gzip 与 `.trainer-session.json.gz` 封装、v1 JSON 识别转换、v1→v2 迁移预算与迁移接线、CompactRecorder 与 useRecording 接线、浏览器多标签验证。存储层假定输入已通过结构与内容检查。
