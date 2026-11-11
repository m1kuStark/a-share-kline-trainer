# TEST-BUDGET-03 验证记录

> 状态：进行中（本地自检与门禁执行中）；基线 8362fd9（main）。
> 任务：CI verify 的 desktop 测试命令显式 30s testTimeout；本地/全局契约不变。

## 触发证据

- PR #26 verify 因 desktop/test/mig-import.test.ts > stageHistoryImport: 目标库非空时不再拒绝… 报 Test timed out in 5000ms 失败一次，rerun 通过。
- 同类 desktop 迁移用例 5s 超时此前已在 PR #19/#20/#26 出现三次，逐用例放宽不可持续。

## 改动

- scripts/ci/run-tests-with-retry.mjs 默认命令追加 --testTimeout=30000（npm test 参数只追加到 desktop 命令）。
- 新增 --print-command 自检入口；真实断言失败仍不重试（CI-STABILITY-01）。

## 自检

| 检查 | 命令 | 结果 |
|---|---|---|
| 打印命令 | node scripts/ci/run-tests-with-retry.mjs --print-command | 执行中 |
| 语法 | node --check scripts/ci/run-tests-with-retry.mjs | 执行中 |
| 文档结构/任务卡 | npm run docs:check | 执行中 |
| 状态生成区 | npm run docs:status -- --check | 执行中 |
| 范围/文档影响 | npm run docs:impact -- --base 8362fd9 --task TEST-BUDGET-03 | 执行中 |
| PR 门禁 | docs / verify / pr-policy | 执行中 |

## 边界

- 只影响 CI desktop 测试命令；本地默认 testTimeout、断言、用例集合、数据范围不变。
- 若 30s 仍被超时误拦，另立预算任务，不再放宽默认值。