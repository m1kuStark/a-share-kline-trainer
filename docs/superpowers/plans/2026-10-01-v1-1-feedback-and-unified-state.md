# V1.1 用户反馈与统一工作状态实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Each task ends with its own test cycle and commit.

**Goal:** 在保持 V1.0.3 训练规则与防未来边界的前提下，完成五组用户反馈，并把任务看板、GLM/Z code 作业、Git worktree/candidate 和文档状态收敛到一个可读写的文件状态记录。

**Architecture:** 工作空间外部的 `.control/trainer-state.json` 是唯一项目级状态文件，内部同时保存当前 projection 和 append-only `events[]`，统一记录任务、候选、作业、运行、产物和真实 Git 指针；所有写入经过 `scripts/workflow/state.ts` 的锁、版本 CAS、校验和原子替换。任务卡保留目标、范围和验收契约，`docs/status.md` 从任务卡与状态快照生成；GLM job、candidate JSON 和 DWF 运行快照变成 telemetry/evidence 适配层，不再各自定义最终状态。产品功能按 TDX 接入、历史成绩单、排行、设置布局四条可独立验证的垂直切片实施。

**Tech Stack:** Vue 3 + TypeScript + Fastify + Node 24 + SQLite + Vitest + Playwright；TDX `.day` 文件只读；Windows 原生目录选择通过现有 `/api/setup/select-directory` 端点。

**Spec:** 用户批注（2026-10-01）；现行规则见 `docs/specs/training/history.md`、`docs/specs/training/rankings.md`、`docs/engineering/controller-loop.md`、`docs/engineering/worker-contract.md`。

## Global Constraints

- 保留 T+1、整手 100 股、当日收盘成交、训练可见区间截断和历史防未来守卫。
- 通达信目录只读；本轮移除自动发现和自动扫描，首次连接由用户通过 Windows 目录选择器确认路径。
- 成绩单、排行和收益率曲线只读取已结算训练的持久事实；指数曲线缺失时显示不可用原因，不填零、不猜测。
- 历史删除只允许用户明确确认已结算/已放弃记录；运行中训练和当前训练守卫不可被删除接口绕过。
- 统一状态文件不保存个人绝对路径、凭据、完整模型对话或原始行情；工作树使用 `main`、`int-v1`、`wt/<task>` 等别名，运行日志和认证证据继续放在工程外缓存。
- 不自动 push、tag、merge 或公开发布；候选晋升与发布仍由用户控制。
- 每个行为切片先写失败测试，再写最小实现；每个任务完成后执行 `npm run docs:status -- --check` 和相关回归。

---

### Task 1: 建立统一工作状态文件与读写库

**Files:**
- Create: `D:/Superlinear_Academy/Stock_Workspace/.control/trainer-state.json`
- Create: `scripts/workflow/state.ts`
- Create: `scripts/workflow/state-cli.ts`
- Create: `scripts/workflow/README.md`
- Test: `server/test/workflow-state.test.ts`
- Modify: `package.json`（增加 `workflow:state` 命令）
- Modify: `docs/engineering/controller-loop.md`、`docs/engineering/worker-contract.md`

**Interfaces:**
- `readWorkflowState(controlRoot): Promise<WorkflowState>`：读取并校验唯一快照。
- `updateWorkflowState(controlRoot, mutation): Promise<WorkflowState>`：在 `.trainer-state.lock` 下读取、校验、追加事件、原子替换快照。
- `recordWorkflowEvent(controlRoot, event): Promise<WorkflowEvent>`：向 NDJSON 追加并按 `event_id` 幂等；同 ID 不同内容拒绝。
- 快照至少包含 `schema_version`、`state_revision`、`project_id`、`active_task`、`candidate`、`runs`、`artifacts`、`acceptance`、`events`、`next_action`、`updated_at`；事件绑定 `task_id`、`attempt_id`、`commit`、`tree`、`worktree_alias`、`run_id`、`artifact_id`。

