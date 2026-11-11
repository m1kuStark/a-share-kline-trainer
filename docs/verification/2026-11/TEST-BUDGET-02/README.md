# TEST-BUDGET-02 验证记录

> 状态：进行中（本地门禁执行中）；基线 `7cee87e`（main）。
> 任务：只放宽 `desktop/test/mig-inline.test.ts` / `mig-import.test.ts` 两个真实文件 I/O 用例的 timeout 到 30s；断言、用例集合、产品代码不变。

## 触发证据

- PR #19 verify：`desktop/test/mig-inline.test.ts` 的“空目标库：老库 2 局全部导入；重跑同一路径全部 skipped…”用例报 `Test timed out in 5000ms`；rerun 通过后 PR 合入。
- PR #20 verify：`desktop/test/mig-import.test.ts` 的 `MIG-MERGE-NS-PRESERVE…` 用例报 `Test timed out in 5000ms`；rerun 通过后 PR 合入。
- 失败同属真实 fs+SQLite 迁移链路的满载预算不足，非产品断言失败；main CI 两次均通过。

## 本地门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| 定向 desktop 迁移 | `npx vitest run --config desktop/vitest.config.ts desktop/test/mig-inline.test.ts desktop/test/mig-import.test.ts` | **34 passed**（mig-inline 9/9、mig-import 25/25，3.4s） |
| 文档结构/任务卡 | `npm run docs:check` | **0 errors**（158 条既有长度 WARN） |
| 状态生成区 | `npm run docs:status -- --check` | **0 errors** |
| 范围/文档影响 | `npm run docs:impact -- --base 7cee87e --task TEST-BUDGET-02` | **0 errors** |
| PR 门禁 | `docs` / `verify` / `pr-policy` | PR #21 run `43011676106`：**三 job 全部 success**（verify 一次通过，未 rerun） |

## PR / 合并收据

- PR [#21](https://github.com/m1kuStark/a-share-kline-trainer/pull/21)：`fix(test): TEST-BUDGET-02 迁移用例 5s 预算放宽到 30s`。
- CI run `43011676106`：`docs` / `verify` / `pr-policy` 全部 success；verify 未再因 5s 超时 rerun。
- squash 合入 main：`e9eab78a65bc05ca362e9249fb833974595c0c61`（2026-11-11 19:29）。
- 合并后 main CI run `43012413374`：以 GitHub 页面结果为准（本记录提交时仍在运行，收口后核对）。

## 结论

- 只调整两个真实文件 I/O 用例预算，断言/用例集合/产品代码不变。
- CI verify 的 5s 误拦 flake 在本次 PR 上未复现；保留 30s 预算作为满载保护。
- 用户验收未记录。

## 边界

- 全局 desktop `testTimeout` 不变；不放宽纯逻辑用例。
- 不删除/跳过任何断言；若后续仍出现 >30s 满载超时，按新证据另立预算任务。
