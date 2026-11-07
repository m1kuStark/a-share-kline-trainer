# CHART-WEEKDAY-01 验证记录（2026-11-07）

任务：日K 悬浮卡/时间轴/状态条显示中文星期（Issue #8-C，用户 2026-11-07 拍板）
基线：`dac4c95`（SETUP-PASTE-01）｜工作树 `verify-pr7`
证据提交：本记录随 `feat(chart): CHART-WEEKDAY-01 …` 提交

## 改动摘要

- 新增纯函数模块 `web/src/dateLabels.ts`：`weekdayLabel` / `withWeekday` / `decorateAxisLabel`——ISO 日线日期按 UTC 日历给出中文星期；周/月键与非法日历日（如 2026-02-30）不臆造；遮蔽空文本原样。
- `web/src/components/KlineChart.vue`：X 轴 formatter 在日K且刻度命中真实 bar 日期时追加星期（遮蔽态仍空文本、揭示态先按既有常量差换算）；悬浮卡日期行追加星期（周/月K不加、遮蔽态仍星号）；新增时间戳→bar 日期映射，保持既有轴锚定语义。
- `web/src/views/Training.vue`：底部状态条「可见至/末根」日期经 `withWeekday`（仅日K；遮蔽仍星号）；常驻行情条通过悬浮卡模型自动获得星期。
- 文档：`docs/specs/chart/display.md`、`docs/user/chart-analysis.md` 增补星期口径；矩阵 `chart-weekday.yaml` 4 行。
- 既有 e2e 对日期文本的断言同步为「日期＋星期」（percent-hover、random-mask-axis 遮蔽/揭示/结束/随机股票 4 条），不放松遮蔽断言。

## 门禁收据（最终一轮）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build` | **0** |
| `npm test` | **0**：server 174 文件 / 2599 用例；desktop 34 文件 / 367 用例全部通过 |
| `npm run docs:check` | **0 errors** / 145 warnings |
| `npm run docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base dac4c95 --task CHART-WEEKDAY-01` | **0 errors** |
| `check-binding --matrix chart-weekday.yaml --strict --include-untracked` | **4/4 covered，RED=0，open=0** |
| `npm run journey -- e2e/weekday-display.spec.ts e2e/random-mask-axis.spec.ts e2e/percent-hover.spec.ts --retries=0` | **0**：7/7 通过（59.7s，run `run-4ec5a518`） |

## 失败与修复（如实保留）

1. 首轮纯函数测试：`2026-02-30` 被 Date 滚动到 3 月并返回星期 → 增加回写校验（toISOString 日期段必须等于输入），非法日历日不臆造。
2. 首轮 journey：percent-hover 补丁因替换串中的正则转义被 `$&` 展开损坏文件 → 从 HEAD 恢复后改为函数替换并逐行校验；random-mask-axis 遮蔽/揭示/结束/随机股票 4 处仍按旧纯日期断言 → 统一为「日期＋可选星期」并剥离星期后再做偏移换算。
3. 上述修复后最终 journey 7/7 通过（含既有遮蔽 e2e 全绿）。
4. 全量并行门禁首轮出现既有 `train-range-preview` 并发用例默认 5s 超时（真实 SQLite 双请求竞争；隔离复跑 36/36 通过）→ 按 settings-training/review-profile/worktree-tools 既有先例把该文件真实 I/O 预算放宽到 20s（断言与产品语义不变，文件列入任务 allowed_paths 并记入 docs_impact reason）；复跑全量 2599/2599 通过。

## 视觉检查（主代理，真实页面截图）

- X 轴刻度实际渲染为 `2025-09-29 周一` / `2025-11-10 周一` / `2025-12-12 周五` / `2026-01-19 周一` / `2026-03-02 周一` / `2026-04-03 周五`，无重叠/溢出。
- 状态条：`日K 2026-04-15 周三 … 可见至 2026-04-15 周三`；悬浮卡截图日期行含星期。
- 1440/1280 深浅截图：[weekday-status-1440-dark.png](weekday-status-1440-dark.png)、[weekday-status-1280-dark.png](weekday-status-1280-dark.png)、[weekday-hover-card-1440-dark.png](weekday-hover-card-1440-dark.png)。
- 周K切换后状态条与轴均无星期后缀；无 pageerror、无横向溢出。

## 已知边界

- 仅日K追加星期；周K/月K 保持原日期形态（周/月键无单一日内星期语义）。
- 随机时间遮蔽态继续只显示星号（不显示星期），揭示后按既有常量差换算再加星期。
- 纯展示层：交易、结算、录像与画线持久面零改动。
- 本记录为用户整批验收前的工程证据，不代表用户验收。
