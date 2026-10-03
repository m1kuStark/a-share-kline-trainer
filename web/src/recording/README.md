# 操作录制

按需读取：[产品规则](../../../docs/specs/recording.md) → [接口合同](../../../docs/engineering/recording-contract.md) → 本次涉及模块。

| 模块 | 职责 |
|---|---|
| [types](types.ts) / [validation](validation.ts) | 共享语义类型与v1兼容校验；旧[recorder](recorder.ts)/[storage](storage.ts)保留兼容测试 |
| [compactRecorder](compactRecorder.ts) | 现行seq、segment、暂停缺口、检查点去重及增量保存；[实现说明](compact-recorder.md) |
| [useRecording](useRecording.ts) | Vue页面接线、DTO复制、同场恢复和导出 |
| [replay](replay.ts) | 检查点选择、真实暂停时间缺口和播放时距；[回放页](../views/recording-replay.md) |
| [chartCapture](chartCapture.ts) / [drawingOperations](drawingOperations.ts) | 图表与画线语义捕获，实际价格/日期与手势结果 |
| [compactTypes](compactTypes.ts) / [compactCodec](compactCodec.ts) | 现行页面使用v2紧凑记录，保留v1导入兼容；行情/图形版本和轻量引用见[实现](compact-codec.md) |
| [compactValidation](compactValidation.ts) | v2引用/历史截止/还原集合预算；[校验说明](compact-validation.md) |
| [compactStorage](compactStorage.ts) | v2增量事务、revision冲突和旧sessions保留；[存储说明](compact-storage.md) |
| [recordingFile](recordingFile.ts) | JSON/gzip读写、旧版迁移、流式解压取消；[文件说明](recording-file.md) |
| [recordingRepository](recordingRepository.ts) / [recordingLease](recordingLease.ts) | 按安装实例命名空间选择本机库，合并本机/导入索引，提供导入、回放、单条删除和按来源清理；跨标签单写者管理 |
| [importedStorage](importedStorage.ts) / [libraryTypes](libraryTypes.ts) | 独立导入库与来源摘要；新导入 ID、原会话 ID、文件名与导入时间 |

`configureRecordingNamespace()` 必须在 `/api/env` 返回 `recordingNamespace` 后调用。服务端将标识保存在当前训练数据库的 `cache_meta` 中，前端据此派生 IndexedDB 数据库名，空值会拒绝访问。默认便携包的独立 `data` 相互隔离，显式共用同一数据库时沿用同一标识。导入录像保存到同一实例的独立 `${databaseName}.imports` 库，导入时生成新的 `imported-*` `sessionId`，原文件 ID 仅写入 `originalSessionId`。

`listRecordingLibrary()` 返回带 `source: 'local' | 'imported'` 的摘要。`loadLibraryRecording()` 按来源读取并重新校验；`removeLibraryRecordings()` 和 `clearRecordingSource()` 支持单条或按来源清理。删除本机录像会检查当前训练和 `recordingLease`，活动或被其他标签页写入的录像返回失败原因并保留原数据。当前命名空间内的旧 v1 录像仍由 `loadLocalRecording()` 按需迁移，迁移成功前保留旧条目；未隔离的公共库不自动迁入新实例，也不删除。

图表只捕获实际已加载且训练可见的数据。训练推进后的账户结果与图表加载是两个独立操作；交易成功后图表加载失败不能改写成交结论。加载期间的账户检查点允许chart=null，不能给新账户配旧周期或旧复权基准的行情。

初始化完成前锁住业务和绘图入口；初始化失败显示原因与重试。持久化失败不冒充成功。导出等待已记录数据保存，导入由独立回放页消费，不调用交易API。

同标签页按安装命名空间隔离的 `sessionStorage` 保留本场 sessionId，IndexedDB 保存录制正文。JSON 分享不带浏览器存储标识之外的本地路径，不自动上传。录制只含语义状态，未记录的区间始终显示缺口。

页面已接v2紧凑记录，正式验收状态与证据见REC-01任务。页面默认gzip导出，底层文件API支持可读JSON；App用shallowRef承载已校验文件，回放按需还原单检查点、每窗最多100条事件。旧sessions按需转换成功后另存v2，原条目不删；数据错误和revision冲突都显式提示。
