# REC v2录制与持久化端口

与[v2数据/文件合同](recording-v2-contract.md)共同使用。此页供Recorder和Storage独立任务按需读取，共享接口由集成人维护。

## 录制与持久化迁移

后续新增`CompactRecorder`并接入useRecording，保持start/begin/finish/capture/pause/resume/flush/restore/getStatus语义。内部只保留紧凑检查点和资源，不保留所有完整chart；同afterSeq且内容相同的冗余capture可跳过（不要删除事件或修改已引用checkpoint）。导出/getFile是紧凑格式。暂停恢复、保存失败及悬空操作继续按原规则，不增加自动停录。

`CompactRecordingStorage`支持save/load/list，同类实现`IndexedDbCompactStorage`与测试内存存储。生产IndexedDB版本升级保留旧sessions；新header及分表records按sessionId+kind+index为键。一次save只put新追加events/checkpoints/resources和header（gaps/complete/counts），同一事务提交。不得每次写全历史数组。序列保存、防丢重试、升级blocked/close/versionchange遵循已修好的生命周期。旧v1会话按需转换后另存v2，迁移失败保留原记录。

并行实现端口固定在`compactStorage.ts`导出`CompactRecordingStorage`（save(file:CompactRecordingFile):Promise<void>/load(id):Promise<CompactRecordingFile|null>/list():Promise<RecordingSummary[]>）、`MemoryCompactStorage`、`IndexedDbCompactStorage`。load只返回v2；IndexedDbCompactStorage另提供loadLegacy(id):Promise<RecordingFile|null>读取旧sessions原值，迁移校验/转换由后续统一接线完成。list合并旧/新摘要，同sessionId优先v2，旧正文不删除。此单元不引尚未合入的compactValidation，不修改共享compactTypes。输入save应由调用方语义校验，存储仅检查追加前缀身份、revision与事务完整性。

调用方save快照可以浅复制不可变条目及数组，不能反复深克隆所有累计资源。header持久revision，storage实例load时保存expectedRevision；save事务读取并比对revision，匹配才写新增内容并增加revision，事务complete后才更新本地游标。重复调用save应幂等，相同长度也必须核对追加条目/最后提交批次身份；不匹配拒绝并保留内存数据，不能以相同counts掩盖双标签分叉。刷新或复制标签造成同session并发由接线层创建独立session或明确冲突提示。

