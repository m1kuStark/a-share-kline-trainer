# v2 紧凑录制状态机（compactRecorder）

实现 [REC-01 v2紧凑存储合同](../../../docs/engineering/recording-v2-contract.md)「录制与持久化迁移」与[持久化端口](../../../docs/engineering/recording-v2-storage-contract.md)中的 `CompactRecorder`。对外接口与语义沿旧 `recorder.ts`（start/begin/finish/capture/pause/resume/flush/export/restore/getStatus/getFile，错误文案一致），构造为 `new CompactRecorder(storage: CompactRecordingStorage, options: RecorderOptions)`；`getFile`/`export` 返回 `CompactRecordingFile`。输入仍是完整 `CheckpointInput`（方便接现有图表），内部即时 `CompactBuilder.capture`，只保留轻量检查点与追加资源，不保留全历史完整图表。v1 会话迁移属接线层，`restore` 只处理 v2；无自动停录、无容量停止逻辑。

## 检查点与输入隔离

- 输入先经 `toSafeInput` 深拷贝为纯 DTO（caller 的响应式代理/可变对象在此转换隔离），再交给 builder；循环/非 JSON 输入在改动任何状态前显式失败，不留半初始化不可重试状态。
- `capture` 先判重再调用 builder：仅保留「最近一次 checkpoint」的输入签名（afterSeq + 规范化内容串，不持久化、不保存全部输入）。同 afterSeq 且内容完全相同的冗余 capture 整体忽略（检查点与资源全表不增，builder 的 firstCheckpoint 不跳号）；不同 afterSeq 相同内容正常追加保留时序，行情/画线版本由 builder 复用不重复存储。判重签名在任何 checkpoint 追加路径（start/finish/pause/resume）统一刷新，不会误吞真实变化。
- `finish` 带 checkpoint 时：检查点先于事件完成（afterSeq=本条 finished 事件 seq），事件带 `checkpointId` 一次性成形再追加；已持久事件/检查点从不回填修改。

## 快照与持久化

- 存储串行（saveChain）+ 微任务批量调度（dirty/saveQueued），与旧 recorder 相同；保存失败置 dirty 重试并保留全部内存数据，flush/export 抛中文可行动错误。
- 每批快照只复制数组边界（events/checkpoints 与六张资源表 `slice()`，条目按创建后不可变契约与存储共享引用）和可变 header（`gaps`/`app`/`environment` 结构化克隆）。慢保存期间的追加进入后续批次，不污染前批快照；resume 就地闭合 gap 不改写已持久镜像。禁止全文件 structuredClone。
- `getFile` 显式返回完整深拷贝（快照整体 structuredClone），仅供导出/检查；常规 UI 状态走 `getStatus`。`export` 先 flush，再对快照跑 `validateCompactRecording`，产物可直接交给 gzip 封装/导入。

## restore

`storage.load` → `validateCompactRecording`（只接受 v2，损坏/越权引用显式拒绝并进入 error 状态）→ `new CompactBuilder(loaded.resources, loaded.checkpoints.length)` 续接链（后续 capture 的去重/复用/链深/firstCheckpoint 与连续会话一致）→ 修补悬空 started 为 `interrupted`（不伪造 result）→ 沿旧 segment 续录 → elapsed 以最大 elapsedMs 为 offset（anchorWall 只减一次）→ 按未闭合 gap 恢复 paused 态 → scheduleSave + flush。

## 测试

`server/test/recording-compact-recorder.test.ts`：旧 16 核心行为移植（begin/finish 配对与深拷贝、默认开/初始关 gap0、capture 不可变、暂停恢复、严格串行 [0,2]、失败上报与恢复不丢数据、export 深拷贝与持久相等、restore 悬空修补/paused 保留/elapsed anchor/segment 沿用/损坏拒绝）+ CompactReader 逐步还原相等 + builder 链续（restore 后同内容复用版本、新内容增量 firstCheckpoint 正确）+ 同 afterSeq 冗余 capture 去重资源不增 + 慢保存后追加不污染前批快照 + onChange 异常隔离 + 500 次推进（总 bar 条目 < 逐 cp 平铺的 1/10，逐 checkpoint 还原正确，通过 v2 校验）。controlled 存储端口在测试内实现（串行 + onSave 观察/延迟 + failWith + records 注入）。运行：`npm test -- server/test/recording-compact-recorder.test.ts --maxWorkers=2`。

## 本轮不做

页面接线（useRecording/App/SessionReplay）、v1→v2 迁移接线、gzip 文件封装、IndexedDB 真机多标签验证。输入 proxy→DTO 的响应式解包由 caller 完成，本层只处理纯 DTO。
