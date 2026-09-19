# 录制核心实现说明（recorder.ts / storage.ts）

本文记录v1兼容基线，实现[原接口合同](recording-contract.md)；类型在 `web/src/recording/types.ts`。recorder 在restore载入时调用validateRecording拒绝损坏文件。用户已确认[v2紧凑迁移](recording-v2-contract.md)，生产接线完成前本页仍描述现行v1实现。

## 模块划分

- `web/src/recording/recorder.ts`：`Recorder` 类，唯一维护 seq、elapsed、segment、gap、complete 与保存调度。
- `web/src/recording/storage.ts`：`MemoryRecordingStorage`（测试/无持久化环境，可注入保存/读取故障与 onSave 观察钩子）与 `IndexedDbRecordingStorage`（生产）。两者只实现合同接口 `save/load/list`。
- 不依赖服务端SQL或页面。recorder可使用纯validator，storage只负责存取，不反向依赖UI。

## 状态机

- `start(trainingKey, initial, enabled=true)`：新建 sessionId 与首段 segment，写入初始 checkpoint（afterSeq=0）。`enabled=false` 时进入 paused 并记录 `{afterSeq:0, resumedAtSeq:null}` 的未闭合 gap，`begin` 返回 null，`capture` 直接忽略。
- `begin/finish` 按 opId 配对；`finish` 对未知或重复 opId 抛中文错误，不产生幽灵事件。
- `pause(checkpoint)`：先把所有进行中的 started 闭合为 `outcome:'interrupted'` 的 finished（不带 result，不猜测请求结果），再记录 `recording.pause` started/finished 标记对、追加 gap、写入 pause checkpoint，await flush 后才返回。
- `resume(checkpoint)`：要求存在未闭合 gap；开启新 segment，记录 `recording.resume` 标记对与完整 checkpoint，回填 `gap.resumedAtSeq` 后回到 recording。
- `complete` 派生：存在悬空 started 或未闭合 gap 即 false；begin 与 finish 之间 complete=false 属预期。历史已闭合gap仍可与complete=true共存；它只描述当前尾段，不代表全过程无缺口。播放器必须独立展示gaps。

## restore 语义

`restore(id)` 从存储读取文件后先 `validateRecording` 校验，损坏文件置 error 并抛出中文错误，不进入半载状态。通过后：为每个悬空 started 追加同 opId/同 action、`outcome:'interrupted'` 的 finished 事件（沿用原 segmentId）；不改动既有 params/result，不推测任何成交结果。续录沿用停止时所在 segment（最后一个事件的 segmentId，首次无事件用初始 checkpoint 的 segmentId），保证恢复后立即 capture 产出的 checkpoint 在事件中可证实；真正 `resume()` 才开启新 segment。若文件存在未闭合 gap 则恢复为 paused（须显式 `resume`），否则 recording。elapsed 以 `elapsedOffset=文件内最大 elapsedMs`、`anchorWall=恢复时刻` 为基准继续单调（`currentElapsed = max(lastElapsed, offset + now - anchorWall)`，anchorWall 只减一次）。载入失败（不存在、存储异常或校验不通过）通过 onChange 报告 error 并抛出中文错误，不假成功。重复 `start`/`restore` 均被拒绝。

## 持久化管线

- 所有保存经单一 promise 链严格串行；状态变化用 `queueMicrotask` 批量调度，每次入队时对文件做深拷贝快照，慢保存不会别名到后续修改。
- 保存失败：置 error 状态、触发 `onChange`，并标记 dirty 以便下次 flush 重试；事件始终保留在内存，不静默丢数据。下次保存成功后自动清除 error 并恢复 recording/paused 状态。
- `flush()`/`export()` 在链排空后若仍有错误则抛出可行动中文错误（含原因与排查建议）；`export()` 先等 flush 再返回深拷贝。请求成功不等于落盘——生产 IndexedDB 的 `save` 仅在事务 `oncomplete` 后 resolve。
- `getStatus()`/`getFile()` 均返回深拷贝；`getFile` 供内存只读，不触发持久化。

## IndexedDB 要点

单 objectStore（`sessions`），keyPath 为 `sessionId`；多标签页各自生成 sessionId，互不覆盖。打开失败、升级被其他标签页阻塞（blocked）、事务 error/abort 都以中文异常暴露。数据库常量 `RECORDING_DB_NAME`/`RECORDING_STORE_NAME` 由本模块导出。

## 已知边界

- `IndexedDbRecordingStorage`已补打开失败、close、versionchange、blocked迟到连接、事务完成和错误原因回归；打开失败清缓存使重试生效。真实浏览器持久化故障/恢复由recording.spec.ts覆盖，证据仍须关联当次run。
- `export()` 产物能通过 `validateRecording`（enabled=false 初始态、pause/resume、restore 后 capture 均有交叉测试）；restore 同时以 validator 拒绝损坏的存量文件。
- 定向测试：`npm test -- server/test/recording-core.test.ts`（覆盖 begin/finish 配对与深拷贝、默认开关与初始 gap、暂停恢复与 interrupted 闭合、保存串行与故障上报恢复、restore 悬空修补/paused 保留/失败上报、restore 后 elapsed 严格续走、export 与 validateRecording 交叉含损坏 load 拒绝）、`npm test -- server/test/recording-validation.test.ts`。
