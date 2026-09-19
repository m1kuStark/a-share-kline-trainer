# REC-HARDEN-1 存储重试

在 D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-HARDEN，基础240c9ec。读根/ web/ server/ AGENTS。只改 web/src/recording/storage.ts、recorder.ts、server/test/recording-storage.test.ts。不要改其他工作树、UI、types/validation、包配置、全局文档。不要Git提交/合并/推送，不访问个人DB或TDX。你是GLM开发者，主代理验收。

只修两件真实问题，先有效失败测试再修：
1. IndexedDbRecordingStorage缓存rejected dbPromise：初次open失败后第二次list/load必须重新open。close()重置缓存；versionchange关闭且清缓存；blocked后迟到success必须close失效连接。IDB可用最小异步事件stub测试生命周期，不引新依赖，不需浏览器。save成功依旧只在transaction complete后返回。
2. Recorder在file=null时getStatus忽略lastError，restore不存在会话或读取错误后onChange应展示真实原因而不是笼统未初始化。加回归。

不改事件语义。npm test -- server/test/recording-storage.test.ts server/test/recording-core.test.ts；npm run typecheck:web。返回文件和真实测试结果即停止。
