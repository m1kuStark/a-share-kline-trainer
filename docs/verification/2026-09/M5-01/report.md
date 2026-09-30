# M5-01 开发片验证报告（wt/E）

状态：**开发片实现、定向验证与 journey 定向复跑完成**；`api.ts`/`App.vue`/`web api.ts`/`launcher.cjs` 为集成人单写文件本轮未触碰，路由注册接线与完整浏览器 e2e/Journey 回归归集成阶段。分支 `wt/E`（基线 `5bf4484`），工作树 `trainer-wt/wt-E`。

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

## journey 残余返修（2026-09-30，`7559c1a`）

首轮 journey 定向复跑（TDX_ROOT＝冻结样本）暴露 2 挂 1 败，三处根因返修：

1. 弹层级 `not.toContainText('已保存')` 永假：设置面板静态文案『保存失败不会改动已保存的选择』含子串『已保存』，保存失败场景三处负向断言必挂。改文案为『…不会改动之前的选择』，契约测试 `m5-settings-frontend` 同步加负向断言（静态文案不得再含『已保存』子串）。
2. 旧单框搜索定位悬空：UI-03（基线 `58cc210`）已改双框自动选中交互，旧用例的 placeholder/结果按钮不存在。改用仓库既有双框模式（fill『股票代码，如 600519』＋断言『已选：协创数据』）。
3. F5 用例移植到 UI-03 自动预览模型：手动『生成范围预览』按钮已移除（400ms 防抖自动触发）。重写为门闩化自动预览流——旧请求在途→设置保存改复权使在途失效并自动重新生成→门闩确定性等待→释放两响应，旧响应用投毒 endDate 1999-12-31 回包，版本守卫失守即被最终断言抓获。

返修后验证（证据留存 `.runs/run-d1f3ea5c-d5dd-455f-9734-9ddefbc0c751/artifacts/journey.log`）：

- `TDX_ROOT=<冻结样本> npm run journey -- training-defaults.spec.ts`：**5/5 passed（1.0m）**，含返修 F4 modal 迟到 GET 用例与 F5 在途预览失效用例。
- `npx vitest run --config server/vitest.config.ts server/test/m5-settings-frontend.test.ts server/test/training-rules-frontend.test.ts`：契约 **14/14 过**。
- `npm run build`：通过。
- 已知差异：`training-rules.spec.ts` 的 :153/:242 弹层 alert 断言在本工作树因 `api.ts` 未接线多出两条加载错误 alert，**集成树接线后即消**；其修复①为源级＋契约级验证，门禁复跑在集成树。

## 收尾全量自测（2026-09-30，分支终态 `7559c1a`）

- `npm test`（全量）：**1194 过 / 5 失败 / 1199**（91 文件，1221s，本机负载高）：
  - `runtime-isolation > cancels an owned child command…`：**已知基线确定性失败**（RUN-CANCEL-01 范围，按任务口径排除；单独复跑确认失败模式一致——`cleanup incomplete` 而非 `/abort/i`，非本片引入）。
  - `recording-context`（1）、`setup-api`（1）、`worktree-tools`（2）共 4 例均为 5s/30s/90s 超时抖动；**串行复跑（`--pool=forks --poolOptions.forks.singleFork` 三文件）：48/48 全过**。
- `npm run build`：**通过**（vue-tsc + tsc + vite build；chunk>500kB 为既有 advisory）。
- 本轮无临时服务启动，无端口占用需要清理。

## 边界与移交（集成阶段）

- `server/src/api.ts` 两行注册：`registerAppSettingsRoutes(app, database)`；`registerTdxPathSettingsRoutes(app, config, { dataDir: dirname(config.databasePath) })`（经统一注册自动进入 drain 门闩）。
- 可选：App 启动更早预取应用偏好（当前 dataStatus 首次自动检查前的偏好读取有尽力而为窗口，缺省 true＝现状）。
- 完整浏览器 e2e/Journey 回归（`training-rules.spec` 等）在集成工作树接线后串行执行；本片已用冻结样本定向复跑 `training-defaults.spec.ts` 5/5（见上节），未读取真实 TDX。
- F4-launcher-initial-read-loading-owner 收尾证据与归属修正见 [M5-01 卡](../../../work-items/tasks/M5-01.md)与 [M5-DEFAULTS-01 卡](../../../work-items/tasks/M5-DEFAULTS-01.md)：缺陷实体在 web Launcher.vue（已随 7e9b046/e944958 修复），与 `scripts/release/launcher.cjs` 无关，无需补卡。
