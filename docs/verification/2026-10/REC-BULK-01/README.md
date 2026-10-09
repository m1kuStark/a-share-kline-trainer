# REC-BULK-01 录像库批量导出/导入：验证记录

- 日期：2026-10-09（worktree `D:\tmp\exp`，分支 `rec-bulk-export`，基于 main=3e13f98）
- 任务卡：[REC-BULK-01](../../../work-items/tasks/REC-BULK-01.md)
- oracle：用户需求「可以补上录像文件批量导出、导入功能」（2026-10-09 拍板）＋任务简报设计决策（合并包单文件、逐条容错、重复跳过不覆盖、单条导出路径零回归）。

## 交付物

- `web/src/recording/bundle.ts`（新）：合并包格式与批量导入编排。
- `web/src/components/RecordingLibrary.vue`：「全部导出」按钮＋导入多选＋结果报告。
- `server/test/recording-bundle.test.ts`（新，13 用例）；`e2e/recording-bulk.spec.ts`（新，2 用例）。
- `web/src/recording/recording-file.md` 新增「录像合并包」契约节；`e2e/README.md` 补 recording-bulk 行。

## RED（实现前，按预期失败）

1. `npx vitest run --config server/vitest.config.ts server/test/recording-bundle.test.ts` → **exit 1**
   `Error: Cannot find module '../../web/src/recording/bundle' imported from server/test/recording-bundle.test.ts`（缺功能亲证；首次运行还暴露了测试自身的 await 语法问题，修正后重录本条）。
2. e2e `e2e/recording-bulk.spec.ts` 首跑（实现半途）→ **exit 1**：合并包 sessionId 断言（发现导入侧存储重写 sessionId 为 imported-<uuid>，身份字段改为 trainingKey）＋「录像库尚未完成安装隔离初始化」（补 withNamespaceRetry 短重试，与 App 单条导入守卫同语义）。

## GREEN 与定向回归

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `npm run build:server` | 0 | tsc 通过 |
| 2 | `npx vitest run --config server/vitest.config.ts server/test/recording-bundle.test.ts server/test/recording-file.test.ts server/test/recording-library.test.ts server/test/recording-storage.test.ts server/test/recording-compact-storage.test.ts server/test/recording-migration.test.ts` | 0 | 83 passed（含新 13） |
| 3 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/recording-bulk.spec.ts --retries=0` | 0 | 2 passed（12.7s） |
| 4 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/recording-migration.spec.ts --retries=0` | 0 | 2 passed（18.1s） |
| 5 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/recording-library.spec.ts --retries=0` | 0 | 2 passed（17.0s） |
| 6 | `npm run build`（typecheck:web＋build:server＋build:web） | 0 | 全过 |
| 7 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/recording.spec.ts --retries=0` | 1 | 3 passed / 1 failed——失败例「默认录制交易拒单、周期和画线，暂停恢复后可导出并离线回放」在第 137 行 drawings 恢复轮询超时；**基线核查**：`git stash -u` 后在干净 3e13f98 重跑同一命令同样 3 passed / 1 failed（同用例同断言），实证为基线既有失败（环境相关），非本任务回归。 |

## 证据工件

- e2e 运行产物（journey 运行目录 `.runs/run-*/artifacts/`）：`recording-bulk-bundle.trainer-recordings.json`（导出合并包实体，含契约头）、`recording-bulk-restored.png`、`recording-bulk-tolerant-import.png`。
- 单测日志要点：RED `Cannot find module .../recording/bundle`；GREEN `Tests 13 passed (13)`。