- [ ] **Step 1: 写状态 schema 的失败测试**：覆盖缺字段、未知状态、重复事件、非有限数、路径为个人绝对路径、并发写锁。
- [ ] **Step 2: 运行 `npx vitest run server/test/workflow-state.test.ts` 确认 RED**。
- [ ] **Step 3: 实现 JSON 校验、锁、临时文件 `wx` 写入、`rename` 原子替换和事件去重**。
- [ ] **Step 4: 实现 CLI：`read`、`event`、`task set`、`job set`、`candidate set`、`reconcile`，所有命令输出当前状态摘要和 `updated_at`**。
- [ ] **Step 5: 运行状态单测，并用临时 Git 夹具验证两次相同事件不会重复计数**。
- [ ] **Step 6: 提交 `feat: add canonical workflow state store`**。

### Task 2: 把看板、候选和文档状态接入统一快照

**Files:**
- Modify: `scripts/worktree/state.ts`、`scripts/worktree/workflow.ts`
- Modify: `scripts/agent-monitor/run_glm.py`、`scripts/agent-monitor/monitor.py`
- Modify: `.zcode/workflows/trainer-v1-parallel-pipeline.dwf.ts`（仅读写统一状态，不再固定旧版本/旧输出目录）
- Modify: `scripts/docs/status.ts`、`scripts/docs.ts`
- Modify: `docs/work-items/current-feature.json`（迁移为兼容只读输入）
- Test: `server/test/worktree-tools.test.ts`、`server/test/workflow-state.test.ts`、`scripts/agent-monitor/test_run_glm.py`

**Interfaces:**
- candidate 生命周期 `prepared/failed/verified/promoted/cleaned` 写入同一 `candidates[id]` 并追加事件。
- GLM job `starting/running/completed/failed/waiting_control` 写入同一 `runs[]`；原 `jobs/<batch>.json` 保留为 telemetry 登记和兼容读取，不再作为项目状态权威。
- `docs:status` 使用任务卡的静态契约和 `workflow-state.json` 的当前状态合成摘要；状态不一致时报告 `ERROR state-drift`，不自动猜测。

- [ ] **Step 1: 为 candidate、GLM job 和 docs status 各写一条状态漂移失败测试**。
- [ ] **Step 2: 运行现有 worktree/monitor/docs 测试确认 RED 或暴露兼容断言**。
- [ ] **Step 3: 在候选生命周期和 GLM runner 的状态变更点调用 state CLI；事件带真实 SHA、worktree 和 job/batch ID**。
- [ ] **Step 4: 增加 `reconcile`：读取真实 `git status`、`git rev-parse`、注册 worktree 和 job 文件，只能把可证明事实写入快照；未知情况转 `waiting_control`**。
- [ ] **Step 5: 运行 `npm test -- --runInBand` 的相关文件、`python -m unittest scripts/agent-monitor/test_run_glm.py`、`npm run docs:status -- --check`**。
- [ ] **Step 6: 提交 `feat: unify workflow, candidate and board state`**。

### Task 3: 简化通达信连接为用户确认路径流程

**Files:**
- Modify: `server/src/config.ts`、`server/src/tdx/discover.ts`、`server/src/setup/saved-choice.ts`
- Modify: `server/src/api.ts`、`web/src/App.vue`、`web/src/api.ts`
- Modify: `web/src/styles.css` 或对应 scoped style
- Test: `server/test/setup-onboarding.test.ts`、`server/test/settings-tdx-path.test.ts`、`e2e/data-update.spec.ts`
- Update: `docs/specs/market-data/requirements.md`、`docs/user/install.md`、`docs/user/troubleshooting.md`

