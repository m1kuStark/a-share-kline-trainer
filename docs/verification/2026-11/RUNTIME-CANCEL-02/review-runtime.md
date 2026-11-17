# RUNTIME-CANCEL-02 独立只读审查

裁决：可合入（冻结测试改动）。Critical=0 / Important=0 / Minor=0。共享矩阵、派生状态及文档影响门禁由主代理集成后闭合，本报告不把其当前失败记录算作已通过，也不构成产品验收或发布授权。

## 审查对象

- 工作树：`C:\Users\Stark_Du666\.codex\worktrees\runtime-cancel-02\a-share-kline-trainer`。
- HEAD：`2c66477f0c4875ac3a100338fdbc42b4878dadd8` 加未提交测试/文档差异。任务基线 `3b5fb110e506eb2e139f754c966cee3a64f55ea1` 经 merge-base 确认为 HEAD 祖先。
- 审查两份测试、两份被测产品实现、testing/task 文档差异及原始/复制收据。未安装依赖、运行测试、改变工作树/index/HEAD/分支、改共享矩阵或写台账；只在 headroom-cache 写本报告及可逆压缩缓存。

## 优点及五维核验

1. 计划对齐：修正聚焦旧15s预算与异步测试清理，产品脚本无差异。任务文档保留原失败与“尚未证实生产泄漏”的边界，未把负载敏感失败改写成必现产品故障。
2. 代码质量：runtime 在 `server/test/runtime-isolation.test.ts:194` 共用幂等 stop，在 :206 注册所有权，finally 与 afterEach 先排空命令、等待哨兵 close，再删除目录；只操作所持有的有效 PID。desktop 在 `desktop/test/port-tree-kill.test.ts:101` 同样集中清理，:112 的有界重试仅用于夹具回收，:145 的成功路径目录释放断言没有重试。
3. 架构与集成：两份产品文件均原样恢复且 git diff 为空。runtime 孙进程 cwd 指向 TRAINER_VERIFY_DIR（run.artifactsDir，位于 runDir 内），desktop 孙进程继承 owned-tree cwd；即时删目录实际覆盖持有目录的子进程。树外哨兵分别驻留外层 root，能检查终止边界。项目现有 CI 仅 Windows，desktop 的非 Windows 返回为既有代码。
4. 测试真实性：runtime :175 与 desktop :92 均启动 detached 真实孙进程，正向用例先确认父孙/哨兵存活，再终止并检查父孙退出、目录即时释放、哨兵存活。runtime :223-225 还保留取消错误内容、原始错误对象身份及日志断言。所有原有断言保留，无新增 skip。45s（runtime :245）及60s（desktop :153）按已有20s/30s taskkill 上界、就绪与退出确认预算设置；生产默认退出等待5s由既有专例锁定，未放宽产品SLA。预算用于真实进程基础设施，不替代退出断言。
5. Harness 收据：独立计算77项 cacheFiles 的字节数及 SHA256，全部相符；runs 的45份副本均有原缓存对应且逐一哈希一致。实际失败与日志命名如实披露，严格绑定/文档检查的非零退出也保留。当前 runtime-cancellation 为 planned/open3、strict exit3；launcher-lifecycle covered10、exit0。共享闭环尚待主代理完成。

## 关键真实测试及变异

