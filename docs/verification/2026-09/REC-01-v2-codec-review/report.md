# v2编解码首轮审查与并行批次

2026-09-19。被审对象task/REC-CODEC提交2f773c9；结论需修正，未合入REC-01。原17项测试、web类型检查通过，不等于完整合同通过。

## 审查结果

只读探针确认：恢复时内容表没有重建指纹索引，相同meta/account/context/trade会再次保存；恢复父链深度按0计算，已存30层再推进两次可到32层；未知截止变已知时的空增量分支也可把31层推到32；指纹桶额外保留完整canonical JSON。最后一项违反内存去重目标。A→B→A的旧版本复用也待补齐。

正向证据：额外150检查点逆序还原深等，Reader两个缓存各保持8；冻结真实600519+gbbq跨四除权日与周/月观察，4组语料合计3844检查点逐个及倒序抽样完全一致。数据量见[result.json](result.json)。这不覆盖恢复续录缺陷，也不是正式UI验收。

真实数据命令为`node node_modules/tsx/dist/cli.mjs scripts/assess-recording-compression.ts <冻结day> <同批gbbq> <结果JSON> <compactCodec.ts>`，退出0。为避免与正在修复的worker竞争读取，将2f773c9的codec从Git导出至全局缓存后重跑，正式证据使用固定提交版本；运行日志rec-codec-2f773c9-realdata.log、原详细数据保存在Headroom缓存。导入模块是开发者明确传入的评估代码，不属于用户录制文件可执行内容。

## 用户授权后的并行调度

此前单提供方锁改为worktree锁、batch锁及有界slot锁。15项Python回归通过，包含两个真实进程同时持有不同槽位、同目录写入拒绝、超槽位拒绝、扩容至3、旧锁保留与禁止并行共用wake-state。每个任务结果写独立job，heartbeat按group索引收取，不以一个完成覆盖另一个。

先启动codec修复和validator，两者启动核验分别已有9与8次completed模型请求、无error_code；随后加入第三个增量存储任务。各自最高思考档、独立worktree/log/provider副本和文件范围，Git由主代理串行集成。实际本批后续限流/结果仍需按完成证据判断，不能用启动成功推断整批已通过。

完整任务拆分和合并顺序见[调度协议](../../../engineering/recording-v2-dispatch.md)。schema和codec修复由owner协调，validator不得就地修改codec来通过本分支测试。自动停录任务保持撤回。
