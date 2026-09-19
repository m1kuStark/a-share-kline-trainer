# REC-V2-RECORDER：紧凑状态机

GLM5.3Flash最高档。独立工作树D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-RECORDER-V2，基线7edbed9，依赖已准备。读根/web/serverAGENTS、docs/engineering/recording-v2-contract.md和recording-v2-storage-contract.md、旧recorder.ts、已通过compactCodec/compactValidation/compactStorage公开API。只新增compactRecorder.ts、compact-recorder.md、server/test/recording-compact-recorder.test.ts。不改types/codec/validator/storage/旧recorder/页面/包/全局任务，不Git，不其他worktree/TDX/个人库/浏览器/子agent。主代理统一接线，另两个Agent做gzip和回放页。

导出class CompactRecorder(storage:CompactRecordingStorage,options:RecorderOptions)，保持旧start(trainingKey,CheckpointInput,enabled=true)/begin(action,params?,source?)/finish(opId,outcome,result?,checkpoint?)/capture/pause/resume/flush/export/restore/getStatus/getFile接口；getFile/export返回CompactRecordingFile。输入还是完整CheckpointInput方便接现图表，内部必须即时CompactBuilder.capture并只存轻量cp/resources，不保留全历史完整图表。当前页未接你的类不必改它。

复用旧真实语义：默认开/初始关gap0；暂停闭合悬空op为interrupted、gap显式，恢复新segment+完整观察cp、elapsed单调；restore校验v2、补悬空started、沿旧segment，builder(resources,cpCount)续firstCheckpoint。restore只处理v2，v1迁移由接线层完成。onChange异常不能破坏录制，真实读写错误状态可重试；不允许自动停录、不加容量停止逻辑。

存储串行save、微任务批量调度。每次持久化快照仅复制数组边界和可变header(gaps/app/environment)，资源/event/cp条目从创建后不再改（finish时带checkpointId先完成再append，别修改已持久event）。存储save等待过程中新的记录不得污染前一批snapshot，失败dirty重试保留数据。禁止每次structuredClone全文件，getFile显式返回完整深拷贝仅供导出/检查，常规UI状态别用getFile。export先flush，再validateCompactRecording快照，file完全可被后续gzip读取。

同afterSeq且CheckpointInput内容完全相同的冗余capture可忽略；先判重再调用builder，不能导致firstCheckpoint跳号。不同seq相同内容仍保留cp时序，别覆盖已被event引用的cp。可以仅保留最近输入签名/还原最近cp做去重，不保存所有完整输入；捕获失败不留半初始化无法重试状态。新的file/key/id隔离，重复start/finish与paused行为跟旧一致。

先RED后GREEN有效测试：沿旧16核心行为移植并验证CompactReader逐步还原相等；begin/finish/暂停恢复/存储失败重试、restore elapsed与segment/builder链续、悬空op、相同capture去重资源不增、慢保存后追加不污染前批、输入proxy由caller DTO转换（此层只纯DTO）、500次推进检查文件不内嵌全量chart重复并逐cp正确。使用MemoryCompactStorage或小controlled storage port，不新依赖。npm test -- server/test/recording-compact-recorder.test.ts --maxWorkers=2；typecheck:web。短报结果并停止。
