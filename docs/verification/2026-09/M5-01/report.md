# M5-01 开发片验证报告（wt/E）

状态：**开发片实现与定向验证完成**；`api.ts`/`App.vue`/`web api.ts`/`launcher.cjs` 为集成人单写文件本轮未触碰，接线与浏览器 e2e/Journey 复跑归集成阶段。分支 `wt/E`（基线 `5bf4484`），工作树 `trainer-wt/wt-E`。

## 交付范围（本片，2026-09-29）

1. **应用偏好**：`GET/PUT /api/settings/app`（`server/src/settings/app.ts`）——`{autoDataCheck}` 单键；缺键＝内建 true（维持现状）；损坏键 GET 409 `APP_SETTINGS_UNREADABLE` 可行动不自动修复、完整合法 PUT 即修复；`BEGIN IMMEDIATE` 原子、保留其他键；形状违规 400 零写；无 TDX 可读写。**文件自上一会话未提交现场续用，本轮补齐测试。**
2. **TDX 路径设置**：`GET/PUT /api/settings/tdx-path`、`POST /api/settings/tdx-path/validate`（`server/src/settings/tdx-path.ts`，新写，RED 先行）——只复用基线 SETUP 契约（`inspectTdxCandidate`／`saveTdxChoice` 原子替换、失败保留旧选择＝路径错误可恢复）；保存不热切换本进程根，响应 `restartRequired:true`；不读环境变量、不改 SETUP 来源优先级。
3. **设置面板**（`web/src/components/TrainingSettings.vue`）：「应用偏好」开关即时保存（失败还原＋可行动错误）与「数据目录（通达信）」查看/检查/保存（问题清单、重启生效提示、离线提示）；客户端在新模块 `web/src/appSettings.ts`（本轮 `web/src/api.ts` 集成人单写故独立，集成可并入统一 request 助手）。
4. **dataStatus 门闩**（`web/src/dataStatus.ts`）：偏好关闭时自动路径（启动/回前台/60s 重判）跳过；手动路径（「更新日线」及其轮询、`checkDataStatus({force,manual})` 终态同步）保留；偏好异步预取缺省 true＝现状。

## RED 先行

- `npx vitest run server/test/settings-tdx-path.test.ts server/test/settings-app.test.ts`（实现 tdx-path 前）：settings-tdx-path **FAIL（Cannot find module '../src/settings/tdx-path.js'）**，settings-app 9/9 过——app.ts 系续用既有实现，无 RED 相位，如实记录。
- `server/test/m5-settings-frontend.test.ts` 与 `frontend-data-status-contract.test.ts` 的门闩断言随实现同步补写/更新。

## 定向验证（实现后）

- `npx vitest run --config server/vitest.config.ts server/test/settings-tdx-path.test.ts server/test/settings-app.test.ts`：**20/20 过**。
- `npx vitest run --config server/vitest.config.ts server/test/frontend-data-status-contract.test.ts server/test/m5-settings-frontend.test.ts server/test/settings-app.test.ts server/test/settings-tdx-path.test.ts`：**41/41 过**。

## 全量与构建

- `npm test`（全量）：**1194 过 / 5 失败 / 1199**（91 文件，Duration 788s，本机高负载）：
  - `runtime-isolation.test.ts > cancels an owned child command`：**已知基线确定性失败**（RUN-CANCEL-01 范围，本轮不修，按任务口径排除）。
  - `docs-tooling`（20s 超时，实际跑 56.5s）、`drawings > 256KiB wire limit`（5s 超时）、`full-acceptance > M1 data contract`（5s 超时）：负载超时抖动；**串行定向复跑 `npx vitest run ... docs-tooling.test.ts drawings.test.ts full-acceptance.test.ts` 40/40 全过**。
  - `frontend-data-status-contract > 应用启动时自动检查一次`：真实失败（签名断言未含本轮新增 `manual` 选项），已按新契约更新断言（行为契约不变：启动仍自动检查一次，仅偏好关闭时跳过自动路径）。
- `npm run build`：**通过**（vue-tsc + tsc + vite build，5.97s；chunk>500kB 提示为既有 advisory）。
- 隔离冒烟（`TRAINER_RUN_ID=wt-E`、PORT=18805、TRAINER_DB/TRAINER_STATIC_DIR/TRAINER_READY_FILE 均指本 worktree 内显式路径）：`/api/health` 200、`/api/settings/training` 200、`/api/settings/app` **404（路由注册待集成，符合预期）**；验证后进程已 taskkill，端口 18805 复测连接拒绝，确认停净。

## 边界与移交（集成阶段）

- `server/src/api.ts` 两行注册：`registerAppSettingsRoutes(app, database)`；`registerTdxPathSettingsRoutes(app, config, { dataDir: dirname(config.databasePath) })`（经统一注册自动进入 drain 门闩）。
- 可选：App 启动更早预取应用偏好（当前 dataStatus 首次自动检查前的偏好读取有尽力而为窗口，缺省 true＝现状）。
- 浏览器 e2e/Journey（含 F4 用例复跑）在集成工作树串行执行；本片未跑浏览器测试（隔离环境的 journey 需 TDX 冻结样本源，按分工不读取真实 TDX）。
- F4-launcher-initial-read-loading-owner 收尾证据与归属修正见 [M5-01 卡](../../../work-items/tasks/M5-01.md)与 [M5-DEFAULTS-01 卡](../../../work-items/tasks/M5-DEFAULTS-01.md)：缺陷实体在 web Launcher.vue（已随 7e9b046/e944958 修复），与 `scripts/release/launcher.cjs` 无关，无需补卡。
