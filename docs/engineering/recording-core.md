# 录制核心实现说明（recorder.ts / storage.ts）

实现[共享接口合同](recording-contract.md)的录制状态机与存储层；类型在 `web/src/recording/types.ts`。validator（validateRecording/parseRecording/exportRecording）由独立分支交付，本层不依赖其存在；页面接入与 KlineChart emit 由其他任务负责。

## 模块划分

- `web/src/recording/recorder.ts`：`Recorder` 类，唯一维护 seq、elapsed、segment、gap、complete 与保存调度。
- `web/src/recording/storage.ts`：`MemoryRecordingStorage`（测试/无持久化环境，可注入保存/读取故障与 onSave 观察钩子）与 `IndexedDbRecordingStorage`（生产）。两者只实现合同接口 `save/load/list`。
- 服务端 SQL、validator、页面均不得耦合进这两个模块；跨文件只用 `./types` 的类型。

## 状态机

- `start(trainingKey, initial, enabled=true)`：新建 sessionId 与首段 segment，写入初始 checkpoint（afterSeq=0）。`enabled=false` 时进入 paused 并记录 `{afterSeq:0, resumedAtSeq:null}` 的未闭合 gap，`begin` 返回 null，`capture` 直接忽略。
- `begin/finish` 按 opId 配对；`finish` 对未知或重复 opId 抛中文错误，不产生幽灵事件。
- `pause(checkpoint)`：先把所有进行中的 started 闭合为 `outcome:'interrupted'` 的 finished（不带 result，不猜测请求结果），再记录 `recording.pause` started/finished 标记对、追加 gap、写入 pause checkpoint，await flush 后才返回。
- `resume(checkpoint)`：要求存在未闭合 gap；开启新 segment，记录 `recording.resume` 标记对与完整 checkpoint，回填 `gap.resumedAtSeq` 后回到 recording。
- `complete` 派生：存在悬空 started 或未闭合 gap 即 false；正常落定的会话为 true。begin 与 finish 之间 complete=false 属预期。

## restore 语义

`restore(id)` 从存储读取文件后：为每个悬空 started 追加同 opId/同 action、`outcome:'interrupted'` 的 finished 事件（沿用原 segmentId）；不改动既有 params/result，不推测任何成交结果。若文件存在未闭合 gap 则恢复为 paused（须显式 `resume`），否则 recording。elapsed 以文件内最大值为基准继续单调。载入失败（不存在或存储异常）通过 onChange 报告 error 并抛出中文错误，不假成功。重复 `start`/`restore` 均被拒绝。

## 持久化管线

- 所有保存经单一 promise 链严格串行；状态变化用 `queueMicrotask` 批量调度，每次入队时对文件做深拷贝快照，慢保存不会别名到后续修改。
- 保存失败：置 error 状态、触发 `onChange`，并标记 dirty 以便下次 flush 重试；事件始终保留在内存，不静默丢数据。下次保存成功后自动清除 error 并恢复 recording/paused 状态。
- `flush()`/`export()` 在链排空后若仍有错误则抛出可行动中文错误（含原因与排查建议）；`export()` 先等 flush 再返回深拷贝。请求成功不等于落盘——生产 IndexedDB 的 `save` 仅在事务 `oncomplete` 后 resolve。
- `getStatus()`/`getFile()` 均返回深拷贝；`getFile` 供内存只读，不触发持久化。

## IndexedDB 要点

单 objectStore（`sessions`），keyPath 为 `sessionId`；多标签页各自生成 sessionId，互不覆盖。打开失败、升级被其他标签页阻塞（blocked）、事务 error/abort 都以中文异常暴露。数据库常量 `RECORDING_DB_NAME`/`RECORDING_STORE_NAME` 由本模块导出。

## 已知边界

- `IndexedDbRecordingStorage` 无自动化测试（测试环境为 node、且本任务不使用真实 DB/浏览器）；其行为约定以本文件与合同为准，接入页面后由主代理按测试门禁做真实检查。
- validator 落地后，`export()` 产物应能通过 `validateRecording`；如有出入以 validator 分支的合同解释为准。
- 定向测试：`npm test -- server/test/recording-core.test.ts`（覆盖 begin/finish 配对与深拷贝、默认开关与初始 gap、暂停恢复与 interrupted 闭合、保存串行与故障上报恢复、restore 悬空修补/paused 保留/失败上报、export 等待持久化）。
