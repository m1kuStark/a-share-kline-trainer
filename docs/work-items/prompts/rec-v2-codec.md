# REC-V2-CODEC：只做纯编解码和类型

你是GLM5.3Flash开发者。独立worktree D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-CODEC，基线ab0858d，依赖已安装。先读根AGENTS、web/AGENTS、server/AGENTS、docs/engineering/recording-v2-contract.md、types.ts真实接口。用户已经批准紧凑方案；主代理负责review/集成/真实UI，禁止自动停录。

允许新建/修改仅：web/src/recording/compactTypes.ts、compactCodec.ts、compact-codec.md、server/test/recording-compact-codec.test.ts。不改旧types/recorder/storage/validation或页面、不改任务卡/全局文档/包，不Git提交/合并/push/reset，不读取个人DB/TDX，不浏览器、不启动子agent。完成本单元即停止。

目标：严格实现v2合同“数据结构”和“纯codec接口”，其余校验/压缩/IndexedDB是后续独立任务，不做。接口CompactBuilder(resources?,checkpointCount=0).capture/getResources；compactRecording(v1)；CompactReader(v2).checkpointAt(index)。v1输入由调用者校验，首版codec无需导入旧validator限制。

共享资源：series full/delta，drawings full/delta，trainingMeta/accounts/trades/contexts内容去重；轻量checkpoint保留id/afterSeq/segment/capturedAt/ui，用refs指向不可变资源。使用短ID，字符串指纹只是索引，比较完整规范内容避免碰撞，不按date覆盖不同观察版本。series同周期，最多31层delta、32版基础、delta更大时full。firstCheckpoint记录首次检查点数组下标（从传入checkpointCount继续），asOf依训练currentDate/startDate合同；未知截止null不能给已知检查点复用。月K日期键不变也可能变OHLC，需upsert。画线工具/点/文本/样式原值保留。实际交易序号同一但chartPrice变化也保留新TradeView版本。

Reader单次只展开目标checkpoint；最多缓存8个series和8个drawings版本，返回深拷贝不让调用者污染缓存/资源。边界错误明确，基础链不要递归无限循环；不要把整份recording展开成v1，更不能依赖Node crypto/fs在browser文件。getResources提供只读结构供调用者读取，但capture不能修改调用者曾传入的原对象；记录所有数组只追加，不修改历史版本。

先写真正失败测试再实现。覆盖：几千bar共享内容/日增1条patch、复权旧bar变值保留两版、周月当前柱更新、两份相同capture资源不增长但checkpoint时间不同、drawings删除/恢复/文本样式、账户和trade去重、修改输入/reader输出不污染历史、restore Builder继续、31链上限/大patch转full、null training/chart/context、原v1逐checkpoint/events/gaps完全相等。用当前项目fixture或本地生成数据，不访问TDX。别写只搜源码字样的测试。

npm test -- server/test/recording-compact-codec.test.ts；npm run typecheck:web。返回文件、真实测试数与退出码、接口差异（如有先报告，不擅自改合同）。短回答，不扩展任务。
