REC-RECORDER 审查修正，仅recorder.ts/storage.ts/recording-core.test.ts。不要做其他任务，不提交。
1 restore elapsed计算有bug：anchorWall=now，elapsedOffset=maxElapsed-anchorWall，然后currentElapsed=Date.now()+elapsedOffset-anchorWall，等于重复减now导致长期冻结。改为单一baseMonotonicClock+offset；增加mock time推进后严格增加100ms的测试，不只>=。
2 加真实roundtrip验收：start enabled=true→begin/finish→pause/resume→export→validateRecording必须通过；enabled=false start的gap.afterSeq=0是合法“从开始未录”，validator另一Agent会允许0；恢复时先校验storage载入文件，拒绝损坏/未知schema，不可只as赋值。
3 restore创建新segment但没有任何事件/检查点说明断点，capture会产生validator不认识的segmentId。恢复recording状态时追加session.interrupted成对元事件并完整状态检查点（可用最近checkpoint深拷贝，明确中断），或保持原segment直到真实resume，需设计一致并测试validate roundtrip。paused restore不能悄悄开启。
4 实际Vue传入reactive对象structuredClone可能DataCloneError，核心可要求调用方先转纯JSON但必须在文档写明；finite/undefined在写入前显式拒绝，不要JSON序列化静默改null。
5 storage.close之后dbPromise仍指向已关闭db，open失败promise永久缓存、blocked后晚成功连接泄漏。修复close复位/失败复位/blocked晚成功close。list按createdAt降序。内存storage保持简单。
先失败测试再修，跑core+validation tests及typecheck。不要降低规范，不删行为测试。完成立即结束。
