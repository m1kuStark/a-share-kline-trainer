# V1.2.7 自定义范围条件单修复验证

本记录对应用户反馈：自定义训练时长范围中勾选“启用条件单”并选择开盘+收盘后，进入训练仍未显示条件单页签。

## 根因与修复

`createRangeTraining()` 原先把范围训练硬编码为 `clock_mode=close_only`、`orders_enabled=false`，覆盖了启动器提交的设置。提交 `6493a67af7dadb6c770974c00ab308afd16aa920` 现在校验并保留这两个字段；`open_close` 会从首根日线开盘阶段开始，`close_only` 保持原有收盘阶段语义。

## 工程验证

| 检查 | 结果 |
|---|---|
| `npm test -- server/test/train-range-preview.test.ts --run --maxWorkers=2` | 21/21 通过 |
| `npm test -- server/test/conditional-orders.test.ts server/test/train-engine.test.ts server/test/train-range.test.ts --run --maxWorkers=2` | 57/57 通过 |
| `npm run build` | 通过（前端类型检查、服务端编译、生产前端构建） |
| `TDX_ROOT=.runs/run-d8339f32-3b20-4adf-bea1-a173f215680c/tdx-snapshot npm run journey -- e2e/training-range.spec.ts --retries=0` | 7/7 通过（独立 run `run-56ad6caa-643d-4366-a2f4-e01a5ce9c956`） |

新增范围创建回归用例断言：提交 `clock_mode=open_close`、`orders_enabled=true` 后，创建响应包含 `clockMode=open_close`、`ordersEnabled=true`、`currentPhase=open`、首根开盘价和空收盘价。

用户已在 Windows 1.2.7 验收包中复现“自定义范围→开盘+收盘→启用条件单→开始训练”流程，确认进入训练后仍保留条件单页签和开盘/收盘阶段，并授权更新现有 GitHub Release。完整验收结论见 [v1.2.7 用户验收记录](../V1.2.7-user-acceptance/README.md)。
