# REC-V2-STORAGE 精确审查修正

GLM5.3Flash最高档。工作树REC-STORAGE-V2，基线de3f4e2。只改compactStorage.ts、compact-storage.md、对应storage测试及必要stub。不改types/codec/validator/页面/包/Git/其他工作树/个人库/TDX。

19tests+typecheck通过，根真实Edge IndexedDB隔离测试已证明基本save/load/追加/等长不同事件冲突正常。确定bug：batchIdOf未包括app/environment/createdAt；verifyAdoptRows只比新增行，没有header比较。两个实例同revision load后，A只把app.version改left保存，B只改right保存，B竟no-op成功，磁盘仍left。需要batch身份包括全部被保存的header内容（排除系统revision/batchId），采纳时除哈希预筛还必须对header逐字段深等，空批次也不能绕过。环境/createdAt类似覆盖测试。不要只加入hash字段而不比较header，碰撞预筛不作唯一证据。

另外两项存储边界请用失败测试核实并修：
- assemble按rows排序后push，没按header.counts核对连续index/kind/session，缺失一行或header与行数不一致可能静默返回部分录制。load检测每kind连续0..count-1、合法kind/id、准确长度，损坏明确拒绝，不把依赖validator当丢行检测。不要为查询getAll行添加全录制深拷贝。
- Memory实现persisted保留外部header.gaps等引用，save完成后file.gaps[0].resumedAtSeq原地更新但尚未save会改变磁盘镜像。生产IDB put本来clone，新CompactRecorder也会替换/快照header；Memory应至少clone可变header(app/environment/gaps)保证保存瞬间语义。事件/resources按不可变条目合同可共享，别全历史deepclone。

保持增量写/原子事务/游标仅complete更新/旧sessions保留/失败重试。根浏览器probe可读C:/Users/Stark_Du666/.codex/headroom-cache/verify-compact-idb.cjs，禁止你跑浏览器；修后根重验。先失败测试再修，npm test -- server/test/recording-compact-storage.test.ts --maxWorkers=2，typecheck，短报结果停止。
