# REC-V2-VALIDATION：与codec修复并行的独立任务

你是GLM5.3Flash开发Agent，最高思考档。独立工作树D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-VALIDATE-V2，基础2f773c9，npmci已准备。读根/web/serverAGENTS，docs/engineering/recording-v2-contract.md与compactTypes.ts。另一Agent修codec实现但类型/API冻结；你不改codec或types。只改web/src/recording/compactValidation.ts、validation.ts（迁移预算选项，旧默认不变）、compact-validation.md、server/test/recording-compact-validation.test.ts。不改UI/包/存储/全局文档，不Git操作，不其他worktree/个人DB/TDX，不浏览器或子agent。

实现validateCompactRecording(unknown):CompactRecordingFile。严格按合同结构/预算验证，返回原形有效数据，不做业务重算、不修改输入。validateRecording旧函数可增加可选trusted options:{maxCheckpoints?:number}供v1迁移（20000），旧调用仍2000；当前parse/export25MiB保持不变，后续文件模块处理新预算。此参数不能从导入文件里读取。

明确任务边界：不实现gzip/blob/存储/页面，只做校验。
核心：JSON安全(有限数、深度、纯对象、无undefined/functions)、版本/动作/phase/outcome/seq/opId配对、segment/gap语义及checkpoint引用。series/drawings ID唯一、base先出现、无环、同timeframe、31层；bar有效日期与严格排序、upsert按date覆盖/remove后顺序必须合法、有限值；asOf与firstCheckpoint防晚版本回填早步骤（周/月键相同也不能绕过）；未知asOf不能被已知截止checkpoint引用，base已知asOf不得晚于derived。
资源value校验复用旧语义(训练/账户/trade/context/工具白名单、engine mark排除)，每个checkpoint引用存在。上下文自由JSON但无外部执行/读路径/HTTP。

性能预算按唯一series还原一次并缓存校验摘要，checkpoint只查摘要/asOf/引用；10000视窗checkpoint共用同series仍应通过，不能按重复引用计500万bars。资源存储量100万bars、每series20000bars、总还原500万、events50000、cp20000、draw500/points256，嵌套40，其他约束沿旧；早验数组长度再遍历。不要展开完整v1会话再交旧validator，避免内存重新爆炸。可共享/导出旧纯校验helper但保持旧行为及58tests。

先失败测试：正常builder产物/v1迁移budget、resource缺失/前向base/环/32链、firstCheckpoint未来、月K晚asOf、语义错误、NaN/深嵌套、10000共享series通过。codec恢复缺陷已由另一任务修，你在本分支可手构有效fixture，不自行修codec，也不写“接受无效codec”测试。Node中不引新依赖，测试maxWorkers=2。

npm test -- server/test/recording-compact-validation.test.ts server/test/recording-validation.test.ts --maxWorkers=2；npm run typecheck:web。完成返回短结果/接口风险后停止。