**Behavior contract:**
- 独立启动只读取显式 `TDX_ROOT`、显式配置或已保存用户选择；删除默认候选自动扫描和启动时自动发现。
- 顶部“连接通达信”直接打开 Windows 原生目录选择器；取消不弹复杂配置框、不写路径。
- 用户确认目录后，服务端立即校验 `vipdoc`、`T0002`、日线、权息和名称；成功保存并刷新连接状态，失败保留原配置并提示检查目录结构。
- 成功/失败提示使用主题变量，浅色和深色模式下文字、输入框、错误背景均满足对比度要求。

- [ ] **Step 1: 写“无自动发现、直接选择、失败保留旧选择、成功更新状态”的服务端测试**。
- [ ] **Step 2: 运行 setup/settings 测试确认 RED**。
- [ ] **Step 3: 移除 `defaultTdxCandidates()` 的独立启动路径和自动候选列表 UI；保留手动 inspect/save/apply 控制流**。
- [ ] **Step 4: 将顶部按钮改为直接调用 `selectSetupDirectory()`，把选择结果送入 inspect/save；错误状态保留可重试按钮**。
- [ ] **Step 5: 用 Playwright 在深色、浅色、桌面和 390px 宽度验证连接成功、失败、取消和文字对比度**。
- [ ] **Step 6: 提交 `feat: make TDX connection user-confirmed`**。

### Task 4: 历史训练删除、成绩单浮窗与收益率比较曲线

**Files:**
- Modify: `server/src/api.ts`、`server/src/train/history-report.ts`、`server/src/db.ts`
- Create: `server/src/train/history-delete.ts`、`server/src/train/equity-comparison.ts`
- Modify: `server/src/train/benchmark.ts`、`web/src/api.ts`
- Modify: `web/src/views/History.vue`、`web/src/views/Rankings.vue`、`web/src/components/HistoryReport.vue`
- Test: `server/test/history-report.test.ts`、`server/test/history-delete.test.ts`、`server/test/equity-comparison.test.ts`
- E2E: `e2e/m4-history.spec.ts`、`e2e/m4-rankings.spec.ts`
- Update: `docs/specs/training/history.md`、`docs/specs/training/rankings.md`

**Interfaces:**
- `DELETE /api/trainings/:id`：仅 settled/abandoned；运行中 409；显式事务删除 trades、equity_curve、position_events、drawings、training。
- `DELETE /api/trainings` body `{ ids: number[] }`：最多 100 个、全部逐项校验、原子事务、返回 `{ deletedIds, rejected }`。
- `GET /api/trainings/:id/equity-comparison?benchmarks=sh000001,sz399303`：返回按日期对齐的用户收益率、上证指数和国证 2000 收益率，缺失指数逐项返回原因。
- `HistoryReport` 以固定尺寸 modal 渲染，历史页和排行页共用；右上角关闭，点击背景和 `Escape` 也关闭。
- 报告移除“画线标注”列表；K 线复盘继续使用同一份只读画线叠加。
- 曲线显示时间轴、百分比纵轴；用户收益率红色，指数使用蓝/橙色，不使用绿色。

- [ ] **Step 1: 写删除权限、批量原子性、基准对齐和 modal 交互的失败测试**。
- [ ] **Step 2: 运行历史/排行单测与 E2E 确认 RED**。
- [ ] **Step 3: 实现删除事务和 API，补数据库外键/显式清理以兼容旧库**。
- [ ] **Step 4: 实现指数比较读取器，支持 `sh000001.day` 与 `sz399303.day`，严格按训练起止日期向后对齐**。
- [ ] **Step 5: 将 HistoryReport 改为 fixed modal，增加批量选择/删除确认和排行点击复用**。
- [ ] **Step 6: 用 SVG 坐标轴渲染收益率曲线和可选指数线，处理单点、空数据、负收益和主题颜色**。
- [ ] **Step 7: 运行 server tests、`e2e/m4-history.spec.ts`、`e2e/m4-rankings.spec.ts` 和双主题截图检查**。
- [ ] **Step 8: 提交 `feat: improve history report and equity comparison`**。

### Task 5: 自定义范围排行分组与行业排行数据模型

