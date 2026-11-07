# TEST-BUDGET-01 验证记录（2026-11-07）

## 背景

整批最终门禁反复出现既有 Windows 环境性 flaky，均与真实 I/O/子进程清理相关：

1. review-profile 真实临时 git 仓用例：默认 testTimeout 30s 在满载下超时（此前 hookTimeout 已放宽到 45s）→ 本卡把该文件 **testTimeout 30s→90s**（断言/用例集合不变）。
2. runtime-isolation「cancels an owned child command...」：Windows `taskkill /T /F` 与 ChildProcess close 事件在满载下偶发滞后，导致正常取消被误判为 cleanup incomplete → 硬化 `scripts/runtime/run.ts`：
   - `TREE_KILL_DEADLINE_MS` 10s→20s（给 taskkill 树清理更充裕但仍有限的完成预算）；
   - 等待 close 超时后增加「进程已不存在（`process.kill(pid,0)` 失败）即视为清理完成」兜底；
   - STOP_DEADLINE 保持 5s（曾有实验改 15s 反而使 never-ready 用例超时，已回退）。
   断言与测试集合不变，仅清理确认更贴近真实进程状态。
3. release-launcher 夹具泄漏（2026-11-07 实测 4 个残留 `rel launch 容器 pkg` 服务进程）：满载/慢健康夹具下 HTTP 健康探针超时会被判「身份不符」而跳过结束。清理逻辑增加**状态文件身份兜底**（`trainer-state.json` 的 appId+runId+pid 三匹配同样证明所有权），并在清理当前 4 个残留后隔离复跑：**52/52 通过、0 残留**。

## 复跑

| 命令 | 结果 |
|---|---|
| `npx vitest run server/test/review-profile.test.ts` | 16/16 通过（隔离） |
| `npx vitest run server/test/runtime-isolation.test.ts` | 15/15 通过（隔离，硬化后多次） |
| `npx vitest run server/test/runtime-cancel.test.ts` | 1/1 通过（有界清理错误窗口 18s→26s 对齐新 20s 死线，断言不变） |
| `npm run verify:baseline` | 待填（整批最终门禁） |

## 边界

- 本卡只改测试时间预算与运行时清理确认的健壮性；不改产品行为、不改任何断言或跳过测试。
