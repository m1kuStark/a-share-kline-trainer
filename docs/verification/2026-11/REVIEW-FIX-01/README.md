# REVIEW-FIX-01 验证记录（2026-11-07）

范围：整批代码审查（F1~F7，79b0f8a..9bd598d）CHANGES REQUIRED 的逐项整改；基提交 `9bd598d`。
证据提交：本记录随 `fix(batch): REVIEW-FIX-01 …` 提交；最终 `verify:baseline` 收据见文末。

## 逐项整改

| # | 审查问题 | 整改 |
|---|---|---|
| 1 | major：engine 创建入口不阻断损坏费率键（TRAIN-FEE 证据声明与实现不符） | `commitTrainingCreation` BEGIN 段内读取三费率键，任一 corrupt → 409 `TRAINING_DEFAULTS_UNREADABLE` 零写；补创建态单测（training-fees.test.ts） |
| 2 | major：五份验证记录门禁表「待填」、TRAIN-FEE 数字存疑 | CHART-WEEKDAY/ZOOM/PAN/UI-TOOLBAR/F7 五份 README 填入真实退出码与用例数；TRAIN-FEE 数字改为实测 |
| 3 | major：CHART-PAN 证据声称 vitest maxWorkers 4→2 但文件未改 | 真正修改 `server/vitest.config.ts`（注释说明原因，断言/测试集合不变） |
| 4 | major：data-update e2e dialog 监听被删后仍断言 alerts 为空（恒真） | 恢复 `page.on('dialog')` 监听 |
| 5 | minor：sellFee 两项各自取整后相加仍可能浮点尾差 | 最终和再 roundMoney 一次 |
| 6 | minor：CSS 重复选择器 + 文件尾部缺换行 | 修正为 `.draw-toolbar.is-floating .tool-glyph`；补 EOF 换行 |
| 7 | minor：frontend-contract 类名断言放宽为前缀 | 收紧为 `class="draw-toolbar is-floating"` |
| 8 | minor：m3-feedback 折叠用例丢失 fibonacciLine 取点覆盖 | 恢复两次画线覆盖（fibonacciLine + percentageLine） |
| 9 | minor：KlineChart onMounted 行内注释破坏结构；时间轴平移缺 pointercancel/blur 兜底 | 注释移到 onMounted 上方；新增 `cancelTimeAxisPan` + window pointercancel/blur 监听（onUnmounted 成对移除） |
| 10 | minor：TRAIN-FEE 证据自查数字 | 更正为实测值 |

## 定向检查（整改后）

| 命令 | 结果 |
|---|---|
| `npx tsc -p server/tsconfig.json --noEmit` | **0** |
| `npm run typecheck:web` | **0** |
| `npx vitest run server/test/training-fees.test.ts server/test/train-account.test.ts server/test/frontend-contract.test.ts` | **54/54 通过**（含新增创建态损坏 409 用例） |

## 最终门禁（verify:baseline）

待填。

## 备注

- 未删除/跳过任何测试；预算修改仅限 timeout/worker 数（见 TEST-BUDGET-01 与 CHART-PAN-01 证据）。
- 审查建议中「删除未使用 import」已因 #1 实现而自然消解（FEE_SETTING_KEYS/readFeeDefaultsFields 现被使用）。
