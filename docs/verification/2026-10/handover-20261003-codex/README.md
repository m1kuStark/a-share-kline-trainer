# 交接：zcode → Codex（2026-10-03）

上一会话（zcode）完成了 V1.2.5~V1.2.7 三轮修订、v1.2.6 发布与清理归档、v1.2.7 修复再发布。本文档面向 Codex 新会话，给出当前基线、关键实现事实、工程约定变化与待办。读完后按 `next_action` 接续。

## 当前基线（唯一事实源）

- **main = origin/main = 81be8ef = tag v1.2.7 = GitHub Release v1.2.7**（Release 402384887，zip sha256 `67781f8d…`，GitHub digest 与本地一致）。
- **v1.2.6 的 Release 已删除（tag 保留）**：该包首次配置必触发受控重启缺陷（见 V1.2.7 修复记录）。Release 页已注明。
- 开发基线＝**主检出 `a-share-kline-trainer` 的 main 分支**。int-v1 集成树与其余 42 个 worktree、62 个旧分支已清理；历史验收包归档在 `trainer-releases/archive-20261002/`（工作区级，不入库）。
- 统一状态文件 `.control/trainer-state.json`（工作区级）当前 revision 33，接续以它的 `next_action` 为准。
- 用户对 v1.2.7 包的验收**尚未回流**（v1.2.6 验收通过的部分：条件单语义＋数据目录，随 v1.2.6 包确认；v1.2.7 新增的首配修复待从零首配复验）。

## 本会话三轮修订速览

| 版本 | 内容 | 提交 | 验证记录 |
|---|---|---|---|
| V1.2.5 | 条件单触发语义修订（到价才触发） | c062971 | [V1.2.5-order-semantics](../V1.2.5-order-semantics/README.md) |
| V1.2.6 | 训练数据目录设置＋默认包内 data（版本独立）；随后发布 v1.2.6 并完成 GitHub 推送/清理归档；README 按发布基线重写 | 36319a9 / f6eeaab | [V1.2.6-data-dir](../V1.2.6-data-dir/README.md) |
| V1.2.7 | 首配受控重启修复（CLI 装配层字段断链＋终态兜底）；v1.2.6 release 撤下、v1.2.7 发布 | 220ed0c / 81be8ef | [V1.2.7-setup-restart-fix](../V1.2.7-setup-restart-fix/README.md) |

## Codex 接续开发必须知道的实现事实

### 条件单语义（V1.2.5 起，v0.4 设计文档已同步修订）

- 触发方向挂单时冻结在 `orders.trigger_direction`（'up' 上触 / 'down' 下触，按触发价 vs 当前阶段价）；旧行 NULL 按经典矩阵推导（`legacyTriggerDirection`）。
- 限价按触发价成交（跳空越过且不可成交时保持挂单）；止损按当日收盘价成交（跳空按开盘价）。撮合逻辑集中在 `server/src/train/engine.ts` 的 `processPendingOrders`。
- 回归：`server/test/conditional-orders.test.ts`（7 例）；e2e `order-panel.spec.ts`。**改撮合语义必须同步设计文档语义表**（docs/proposals/v0.4-training-clock-orders-notes.md）。

### 训练数据目录（V1.2.6 起）

- `GET/PUT /api/settings/data-dir`（server/src/settings/data-dir.ts）：写回 trainer.config.json 的 dataDir（原子合并保留 tdxRoot/port、清 databasePath 覆盖）；独立运行（无 TRAINER_CONFIG_PATH）PUT 409。
- launcher 默认 dataDir＝**包根 `data`**（版本独立）；TRAINER_CONFIG_PATH 在 launch 与受控重启两条链路注入。
- 排行/历史/成绩单复盘读 config.databasePath，路径切换自动跟随；录像仍在浏览器 IndexedDB（不受此设置影响）。
- 未决产品问题：旧主目录（`~/.a-share-kline-trainer`）数据是否要做自动迁移向导——面板目前只给文案提示，待用户拍板。

### 受控重启链（V1.2.7 修复后）

- 真实链路：服务端 `spawnRestartSupervisor` → `node launcher.cjs --setup-restart-attempt <path>` → `main()` → `runSetupRestartAttempt`。**main 装配层现在有 2 条 CLI 回归**（release-launcher.test.ts「CLI assembly」组）；makeFixture 会从 `server/dist/setup/` 拷 restart-plan.js——**跑该测试文件前需 `npm run build:server`**。
- main 外层 catch 对 supervisor 场景写 `phase=failed, done=true` 终态兜底；新增 supervisor 相关改动时保持该语义。
- 用户测试现场参考：`D:\MySoftWares\kline-trainer-v1.2.6-windows-x64`（v1.2.6 包，data 内有缺陷现场证据）。

### 发布流程事实（无 gh CLI 的机器）

- push：`git push origin main <tag>`（本机到 GitHub 偶发连接重置，重试即可）。
- Release/资产：`git credential fill` 取凭据 → curl 调 GitHub API（创建 release → uploads 上传 zip/SHA256SUMS，用 release id）；上传后核对 API 返回 digest 与本地 sha256。
- 打包：`node --import tsx scripts/release/build.mjs --node-archive .runs/node-archive-cache/node-v24.15.0-win-x64.zip --node-checksums .runs/node-archive-cache/SHASUMS256.txt --out <D:\Superlinear_Academy\Stock_WorkSpace\output\vX.Y.Z-日期>`；要求工作树干净。
- **打包预检会校验 README 相对链接**（包内只带 docs/user）：指向 docs/proposals、CHANGELOG 等包外目标必须用 GitHub 绝对链接（v1.2.7 曾因此构建失败一次）。

## 待办（按优先级）

1. **用户验收 v1.2.7 回流**：重点从零首配（全新目录解压→Start.cmd→配置 TDX→自动切换到已连接）。问题回流即建返修卡；通过则回填验收记录。
2. **E2E-BASELINE-01**（planned）：19 项存量浏览器回归失败清偿（清单在卡内；全套自 v1.2.3 起可运行，19 项经 stash 基线证实非新回归）。vitest 另有约 10 项存量环境抖动（db-migration/recording/data-refresh 域）。
3. **V4-01 剩余**：条件单订单事件的录制与完整回放（REC-04 关联）。
4. **V1-RECONCILE-01**：主检出/集成树协作文档双仓对账；素材已冻结在分支 `docs/archive-pre-v126-merge-20261002`（43 项未提交文档的归档提交）。
5. 小项：旧主目录数据迁移向导（待拍板）；`trainer-worktrees` 空壳目录（被并行 shell 占用，重启会话后手删）。

## 阅读链与状态

新会话按序读：`docs/status.md` → 本文档 → `.control/trainer-state.json` → 相关任务卡。工作树必须保持 clean（打包硬门槛）；`docs:check`/`docs:status` 在任务/阶段变化后运行。
