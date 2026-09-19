# 操作录制

按需读取：[产品规则](../../../docs/specs/recording.md) → [接口合同](../../../docs/engineering/recording-contract.md) → 本次涉及模块。

| 模块 | 职责 |
|---|---|
| [types](types.ts) / [validation](validation.ts) | 共享语义类型与v1兼容校验；旧[recorder](recorder.ts)/[storage](storage.ts)保留兼容测试 |
| [compactRecorder](compactRecorder.ts) | 现行seq、segment、暂停缺口、检查点去重及增量保存；[实现说明](compact-recorder.md) |
| [useRecording](useRecording.ts) | Vue页面接线、DTO复制、同场恢复和导出 |
| [replay](replay.ts) | 检查点选择、真实暂停时间缺口和播放时距；[回放页](../views/recording-replay.md) |
| [chartCapture](chartCapture.ts) / [drawingOperations](drawingOperations.ts) | 图表与画线语义捕获，实际价格/日期与手势结果 |
| [compactTypes](compactTypes.ts) / [compactCodec](compactCodec.ts) | 已验收的v2纯编解码、行情/图形版本和轻量引用；[实现](compact-codec.md)，尚未替换页面v1接线 |
| [compactValidation](compactValidation.ts) | v2引用/历史截止/还原集合预算；[校验说明](compact-validation.md) |
| [compactStorage](compactStorage.ts) | v2增量事务、revision冲突和旧sessions保留；[存储说明](compact-storage.md) |
| [recordingFile](recordingFile.ts) | JSON/gzip读写、旧版迁移、流式解压取消；[文件说明](recording-file.md) |
| [recordingRepository](recordingRepository.ts) / [recordingLease](recordingLease.ts) | 浏览器旧记录迁移和跨标签单写者管理 |

图表只捕获实际已加载且训练可见的数据。训练推进后的账户结果与图表加载是两个独立操作；交易成功后图表加载失败不能改写成交结论。加载期间的账户检查点允许chart=null，不能给新账户配旧周期或旧复权基准的行情。

初始化完成前锁住业务和绘图入口；初始化失败显示原因与重试。持久化失败不冒充成功。导出等待已记录数据保存，导入由独立回放页消费，不调用交易API。

同标签页sessionStorage保留本场sessionId，IndexedDB保存录制正文。JSON分享不带浏览器存储标识之外的本地路径，不自动上传。录制只含语义状态，未记录的区间始终显示缺口。

页面已接v2紧凑记录，正式验收状态与证据见REC-01任务。默认gzip导出，更多菜单可读JSON；App用shallowRef承载已校验文件，回放按需还原单检查点、每窗最多100条事件。旧sessions按需转换成功后另存v2，原条目不删；数据错误和revision冲突都显式提示。
