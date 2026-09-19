# 紧凑Recorder输入失败原子性返修

GLM5.3Flash最高档。worktree REC-RECORDER-V2，基线bc9de27。只改compactRecorder.ts、compact-recorder.md、server/test/recording-compact-recorder.test.ts。不改codec/types/validator/storage/页面/包/Git/其他worktree/浏览器。主代理在REC-01接线，别覆盖集成改动。测试maxWorkers2。

17tests通过但独立探针复现3问题，按小任务修：
1. checkpoint.context循环引用：start先assign session后toSafe失败→getStatus仍recording cp0合法重试start拒绝；pause先关闭openOps写accepted/gap后失败→state仍recording；resume先闭gap/写events后失败→仍paused且无法再resume。必须完整验证并准备输入后再改变状态、op、gap、seq/builder，错误原状态保留合法重试成功。
2. capture输入chart.drawings=null导致builder追加series及消耗checkpointIndex后抛错；随后合法capture export firstCheckpoint越界。toSafeInput必须做完整结构检查而非JSON stringify一下就cast，或builder支持原子但你不改builder，优先复用纯校验helper对单checkpoint输入检查。不能每次校验整文件/全部历史，不要newBuilder全资源克隆来实现回滚。finish带坏checkpoint也必须保留openOps和事件未完成可重试。真实应用DTO可包含合理null optional值，原语义保持。
3. JSON克隆把NaN/Infinity转null被接受，先assertJson(有限/深度/类型)再复制；循环必须可行动错误，不静默截断。params/result/app/env如果进入相同无损路径也一致，不扩展产品需求。禁止用清空录制恢复。

回归：上述每种坏输入抛错前后getFile状态深等或start保持未初始化；随后合法start/capture/pause/resume/finish成功且validate/Reader还原正确，资源未加/编号未跳；NaN和Infinity context拒绝未变null。测试导出保留错误前的有效会话。不要改公开API或自动停录；root增加isRecording()只在集成树，当前分支没有请勿删。

可读C:/Users/Stark_Du666/.codex/headroom-cache/recorder-edge-review*.mts探针。npm test -- server/test/recording-compact-recorder.test.ts --maxWorkers=2；typecheck。结束短报返回。