- `server/test/runtime-isolation.test.ts::runtime processes > cancels an owned child command and preserves its failure log`，声明 :163；退出断言 :226-228，目录释放 :229-230。
- `desktop/test/port-tree-kill.test.ts::PORT-COEXIST-V127-NODE: killTrainerTree 真实边界（真实两级进程树＋真实 taskkill） > PORT-COEXIST-V127-NODE: taskkill terminates a real two-level node process tree including the grandchild`，声明 :81；退出/边界断言 :142-144，目录释放 :145-146。
- 首个附着孙进程 `/T` 变异：exit0，日志实际1 passed/14命令过滤；明确为幸存，不能当语义杀死。
- runtime detached `/T` 变异：exit1，原始日志 :19 为 `AssertionError: owned grandchild must exit before cancellation returns: expected true to be false`，定位测试 :227；耗时8.47s，cleanupError 为 undefined，非超时/清理异常。
- desktop detached 首轮变异：exit1，原始日志明确为 EBUSY 掩盖；不计语义杀死。
- desktop detached 第二轮变异：exit1，原始日志 :10 为 `AssertionError: owned grandchild must exit after tree termination: expected true to be false`，定位测试 :142；耗时7.68s，非超时/清理异常。只为最后回收夹具增加有界重试，成功路径断言保持即时。
- 四份 mutant diff 均只从对应产品 taskkill 参数中移除 `/T`。最终两份变异收据各有 restoredByteExact=true，产品前后 SHA256 一致。精确恢复后完整 runtime spec 15/15、desktop spec 7/7。
- 原样 `red-original-*` 两次实际 exit0，名称没有被用作虚假 RED。历史完整/隔离15s超时和 EBUSY、生命周期首试失败、首个变异幸存、被 EBUSY 掩盖轮均已保留。历史 updater 原样复跑通过不归功本次修正。

## 正式完整测试

查证 `runs/npm-test-final.receipt.json` 与原始日志：2026-11-18 00:49:38 +08:00 开始的第一轮正式 `npm test` 原生 exit0，总381365.7727ms。server 188文件、2654/2654；desktop 34文件、369/369，共3023。包脚本实际为 server vitest 后接完整 desktop 测试，无命令过滤；未发现 skipped 或缺语料消息，也未拼接局部重跑充当全量。

环境收据明确使用 cache/full-test-isolated 中的 DB/data、OPEN_BROWSER=0；公式语料指向工作区目录。完整日志仍有既有 portable-updater-smoke.test.ts 重复 maxTries 键警告；本片未触及该文件，不以此否定本次测试变更。

## 冻结指纹

| 文件 | SHA256 |
|---|---|
| server/test/runtime-isolation.test.ts | 2F6A850D9A2615DCCE594577196BA0BC5BD6FEBDA09EE55F50EF2B5BA6A4721D |
| desktop/test/port-tree-kill.test.ts | 8141ACAD504FC559D391E2379E09114B476C009A4AFCC653BBC2C4E1DDC75770 |
| scripts/runtime/run.ts | 76458A4B5D9C85913D371D0255A1D4382B026FC56162FD0B62DB96F3DCD7A6CC |
| desktop/src/port-conflict.ts | B5A9996ADF6CAFC202DE7BC13167425794AE7B1D014732359D0638D5FC10E385 |

## 问题

未发现 Critical、Important 或需单列的 Minor。不存在以加 timeout、删断言或清理异常替代树终止语义的证据。

## 搁置不判清单

- 主代理后续吸收 main、更新共享矩阵/ENG/work-items/status 后的最终 docs:check、docs:status、docs:impact 及 check-binding 结果。此树原收据分别为1/1/1及 runtime3，不能静默宣称通过。
- 未另跑 vitest list 或测试；测试全名通过源码及已执行的正向/变异原始日志核验。最终共享矩阵绑定由主代理在集成树实查。
- 未验证极端 Windows 调度下所有串行 deadline 同时耗尽；本报告判定预算有依据，未给出永不再出现基础设施超时的保证。
- 非 Windows 行为、已打包 Electron/安装器、产品 Journey、视觉验收、个人训练库、用户验收和发布，均超出本次测试片审查范围。
- 两个历史临时目录的递归清理被自动审批拒绝，本次未重试或绕过；它们不属于仓库文件。

可合入理由：真实 detached 孙进程与树外哨兵加强了边界，撤去 `/T` 会在目标断言处失败；产品保持原字节，完整测试及保留的失败链相互印证。主代理仍需完成共享门禁并登记本裁决。
