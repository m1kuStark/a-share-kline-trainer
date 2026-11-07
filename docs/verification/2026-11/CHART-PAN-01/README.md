# CHART-PAN-01 验证记录（2026-11-07）

任务：底部时间轴普通左键拖动平移（Issue #8-D M 半，计划拍板）
基线：`4a8f44e`（CHART-ZOOM-01）｜工作树 `verify-pr7`
证据提交：本记录随 `feat(chart): CHART-PAN-01 …` 提交

## 改动摘要

- `web/src/components/KlineChart.vue`：新增 `timeAxisPan` 手势——普通左键在 `x_axis_pane` 按下时于 pointerdown capture **最先裁决并独占**本次手势；移动按像素 `scrollByDistance(dx,0)` 平移（拖右看更早、拖左看更新），同屏根数不变；pointerup 释放并上报录像视窗。悬停时间轴 `cursor: grab`、拖动中 `grabbing`。修饰键/绘图取点/多选/分隔条/框选/测量/价格轴缩放均不启动该手势，既有优先级不变。只读回放（readOnly）不限制平移。
- 新增只读探针 `paneRects`（主图与时间轴 pane 矩形，仅测试读取）。
- 文档：`docs/specs/chart/display.md`、`docs/specs/chart/interaction.md`（CHART-PAN-01 仲裁）、`docs/user/README.md`、`web/src/components/docs/interaction.md`（事件仲裁第 7 条；未新增监听器，沿用既有 window pointermove/up 生命周期）。
- 矩阵 `chart-gestures.yaml` 增补 3 行；frontend-contract 增加时间轴独占/像素平移/释放契约断言。

## 门禁收据（最终一轮）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build` | **0** |
| `npm test` | **0**：server 174 文件 / 2602 用例；desktop 34 文件 / 367 用例全部通过 |
| `npm run docs:check` / `docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base 4a8f44e --task CHART-PAN-01` | **0 errors** |
| `check-binding --matrix chart-gestures.yaml --strict --include-untracked` | **8/8 covered，RED=0，open=0** |
| `npm run journey -- e2e/chart-time-axis-pan.spec.ts --retries=0` | **0**：2/2 通过（16.3s，run `run-b8b671fd`；含只读回放） |

## 失败与修复

1. 手势方向按 klinecharts `scrollByDistance` 语义校准：正距离＝视窗左移（看更早），拖右 `dx>0` 直接传入；e2e 以 `realTo` 方向与 `count` 不变锁定。
2. 初版用多行字符串替换实现，CRLF 下部分替换未命中 → 改为逐行插入；typecheck 0、e2e 首次通过。
3. 手势仲裁 e2e：Shift+时间轴拖动零位移、图表区左键拖动仍出现 `.select-rect`；只读回放导入录制后拖动可平移且无 pageerror。
4. 全量门禁稳定性：Windows/Node24 并行满载下多次遇到既有环境性 flaky（runtime-isolation 子进程清理确认超时、worktree-tools/review-profile hook 超时、release-launcher readiness 超时）与一次进程级崩溃（exit -1073740791，无断言失败）——隔离复跑均通过。按既有先例：worktree-tools hook 30s→90s、review-profile hook 15s→45s，并把 `server/vitest.config.ts` maxWorkers 4→2 稳定门禁（断言与测试集合不变）；最终全量 2602/2602 + 367/367 通过。

## 视觉检查（主代理）

- 1440 深色：[time-axis-pan-1440.png](time-axis-pan-1440.png)，1280 深色：[time-axis-pan-1280.png](time-axis-pan-1280.png)：时间轴平移后 K 线/状态条/轴标签正常，无溢出；拖动状态由 e2e 断言 host cursor=grab/grabbing。
- 回放截图未单独落盘（e2e 断言关闭回放入口仍在、无 pageerror）。

## 已知边界

- 时间轴拖动无惯性；拖出边界由库留白/最小根数钳制。
- 只读回放同样可平移，但不产生任何画线/数据写请求。
- 本记录为用户整批验收前的工程证据，不代表用户验收。
