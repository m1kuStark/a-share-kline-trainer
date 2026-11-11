# TEST-BUDGET-04 验证记录

> 状态：进行中（本地 desktop 套件与门禁执行中）；基线 2cc83d9（main）。
> 任务：desktop/vitest.config.ts testTimeout 30s；撤销未生效的 TEST-BUDGET-03 CLI flag。

## 触发证据

- main CI run 43063764248（2cc83d9）verify 失败：desktop/test/mig-import.test.ts > MIG-MERGE-IDEMPOTENT 报 Test timed out in 5000ms。
- TEST-BUDGET-03 的 --testTimeout 追加在嵌套 npm run test:desktop 后，未作为 vitest 参数生效。

## 门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| 迁移用例定向 | npx vitest run --config desktop/vitest.config.ts desktop/test/mig-inline.test.ts desktop/test/mig-import.test.ts | **34/34 passed**（3.5s） |
| desktop 全量套件（本地） | npx vitest run --config desktop/vitest.config.ts | 迁移用例通过；本地进程在 portable-updater/port-kill 用例后以 Windows 0xC0000409 退出（与本任务断言无关，CI verify 全量权威） |
| 文档结构/任务卡 | npm run docs:check | 执行中 |
| 状态生成区 | npm run docs:status -- --check | 执行中 |
| 范围/文档影响 | npm run docs:impact -- --base 2cc83d9 --task TEST-BUDGET-04 | 执行中 |
| PR 门禁 | docs / verify / pr-policy | 本 PR 验证；收据回填 |

## 边界

- 只改 desktop 套件超时预算与 CI 文档；server/本地纯逻辑默认不变；断言/用例集合/数据范围不变。