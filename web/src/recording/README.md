# 操作录制

按需读取：[产品规则](../../../docs/specs/recording.md) → [接口合同](../../../docs/engineering/recording-contract.md) → 本次涉及模块。

| 模块 | 职责 |
|---|---|
| [types](types.ts) | JSON语义事件、检查点和存储接口 |
| [validation](validation.ts) | 导入校验、大小/版本/时间/引用边界 |
| [recorder](recorder.ts) | seq、segment、暂停缺口、串行保存；[实现说明](../../../docs/engineering/recording-core.md) |
| [storage](storage.ts) | 浏览器IndexedDB与单测内存存储 |
| [useRecording](useRecording.ts) | Vue页面接线、DTO复制、同场恢复和导出 |
| [replay](replay.ts) | 检查点选择、真实暂停时间缺口和播放时距；[回放页](../views/recording-replay.md) |
| [chartCapture](chartCapture.ts) / [drawingOperations](drawingOperations.ts) | 图表与画线语义捕获，实际价格/日期与手势结果 |

图表只捕获实际已加载且训练可见的数据。训练推进后的账户结果与图表加载是两个独立操作；交易成功后图表加载失败不能改写成交结论。加载期间的账户检查点允许chart=null，不能给新账户配旧周期或旧复权基准的行情。

初始化完成前锁住业务和绘图入口；初始化失败显示原因与重试。持久化失败不冒充成功。导出等待已记录数据保存，导入由独立回放页消费，不调用交易API。

同标签页sessionStorage保留本场sessionId，IndexedDB保存录制正文。JSON分享不带浏览器存储标识之外的本地路径，不自动上传。录制只含语义状态，未记录的区间始终显示缺口。

v1完整快照现用于兼容基线。用户已确认v2紧凑实现，新增模块依[v2合同](../../../docs/engineering/recording-v2-contract.md)推进；迁移完成之前不要把评估中的压缩率描述为产品已支持。
