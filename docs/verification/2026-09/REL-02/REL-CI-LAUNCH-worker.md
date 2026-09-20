# Worker report (local self-report)



## Linux CI 失败根因与修复（2026-09-21）

CI 运行 35535978552 在 GitHub Linux Node 24.15.0 上失败两例（`kline-ci-35535978552.test.txt`）：

1. **config 用例（test 310）**：夹具传 `TRAINER_DB=D:\db\t.sqlite`，Windows 盘符路径在
   Linux 上不是绝对路径，`resolveConfig` 按设计抛出“TRAINER_DB 必须是绝对路径”。
   产品行为正确，属于夹具平台不中立。修复：夹具改用 `tmpdir()` 拼出的平台原生
   绝对路径，覆盖关系断言（env 覆盖 config、相对路径仍拒绝）全部保留。

2. **并发 stop+launch 用例（test 687）**：真实竞态。`launch()` 在获取生命周期锁
   **之前**执行 `decideRecordedServer`（步骤 1 与等锁轮询里的 `raced` 检查都是锁外），
   与并发 `stop()` 交错时可能“读取 state 时 PID 还活着、随后的健康确认落在
   stop 的 SIGKILL 之后”，于是把合法 stop 误报成 live-unverifiable owner 而拒绝。
   锁外 reuse 还可能把正在被 stop 结束的服务当作可复用结果返回（死 PID）。

   修复：`launch()` 先取启动锁；所有 state 复用/清理决策全部移到锁内（与 `stop()`
   同一把锁）。等锁时只轮询锁文件释放，不再做锁外决策；等锁释放后回到循环顶部
   重新取锁决策。所有权语义不变：无合法生命周期归属时仍拒绝（known-unverifiable
   owner refusal）、stop 永远按记录端口与核验过的 PID 结束、复用仍要求
   version/gitCommit/databasePath/tdxRoot 一致、绝不向旧 PID 发信号杀新进程。
   锁占用错误信息改为“另一个启动/停止进程”，与实际语义一致。

### 回归与测试基建

- 新增确定性回归：慢健康夹具（`FIXTURE_HEALTH_DELAY_MS`）让 stop 持锁后的身份
  确认延迟约 800ms；测试等 `launch.lock` 出现后立即发起 launch。旧实现必然
  “读时 PID 活、确认时已死”而误拒（已在本地对旧 launcher 复现，失败原因即该
  误拒文案）；修复后 launch 等锁、stop 收尾后重新决策并正常启动新服务。
- 两个 `Promise.allSettled` 用例改为先 `throw settled.reason` 再断言，失败时
  打印真实拒绝原因（此前 CI 日志只显示 `{status:'rejected'}`）。
- 测试清理不再按裸 PID 集合发信号：直接子进程用句柄结束；分离的夹具服务仅在
  健康身份（runId+PID）仍匹配时才按 PID 结束（探针超时随夹具健康延迟放宽），
  PID 已被回收时不会误伤无关进程。
- 既有 35 例全部保留并通过，新增 1 例确定性回归，共 36 例。

### 验证记录（本地 Windows，无 Linux 环境）

- `npm test -- server/test/release-launcher.test.ts`：36/36 通过，进程退出码 0，
  无 `rel-launch-*` 残留目录、无孤儿夹具进程（修复前一轮曾因清理缺陷泄漏孤儿
  进程导致 tinypool teardown 崩溃，已随清理修复消除）。
- 对旧 launcher 暂存对比：新增回归按预期失败于“无法确认它属于这条记录”误拒，
  证明回归能捕获该竞态。
- stop lifecycle 子集（含并发与确定性回归）连跑 3 次全部通过。
- 远程 Linux CI 验证由集成人执行；本地未声称 Linux 通过。
