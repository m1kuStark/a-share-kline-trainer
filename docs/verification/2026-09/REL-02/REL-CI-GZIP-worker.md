# Worker report (local self-report)



## 根因与测量（2026-09-21，Windows本地 Node 24.15.0 空载，1MiB随机gzip≈1048919B）

CI失败是吞吐超时，不是死锁：CI日志中全部死锁回归用例5–20ms通过，唯一失败是块=1用例恰好在30s时限到期。逐项归因（临时基准脚本，成功路径逐行镜像 `inflateGzipWithBudget`）：

| 变体 | 耗时 |
|---|---|
| 仅源读取（块=1，约105万次read） | 344ms |
| 仅解压器写入（105万次1字节write） | 11562ms |
| 现实现 块=1 | 12488ms |
| 合并64KiB 块=1 | 391ms（约32×） |
| 合并16KiB 块=1 | 338ms |
| 现实现 块=16/16384/65536/1MiB | 792/4/3/3ms |

结论：瓶颈是每次 `writer.write()` 进 DecompressionStream 的固定异步开销（约11µs/次：TransformStream队列+背压+每write的race分配），105万次累计12.5s；GitHub 2vCPU/4worker下放大越过30s时限。源读取本身仅0.34s，不在瓶颈上。

## 实现

`inflateGzipWithBudget` 输入端加有界合并缓冲（`INFLATE_COALESCE_BYTES=64KiB`，导出仅供测试定尺寸）：源小块并入缓冲，越过上限先冲刷；源结束后冲刷残余再close；≥上限的大块直写（与原行为一致，免拷贝）。缓冲有界（≤上限+单块）、字节顺序不变、不整源读入内存；interrupt/fatal/deadlock防回归机制逐字保留，预算与取消语义不变，无新依赖，公开API与盘上格式不变、无版本变更。

## 测试

新增 describe「解压输入合并」4例：跨合并边界（2×上限+12345B、素数997B块）逐字节无损（结尾冲刷丢失即失败）；1/2/3字节小块顺序无损；源中途出错且残余全在缓冲内及时拒绝；预算命中且缓冲有残余仍立即取消源（cancelCount==1、提前停读）。变异验证：临时删除结尾冲刷后两个无损用例即失败，已还原。原20例全部保留并通过：整文件24/24，焦点用例451ms（Windows vitest）。

## 限制

本地Windows测量不证明Linux CI通过，需父代理在GitHub重跑确认；`web/src/recording/recording-file.md`（不在本任务允许路径内）仍记块=1约17s并缺合并缓冲说明，需集成人更新。docs/status.md 为父代理所有，未随本卡刷新（工作树预检 docs:impact 据此提示超出 allowed_paths 属预期），父代理集成各工作卡后统一 docs:status/docs:check。