**Files:**
- Modify: `server/src/train/rankings.ts`、`server/src/api.ts`、`server/src/config.ts`
- Create: `server/src/train/ranking-groups.ts`、`server/src/tdx/industry.ts`
- Modify: `server/src/db.ts`、`web/src/api.ts`、`web/src/views/Rankings.vue`
- Test: `server/test/rankings.test.ts`、`server/test/industry.test.ts`
- E2E: `e2e/m4-rankings.spec.ts`
- Update: `docs/specs/training/rankings.md`、`docs/specs/market-data/requirements.md`

**Interfaces:**
- 自定义排行组键为 `RANGE:<range_start>:<range_end>`，只允许起止日期完全相同的已结算训练互相排序；不混入五档周期。
- `GET /api/rankings?view=tier&tier=...` 保留现有五档兼容；`view=range` 返回自定义日期组；`view=industry&industry=<id>` 返回行业组。
- 行业目录是独立、版本化、只读的 56 行业映射；股票无映射时明确显示“未分类”，不猜测归属。来源文件和哈希写入数据状态，不混入用户训练库。
- 行业排行按用户已结算训练的股票行业归属分组，保留完整/提前结算二组和既有指标排序；缺失行业目录时整个视图不可用并说明原因。

- [ ] **Step 1: 写 RANGE 日期组、同组过滤、行业目录缺失和稳定排序测试**。
- [ ] **Step 2: 运行现有 rankings/TDX 测试确认 RED**。
- [ ] **Step 3: 实现日期组键与 API query parser，保持旧 `tier` 请求完全兼容**。
- [ ] **Step 4: 实现行业目录加载、校验、哈希和缓存；先接收明确的 TDX 行业映射文件，不扫描未知目录猜测 56 板块**。
- [ ] **Step 5: 实现排行页面模式切换、日期组选择、行业选择、空态和不可用态**。
- [ ] **Step 6: 点击排行行继续打开同一成绩单 modal，并保持删除/关闭行为一致**。
- [ ] **Step 7: 运行服务端、E2E、深浅主题和移动宽度检查**。
- [ ] **Step 8: 提交 `feat: add custom range and industry rankings`**。

### Task 6: 设置面板稳定尺寸与主题可读性

**Files:**
- Modify: `web/src/components/TrainingSettings.vue`、`web/src/styles.css`
- Test: `server/test/m5-settings-frontend.test.ts`
- E2E: 新增 `e2e/settings-visual.spec.ts`
- Update: `docs/specs/settings.md`（若不存在则在 `docs/specs/README.md` 增加入口）

- [ ] **Step 1: 写设置面板切换后固定 viewport、固定 content min-height、无布局跳动和深浅主题颜色断言**。
- [ ] **Step 2: 使用固定面板外框高度与内容滚动区；导航和关闭按钮位置不随 tab 改变**。
- [ ] **Step 3: 统一输入框、错误、帮助文本、按钮颜色到主题变量；删除硬编码低对比度颜色**。
- [ ] **Step 4: 在桌面/390px、深色/浅色四种组合运行 Playwright 截图和 bounding-box 稳定性检查**。
- [ ] **Step 5: 提交 `fix: stabilize settings panel layout and theme contrast`**。

### Task 7: 文档、证据、候选包和清理策略

**Files:**
- Modify: `docs/status.md`（只由生成器写入）、`docs/work-items/README.md`
- Modify: `docs/work-items/tasks/` 对应任务卡、`docs/specs/README.md`、`docs/proposals/README.md`
- Create: `docs/verification/2026-10/V1.1-feedback/README.md`
- Modify: `scripts/release/build.mjs`（只保留一个明确的最终输出目录策略，不生成重复备份目录）
- Update: `.gitignore` 或 release README，说明 `.runs` 和输出目录的保留/清理边界

