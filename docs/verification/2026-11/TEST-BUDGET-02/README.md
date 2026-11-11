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
| PR 门禁 | `docs` / `verify` / `pr-policy` | 本 PR 验证；收据回填到验证记录 |

## 边界

- 全局 desktop `testTimeout` 不变；不放宽纯逻辑用例。
- 不删除/跳过任何断言；若后续仍出现 >30s 满载超时，按新证据另立预算任务。
