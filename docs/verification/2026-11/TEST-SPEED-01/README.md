# TEST-SPEED-01 验证记录（2026-11-09）

任务：测试集成提速（用户要求单轮集成从近 8 小时压到可接受时长，同时不降测试目标）。

## 产物

- `npm run verify:fast -- [--unit <files>] [--journey <specs>]`：docs:check → build（含 vue-tsc）→ 指定单测/定向 journey；分步耗时表；无参数约 1~2 分钟。
- `npm run journey:parallel -- --shards 2 [-- <specs>]`：N 个隔离 journey run 并行（各自 manifest/端口/DB/构建/报告；单 run 仍 workers:1），输出每 shard 耗时与退出码。
- 测试协议 docs/engineering/testing.md 增「分层门禁与耗时」：迭代轻量、发布一次全量、环境 flaky 只复跑失败项、默认 trace off（TRAINER_TRACE=on 恢复）。

## 实测

| 场景 | 证据 |
|---|---|
| `verify:fast`（docs+build+chart-statistics 单测+chart-analysis 9 e2e） | **123s PASS**：docs 3s、build 21s、unit 4s（6 例）、journey 94s（9 例） |
| 全量 journey 2 shards 并行 | **18.4min**（单 run 顺序基线约 33–43min）：shard1 116 passed/1 env-flaky、shard2 118 passed/1 env-flaky；两项隔离复跑通过（见 REL-136） |
| 单轮集成 8h 的原因拆分 | 全量 verify:baseline 60min ×6 次重试≈6h＋打包/修复≈2h；主因是环境 flaky 后整轮重跑，非测试必要覆盖 |

## 实测结论

- 轻量迭代门禁 `verify:fast` ≈ **2 分钟**；全量 2-shard 并行 journey ≈ **18 分钟**（含各自构建），单轮发布验证墙钟从约 60–90min 降到约 **20–25min**。
- 并发跑「unit + 2 journey shards」会放大 CPU 争用，导致 5s 单测超时与 UI 等待超时；推荐顺序：先并行 journey，再单跑 unit（或反过来），不三路并发。

## 约束

- 并行只使用隔离运行，不把单 run workers 改为 >1；每个 shard 的 journey.log/退出码留证。
- 正式候选证明仍以 verify:baseline 为准；并行全量用于整批验收提速。
