# GLM开发任务 REC-CORE

你是GLM 5.3 Flash开发Agent。仅在当前worktree实现小任务，不问用户，不调用子Agent，不使用浏览器/外网，不读个人数据或凭据，不运行全量journey，不执行git commit/merge/push/reset。主代理负责后续反馈与集成。

先读AGENTS.md、web/AGENTS.md、docs/engineering/recording-contract.md；约定是接口合同。只允许修改：web/src/recording/**、server/test/recording-core.test.ts、docs/engineering/recording-core.md。不得改页面、package、全局状态或任务卡。

实现合同中的types.ts、validation.ts（parseRecording/validateRecording/exportRecording）、recorder.ts、storage.ts（IndexedDbRecordingStorage和MemoryRecordingStorage）。录制按trainingKey关联但不共享跨标签的序号。Recorder方法严格按合同，给CheckpointInput等类型导出；getStatus和getFile都深拷贝。错误onChange可见，flush或export失败不得静默返回成功；持久化串行，每次状态变更安排保存，关键异步方法await持久化。恢复悬空started追加interrupted，暂停关闭gap与新segment；初始enabled=false应建立记录并明确暂停，不能记录业务操作。

控制复杂度：单JSON内嵌checkpoint；首批25MiB/5万事件/2000检查点，拒绝非法版本、动作、重复ID、非有限数、断序、缺引用。模型中不存外部文件路径，不执行导入文本；不要仅强制as转换。通过JSON规范化复制时保留错误而非把NaN改成null。checkpoint bars按不可变快照，不跨推进日期覆盖旧值。

先写必要的失败行为测试，再实现。运行 npm test -- server/test/recording-core.test.ts，以及 npm run typecheck:web。不要求实IndexedDB在Node可运行，用注入存储验证业务和失败；生产IndexedDB使用事务完成事件而非request成功作为持久化确认。

完成后返回：修改文件、实际测试和退出码、接口说明、剩余风险。不要扩展任务，也不要维护其他文档。命令工具是Git Bash，路径使用正斜杠；Windows文本按UTF-8。不要运行git diff对比尚未追踪文件来判断没有修改；用git status。
