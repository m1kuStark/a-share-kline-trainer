# BATCH-GH-202611 整批验证记录（2026-11-07/08）

范围：训练器 GitHub 待办整批（F0 PR #7 合入适配＋F1~F7＋门禁稳定性/审查整改）。
分支：`verify-pr7`｜最终整批门禁被测提交：**`0453f5b`**（branch HEAD；本记录为 docs-only 收据提交）

## 最终门禁（唯一权威）

| 项 | 收据 |
|---|---|
| 命令 | `npm run verify:baseline`（TDX_ROOT=`D:\MySoftWares\TDX`） |
| 运行 | `run-601825e0-6248-4ea4-9f32-9b11ed53a44f` |
| `verification.json` | `passed=true`，`cleanBefore=true`，`cleanAfter=true`，tree `7fc394c` |
| docs | 0（docs:check 0 errors） |
| unit（server） | 0（175 文件 / 2605 用例） |
| types（web vue-tsc） | 0 |
| build（production） | 0 |
| snapshot（journey 样本） | 0 |
| m2（闭环） | 0 |
| journey（全量浏览器） | 0：**235 passed / 1 skipped / 0 failed（45.4m）** |
| 总耗时 | **53.3min**（journey 45.4m；其余阶段约 8min） |

## 提交清单（相对 79b0f8a F0 收口）

| 任务 | 提交 | 说明 |
|---|---|---|
| TRAIN-FEE-01 | 3a91c4c | 个性化费率（Issue #8-A）：7 字段设置/预设/快照冻结/费用取整到分 |
| SETUP-PASTE-01 | dac4c95 | 通达信目录粘贴/手填入口（Issue #8-B） |
| CHART-WEEKDAY-01 | 7affecb | 日K 悬浮卡/时间轴/状态条星期（Issue #8-C） |
| CHART-ZOOM-01 | 4a8f44e | Ctrl+滚轮缩放＋Shift+←/→ 平移（Issue #8-D） |
| CHART-PAN-01 | 529105a | 时间轴拖动平移（Issue #8-D） |
| UI-TOOLBAR-01 | ae9f6b8 | 顶栏划线开关＋可拖拽图形化悬浮工具栏（Q8） |
| F7-DEPS-01 | 4c7f328 | vite 7.3.7 / fast-uri 3.1.9+4.2.3 / undici 6.29.1+7.30.1 本地等价 chore |
| TEST-BUDGET-01 | 9bd598d / f438dd3 / 47a8aed / 35002f7 / 4861d72 / bb9b884 | 门禁稳定性：测试预算、Windows 子进程清理、release-launcher 夹具泄漏根治 |
| REVIEW-FIX-01 | f107b15 / a5c69f6 / deb88ad / df38935 / 0453f5b | 代码审查 14 项整改＋长时 journey 环境 flaky 收敛 |

（F0 及此前提交见 `docs/verification/2026-11/CHART-PR7-MERGE/`。）

## 逐 feature 证据

- `TRAIN-FEE-01/`、`SETUP-PASTE-01/`、`CHART-WEEKDAY-01/`、`CHART-ZOOM-01/`、`CHART-PAN-01/`、`UI-TOOLBAR-01/`、`F7-DEPS-01/`：范围、RED/GREEN、定向 journey、矩阵绑定与截图。
- `TEST-BUDGET-01/`：测试预算/清理稳定性与 release-launcher 泄漏根治（52/52、0 残留）。
- `REVIEW-FIX-01/`：14 项审查整改与对应定向复跑。

## 不稳定定位与耗时评估（2026-11-08）

- 全量 journey 可运行 235 用例；机器空闲时测试耗时合计 31.9min（wall 32.4m，≈8.1s/用例），符合仓库文档「约 30 分钟」；慢机时全 spec 均匀变慢（41.7~57.0min）。最终通过轮总耗时 53.3min（journey 45.4m），属当前机器负载下的正常区间；单 feature 轮只跑定向 journey（1~4min）。
- release-launcher 夹具泄漏：真实环境发现 4 个残留服务；根因是满载/慢健康夹具下 HTTP 探针超时被误判「身份不符」而跳过结束。已加状态文件身份兜底（appId+runId+pid），清理残留后隔离 52/52、0 残留；最终门禁后复查 0 残留。
- 其他环境 flaky：uiux-training 新悬浮面板可达性口径、chart-analysis resize 等待、weekday 周期切换刻度落定、recording-long 满载预算、全局 expect 15s、Windows 子进程清理预算——均为测试预算/等待/口径修正，**未删除断言、未跳过用例、未放宽产品判定**。

## 代码审查

- 只读子代理按工作区 code-review skill 五维清单审查 79b0f8a..9bd598d，裁决 CHANGES REQUIRED（3 major / 11 minor）。
- 全部整改进 `REVIEW-FIX-01`：创建态费率损坏 409 零写＋单测、证据收据补实、vitest 并发配置真改、e2e 恒真断言恢复、sellFee 终值取整、CSS/契约/几何细节、长时 journey 环境 flaky 收敛。
- 整改后定向检查全绿，最终 `verify:baseline` 全绿；无 blocker/major 未处理项。

## 验收清单（用户逐项 check）

完整清单见对话消息「整批验收清单」；仓库侧对应分组：

- A. F0 PR #7 合入与镜像态适配（行情条/区间统计/两点测量/真实价/视觉）
- B. F1 个性化佣金费率（设置/预设/兼容/快照冻结/取整）
- C. F2 通达信目录粘贴/手填入口
- D. F3 星期显示（日K 三处；周月K 不加；遮蔽不泄露）
- E. F4 Ctrl+滚轮缩放＋平移快捷键
- F. F5 时间轴拖动平移
- G. F6 顶栏划线开关＋可拖拽图形化悬浮工具栏
- H. F7 依赖安全升级
- I. 批次门禁与交付（build/test/docs/binding/journey/verify:baseline、审查、证据、合入/推送/1.3.4 Release/PR 与 Issue 回执）

## 交付边界

- 本记录通过工程自验，不等于用户阶段验收；用户逐项 check 通过后才执行：local main `--no-ff` 合入 → push GitHub（22 个积压提交）→ 1.3.4 + CHANGELOG + GitHub Release → PR #7/#4/#5/#6 与 Issue #8 回执。
- 已知边界：排行不按费率分组；费率不回溯历史；周/月K 不显示星期；时间轴拖动无惯性；悬浮工具面板为覆盖层（可拖拽/记忆）。