- [ ] **Step 1: 每个任务写 verification 记录：命令、退出码、提交、数据范围、截图和已知限制**。
- [ ] **Step 2: 运行 `npm run docs:impact`、`npm run docs:status -- --check`、`npm run docs:check`**。
- [ ] **Step 3: 发布只使用一个显式 `output/v1.1-<date>` 目录；失败运行证据留在一个 `.runs/run-<id>`，成功后按清单清理中间解压目录，不复制多个“accept/final/verify”目录**。
- [ ] **Step 4: 运行完整单测、生产构建、Journey、包内 verify、包启动/停止和最终 SHA256 校验**。
- [ ] **Step 5: 提交文档/证据变更，等待用户手动验收；不自动 push 或发布 GitHub Release**。

## Implementation Order

1. Task 1 and Task 2: canonical state and adapters. These are prerequisites for all later work and make progress auditable.
2. Task 3: TDX user-confirmed connection. It removes the current automatic discovery behavior and stabilizes the data prerequisite for local testing.
3. Task 4: history/report deletion and comparison curve. It creates the shared report modal later reused by rankings.
4. Task 5: custom-range and industry ranking data contracts, then UI.
5. Task 6: settings visual stabilization and theme regression.
6. Task 7: documentation, evidence, single-output packaging and cleanup.

## Acceptance Gates

- **State gate:** `workflow-state.json` is readable, schema-valid, event-idempotent, and reconciles task cards, job files, candidate refs and current Git without guessing.
- **TDX gate:** no default candidate scan; native folder selection succeeds/fails with actionable status in both themes; saved path survives restart.
- **History gate:** single/batch deletion is confirmed and atomic; report modal works from history and ranking; no drawings list remains; curve axes and optional index lines are correct.
- **Ranking gate:** existing five-tier API remains compatible; custom range groups require exact start/end match; industry mode reports source/version/missing mappings honestly.
- **Visual gate:** settings and report modal have stable dimensions across tabs, desktop/mobile and light/dark themes; no text/input contrast regression.
- **Release gate:** one final output directory, one manifest, one SHA256 record, clean worktree, package verify passes, and user acceptance remains separate from engineering verification.

## 本轮执行记录（2026-10-01）

| 批次 | 状态 | 已完成事实 | 尚未完成 |
|---|---|---|---|
| 统一状态 | 已落地基础层 | `.control/trainer-state.json`、锁、版本递增、事件幂等、CLI、status overlay 已可读写；任务卡、看板、worktree 和 zcode 报告改为视图/证据边界。 | GLM/DWF 全部适配器仍需按 ORCH-STATE-01 单独收口，不能把现有状态文件存在误写成全自动同步。 |
| TDX 接入 | 已修订 | 顶栏与设置入口直接调用用户确认的 Windows 原生目录选择；取消自动发现/默认目录扫描；选择期间页面阻断，失败保留状态。 | 真机用户仍需验收目录选择器置顶、路径有效性和重启后连接。 |
| 成绩单 | 已修订 | 浮窗单出口、深浅主题、规则 Tag、统一收益率/指数 SVG、日期/百分比轴、悬停提示、独立复选框和日期对齐回归已完成。 | 用户验收；基准数据覆盖仍受本机 TDX 文件完整性限制。 |
| 排行/设置 | 已在候选 | 自定义起止日期、行业不可用态、历史删除、设置标签和稳定布局沿用候选实现，文档已同步当前口径。 | 本轮未扩展排行/设置业务范围；需要用户对完整 V1.1.1 包验收。 |
| 交付 | 待执行 | 版本已提升到 1.1.1；发布脚本拒绝复用旧输出目录，计划只生成 `output/v1.1.1-20261001`。 | 干净提交后的 Windows 包、manifest、SHA256、包内启动/停止和最终状态回填。 |

执行顺序固定为：先完成代码与定向回归，再运行 docs/status 生成器和完整门禁；门禁通过后只构建一个最终输出目录，最后把用户验收保留为 `unknown` 交给人工验收，不自动 push、tag 或发布。
