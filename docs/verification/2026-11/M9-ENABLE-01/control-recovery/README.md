# 控制台账测试记录恢复

2026-11-18，完整测试继承了真实 `TRAINER_CONTROL_ROOT`，工作流夹具因此投影到共享控制台账。此问题涉及工程控制元数据；本次恢复没有读取或写入个人训练数据库、行情目录或浏览器录像存储。

只读比对发现 revision233 相比干净备份新增33个测试候选和75条测试事件；11个真实候选、16条原事件逐项不变，另有5个真实任务的后续更新必须保留。完整原始比较见 [报告](control-integrity-report.md) 与 [清理计划](control-cleanup-plan.json)。原报告是执行前的只读结论，实际执行事实以本页和收据为准。

主代理经 `updateWorkflowState` 持锁写入：先验证完整状态与每条待清理记录的SHA256，再仅移除计划中的精确ID；恢复有备份及当前真实候选记录双重佐证的REL-V1候选指针，保留所有真实任务、runs、artifacts、acceptance、reconcile与next_action。API自动将revision233递增到234，并新增一条恢复事件。原始前后状态均以raw.b64留存，可解码核验。

执行命令：`node --import tsx <cache>/control-integrity-20261118/recover-control.mjs`，原生退出码0；[执行收据](recovery.receipt.json)记录计划/前后状态SHA256及全部保留字段。恢复后再通过正式工作流CLI接续M9，不整文件回滚旧备份。

后续单测显式移除真实控制目录环境；完整候选使用仓库内临时只读状态快照，并在结束时核对快照与真实状态的哈希，避免测试夹具再次写入共享台账。此隔离属于本轮运行准备，不声称已经修改仓库工作流产品逻辑。
