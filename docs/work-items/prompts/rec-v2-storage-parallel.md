# REC-V2-STORAGE：独立增量持久化

GLM5.3Flash最高档开发。工作树D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-STORAGE-V2，基础2f773c9已含冻结compactTypes；npmci准备完成。读根/web/serverAGENTS及v2合同。另两个Agent分别修codec、写validator，你只做存储，不等待它们、不修改其文件。允许新建web/src/recording/compactStorage.ts、compact-storage.md、server/test/recording-compact-storage.test.ts；如需测试stub可放server/test/helpers/compact-idb.ts。不改package/旧storage/codec/types/validator/UI/任务卡，不Git操作，不个人DB/TDX，不子agent或浏览器。

固定端口：compactStorage.ts导出interface CompactRecordingStorage {save(file:CompactRecordingFile):Promise<void>;load(id:string):Promise<CompactRecordingFile|null>;list():Promise<RecordingSummary[]>}、MemoryCompactStorage、IndexedDbCompactStorage。额外IndexedDb类loadLegacy(id):Promise<RecordingFile|null>读取旧sessions原始值，迁移语义校验/codec转换留后续接线，不能直接导入尚未实现compactValidation。list含旧/新摘要，同id优先v2，禁止删旧库。沿RECORDING_DB_NAME='trainer-recordings' version2，保留sessions。新compactSessions header与compactRecords store（keyPath可用[sessionId,kind,index]）分离元信息与不可变追加项。

每次save必须只put新events/checkpoints/resources（series/drawings/trainingMeta/accounts/trades/contexts）和header，不能put整份历史file或全部旧记录。header含gaps/complete/counts/revision及metadata。单事务atomic提交所有新条目+header，oncomplete后才更新实例已提交游标/revision。get/load重组紧凑文件不展开行情。save先串行化本实例，输入条目必须已被调用者当不可变，必要浅数组切片，不深复制所有历史。允许started事件被后续finish追加，但已存事件/checkpoint不能就地改；已提交前缀不同或缩短须拒绝，不能只比长度。

并发：load在实例缓存expectedRevision；首次save已有别人会话而本实例没load应拒绝。save事务核对持久revision，失败保留内存、不能提前推进游标。真正同一成功批次重试可识别为no-op；同revision两个实例分叉产生相同length但不同条目必须第二个拒绝，即使metadata长度相同。禁止自动抢锁/覆盖。

生命周期：open失败清cached rejected，close/versionchange清缓存，blocked后迟到success关闭失效连接，事务失败/abort可retry，save仅在complete成功。独立少量memory store与IDB最小异步stub测试（复用旧recording-storage.test.ts写法但不要修改），不引新依赖。测试存储真实数据行为，不只断言调用次数；可以测put次数作为增量要求附加证据。

先RED再GREEN：首次保存+load深等；增加1事件+1cp只增新条目；同file再次save no-op；中途事务abort无partial状态且retry成功；双实例同revision等长度不同内容冲突；旧v1保留/摘要去重；连接失败重试/blocked晚success；close后再open。npm test -- server/test/recording-compact-storage.test.ts --maxWorkers=2；typecheck:web。结束短报测试/文件/风险，不做下个任务。
