# V1.2 验收反馈与训练时钟实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Each task ends with a focused test cycle.

**Goal:** 收敛行业排行、历史录像、成绩单、设置、股票搜索体验，并把 v0.4 计划中的开盘/收盘阶段与单条件单做成可验收的垂直切片。

**Architecture:** 服务端继续作为训练阶段、成交价格、订单状态和快捷键规则的唯一事实源；前端只负责展示和输入。行业排行、成绩单曲线和录像库分别保留独立数据边界；快捷键通过版本化设置映射注入训练页；训练阶段采用 `close_only` 向后兼容，新增 `open_close` 只对新训练生效。

**Tech Stack:** Fastify + SQLite + TypeScript、Vue 3、Vitest、Playwright、现有 `klinecharts` 与 recording codec。

**Spec:** `docs/proposals/v0.4-training-clock-orders-notes.md`、`docs/work-items/tasks/V4-01.md`、本轮用户验收批注。

## Global Constraints

- 保留旧训练和旧录像兼容；默认训练继续 `close_only`。
- 训练阶段、成交价、条件单触发和订单状态由服务端决定，前端不能伪造。
- 同一操作最多两个快捷键绑定；不同操作不得共享同一组合键；保存冲突必须拒绝且不部分写入。
- 条件单第一版仅支持单训练一个 pending、固定股数、全成全拒、日线 OHLC 近似，不实现分钟先后、OCO 或部分成交。
- 行业排行先选择行业，再显示该行业成绩；历史录像仍是浏览器本机录像，不把服务端历史训练误伪装成录像。
- 每项行为先写失败回归，再实现生产代码；提交前运行定向测试、构建和真实浏览器回归。

### Task 1: 行业排行与股票搜索交互

**Files:** `web/src/views/Rankings.vue`、`server/src/train/rankings.ts`、`web/src/views/Launcher.vue`、相关 Vitest/E2E。

- 行业模式显示 56 个行业选择列表，点击后请求 `view=industry&industry=<id>`，只渲染当前行业；提供返回行业列表入口和空态。
- 股票代码/名称搜索只显示候选，必须用户点击候选后才写入选中状态；请求等待期间显示“检索中”，失败显示可重试状态。
- 回归：行业列表/选择/返回、候选不自动选中、loading 可见、迟到请求不覆盖新查询。

### Task 2: 历史录像与成绩单布局

**Files:** `web/src/recording/recordingRepository.ts`、`web/src/App.vue`、`web/src/components/HistoryReport.vue`、`web/src/styles.css`、相关测试。

- 记录并显示录像库的存储来源、当前端口/浏览器范围和本机录像数量；历史训练数量不冒充录像数量。
- 检查 IndexedDB key/端口变化导致的读取分裂，增加稳定的数据库命名和迁移读取；旧 key 可读时合并展示并去重。
- 成绩单把收益率曲线和指数选择放在成交表之前；成交表限制高度并独立滚动，曲线不因成交笔数增长而被推到长页面末尾。
- 回归：14 局历史与 2 条录像的边界说明、旧录像 key 迁移、长成交表曲线可见、浮窗深浅主题。

### Task 3: 设置页固定箭头与快捷键自定义

**Files:** `web/src/components/TrainingSettings.vue`、`web/src/keyboardShortcuts.ts`、`web/src/views/Training.vue`、`server/src/settings/app.ts` 或现有设置存储、相关测试。

- 看涨箭头固定红色向上、看跌箭头固定绿色向下；这两项不显示颜色/线型/字号编辑器。
- 建立 `ShortcutAction` 映射和规范化组合键表示；每项最多两个绑定，冲突按规范化字符串检测，保存整体事务化。
- 训练页所有快捷键从映射读取，未配置动作使用现有默认值；输入框、弹窗、画线取点和设置弹层继续隔离快捷键。
- 回归：固定箭头无编辑控件、两个绑定保存/恢复、冲突拒绝、默认兼容、组合键触发一次。

### Task 4: TRAIN-03 阶段状态与开盘/收盘手动交易

**Files:** `server/src/db.ts`、`server/src/train/engine.ts`、`server/src/api.ts`、`web/src/api.ts`、`web/src/views/Launcher.vue`、`web/src/views/Training.vue`、相关测试。

- 迁移 `current_phase`、`clock_mode`、`current_open`；旧训练填 `close_only/close`。
- 新训练可选择 `close_only` 或 `open_close`；`next` 在 `open_close` 下按 open -> close -> next open 迁移并保持幂等。
- open 阶段只返回 open 价格，手动交易按 open；close 阶段返回完整 OHLC，手动交易按 close；T+1、费用、整手规则保持不变。
- 回归：旧训练兼容、阶段重复请求、open/close 价格、形成中数据不泄露、前端阶段标签和按钮状态。

### Task 5: ORDER-01 单条件单闭环

**Files:** `server/src/db.ts`、`server/src/train/orders.ts`、`server/src/train/engine.ts`、`server/src/api.ts`、`web/src/api.ts`、`web/src/views/Training.vue`、相关测试。

- 新增 `orders` 表和 `POST/GET/cancel` API；训练最多一个 pending，固定股数，全成全拒。
- 支持买卖限价/止损；open 跳空和 close high/low 触发遵循提案表格，成交价区分 open 缺口和 trigger 触及。
- 订单状态为 pending/filled/cancelled/expired/rejected；触发失败原因持久化；训练结束未成交订单过期。
- 订单能力默认关闭；新训练显式开启后才显示挂单入口。录制新增 `order.place/cancel/fill`，旧录像按空订单兼容。
- 回归：四种订单触发、跳空成交、close 新挂单不回填当天、T+1/现金/可卖股拒单、取消幂等和旧数据兼容。

### Task 6: 集成验收与发布

**Files:** `docs/specs/**`、`docs/work-items/**`、`e2e/**`、`.control/trainer-state.json`。

- 更新 roadmap、V4 任务卡、用户指南和统一状态事件；记录未实现或明确延期的边界。
- 运行定向 Vitest、`npm run typecheck:web`、`npm run build`、`npm run docs:check`、`npm run docs:status -- --check`。
- 隔离端口做 Playwright：行业选择、搜索候选点击、快捷键设置、open/close 训练、条件单触发、录像库、长成交成绩单和深浅主题。
- 只生成一个新输出目录，候选验收保持 `unknown`，不自动 push/tag/release。

## 当前进度

- 行业选择器、股票搜索手动确认/loading、录像库边界说明、成绩单曲线前置：已实现并通过前端契约/定向构建。
- 固定箭头样式、快捷键服务端持久化与训练页动态匹配：已实现并通过快捷键/API 定向测试。
- `open_close` 阶段、开盘/收盘手动成交、单 pending 条件单、限价/止损日线触发、取消/拒单/过期：已实现最小垂直切片，跨 API 回归已通过。
- 仍需：更新用户文档与统一状态、真实浏览器回归、提交和打包；条件单第一版仍明确不模拟分钟先后、OCO、部分成交和滑点。
