# TDX-RECONNECT-01 验证记录：设置页 TDX 路径保存后受控重启立即生效

- 任务：TDX-RECONNECT-01（worktree `D:/tmp/tdxflow01`，分支 `tdx-reconnect`，base=main@d0e9084）
- 矩阵行：`TDX-SETTINGS-APPLY-RESTART`（tdx-settings.yaml，orchestrator 预登记 planned，本任务禁写矩阵）
- 日期：2026-10-13 | 执行：zcode subagent

## 0. 锚定与偏差

- manifest 脚本读仓库内任务卡，而任务卡由 orchestrator 放在主仓库
  （`a-share-kline-trainer/docs/work-items/tasks/TDX-RECONNECT-01.md`），worktree 内不存在 →
  `task-manifest.mjs --repo D:/tmp/tdxflow01 --task TDX-RECONNECT-01` exit 1。
  以主仓库任务卡＋派发简报＋预登记矩阵行为锚定替代，锚点问题已在会话内回答。
- 本轮不跑 e2e/journey（派发约束：与其他并行任务共用端口），e2e 缺口登记于 §6。

## 1. 选型依据（RED 前论证，binding_note 要求）

两案：A＝分栏保存后由前端编排走 SETUP 受控重启链；B＝PUT /api/settings/tdx-path 服务端语义升级为保存+apply 一体。**选 A**，理由：

1. **apply 链对「已运行服务＋已有数据」幂等可重复**（读 `server/src/api.ts` L494-585 与 `server/src/setup/restart-plan.ts` 确认）：
   - `/api/setup/apply` 守卫不含任何「首配」条件：只查 `config.runId`（启动器托管）、`tdxSource` 非 env/explicit-config、无活动训练、`TRAINER_LAUNCHER_CJS` 存在且可访问。v1.2.7 仅首配使用是产品入口路径事实，不是机制限制——顶栏「连接通达信」在 disconnected/unavailable 时就是运行中重连入口。
   - 防重入：`restartAttemptActive` 对未 done 的同 attempt 拒 409 CONTROL_BUSY；读到 `done:true` 后清空放行新 attempt（每次新 attemptId＋新 target runId）→ 可重复调用安全。
   - `restart-plan.ts` 的 `plannedBoundaryReason` 锁定 planned dataDir/databasePath/port/origin 与旧运行一致——已有 SQLite 训练库不迁移、不换端口，仅换 tdxRoot（explicit-env 继承）；`previousSavedChoice` 全程保留，失败走 restore-old-config → rolled-back/restore-failed 终态（回滚语义满足矩阵行 IF 分支）。
2. **apply 不隐式落盘的冻结约束决定编排顺序**：apply 要求本进程 `lastSavedChoice`（POST /api/setup/save-choice 设置）＋磁盘 saved-tdx-choice.json 与请求一致（`SETUP_SAVE_MISMATCH` 409）。PUT /api/settings/tdx-path 不设置该内存状态。方案 A 下分栏改调 `saveSetupChoice`（save-choice 端点）恰好满足约束且与向导逐字同序；方案 B 需把 api.ts 闭包状态（lastSavedChoice/restartAttemptActive/spawnRestartSupervisor）抽出重构给 tdx-path.ts 复用——触碰 SETUP-01 冻结受理代码，且 PUT 端点的 admission 语义（统一注册进 draining 503 门闩）与 setup 受保护守卫不同，合一引入安全语义模糊，改动面/回归风险与收益不成比例。
3. **体验基准复用**：矩阵 oracle 即「App.vue saveAndApplyWizard 既有行为」。分栏复用同一编排语义（save→availability→apply→120×700ms 轮询→ready 刷新）是对齐的最大保证。
4. YAGNI：服务端零改动（tdx-path.ts 保留 PUT 作为兼容 API，不做删除——删除已发布端点是独立行为变化需另行拍板）。改动集中 web 前端三文件。

## 2. RED（正确原因失败收据）

测试先写：`server/test/m5-settings-frontend.test.ts` 新增两 describe（runTdxApplyFlow 可执行编排 5 用例＋分栏接线源形状 2 用例），并修订 M5-01 既有断言 2 处（见 §5）。

```
cd D:/tmp/tdxflow01
npx vitest run --config server/vitest.config.ts server/test/m5-settings-frontend.test.ts
→ Tests  9 failed | 2 passed (11)   EXIT=1
```

失败全部为「缺新行为」，无语法/环境错：
- 5× `TypeError: runTdxApplyFlow is not a function`（新导出缺失）
- 2× 源形状接线缺失（TrainingSettings.vue 无 runTdxApplyFlow/emit；App.vue 无 @tdx-connected）
- 2× 修订后的负向断言失败（appSettings.ts 仍含旧 TdxPathSaveResult 语义；面板仍含「重启应用后生效」文案）

## 3. GREEN（最小实现）

| 文件 | 改动 |
| --- | --- |
| `web/src/appSettings.ts` | 删 `putTdxPath`/`TdxPathSaveResult`（旧「仅保存」客户端退役；服务端 PUT 端点保留兼容）；新增 `runTdxApplyFlow`＋`TdxApplyFlowHooks/Outcome`＋`TDX_APPLY_POLL_ATTEMPTS=120`/`TDX_APPLY_POLL_INTERVAL_MS=700`（与向导逐字同节奏） |
| `web/src/components/TrainingSettings.vue` | `saveTdxPath` 重写：调 `runTdxApplyFlow`（hooks 注入 api.ts 的 saveSetupChoice/applySetupChoice/fetchRestartStatus＋crypto.randomUUID）；outcome 五分支——ready＝「已切换到新的通达信目录。」＋refreshTdxView＋`checkDataStatus({force:true,manual:true})`＋`emit('tdx-connected')`；saved-only＝带原因的保存提示；restart-failed＝reason 或「重启未完成（phase），保存的选择已回滚」；timeout＝向导同款超时文案；error＝message。新增 tdxApplying busy 态（按钮「生效中…」）；「（与当前不同，重启后生效）」→「下次启动后生效」；并发守卫补 tdxApplying；头注语义更新 |
| `web/src/App.vue` | 新增 `onTdxConnected()`（reloadEnv）；模板 `<TrainingSettings ... @tdx-connected="onTdxConnected" @close=...>`（一行接线，向导代码零改动） |

```
npx vitest run --config server/vitest.config.ts server/test/m5-settings-frontend.test.ts
→ Tests  11 passed (11)   EXIT=0
```

## 4. 门禁收据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npx vitest run --config server/vitest.config.ts server/test/m5-settings-frontend.test.ts` | 0 | 11/11 |
| `npx vitest run --config server/vitest.config.ts server/test/settings-tdx-path.test.ts` | 0 | 11/11（服务端未动，PUT 兼容语义原样锁住） |
| `npx vitest run --config server/vitest.config.ts`（全量 server） | 1 | 1692 passed / 1 failed：`review-profile.test.ts > docs-only classification > classifies committed plain markdown as docs-only with visual evidence not applicable`，beforeEach Hook 15s 超时（mkdtemp/git 沙箱）。与本任务改动域无关；单文件重跑 `npx vitest run --config server/vitest.config.ts server/test/review-profile.test.ts` → 16/16 passed EXIT=0。分类＝并行高负载下的环境波动（known/flaky），非本任务引入、非产品回归 |
| `npm run test:desktop` | 0 | 26 files / 258 tests passed |
| `npm run typecheck:web` | 0 | 无类型错误 |
| `npm run build:web` | 0 | 构建成功（chunk>500kB 警告为存量提示） |
| `npm run build:server` | 0 | 编译通过（server 源零改动复核） |
| `node .../check-binding.mjs --repo D:/tmp/tdxflow01 --matrix <绝对路径>/tdx-settings.yaml --strict --include-untracked` | 3 | 矩阵 1 行 covered=0 open=1 RED=0；测试索引 1772 用例＋393 describe。strict 失败根因＝planned 行 test_ids 空（orchestrator 预登记、subagent 禁写矩阵）——按 development-principles §4.1 并行流程属预期形态，待 orchestrator 回填 test_ids 升 covered 后复跑 |
| updater.yaml / desktop-app.yaml 矩阵 | 未跑 | 本轮未触碰 updater/desktop-app 域产品码（改动仅 web 前端＋server/test 一文件），无受影响行 |

### 语义锁定抽检（P4 纸面变异推演）

- **变异 A**（saveTdxPath 改回旧实现：putTdxPath 调用＋「重启应用后生效」文案）：杀死用例×3——`TDX-RECONNECT-01 设置分栏接线（源形状） > TrainingSettings.vue 保存走 runTdxApplyFlow 受控重启链，不要求手动重启应用`（/runTdxApplyFlow/ 与 /putTdxPath/ 双断言）、`M5-01 应用偏好接线 > appSettings.ts：两命名空间端点、偏好 store 与尽力预取齐备`（not.toMatch(/putTdxPath/)）、`M5-01 应用偏好接线 > 设置面板：应用偏好开关与数据目录区块齐备，失败可恢复、重启提示明确`（not.toMatch(/重启应用后生效/)）。三处独立杀死，锁定成立。
- **变异 B**（runTdxApplyFlow 轮询上限改 60 / done 非 ready 也返回 ready / available=false 仍 apply）：分别被 `轮询上限与向导同款 120 次后如实返回 timeout，不假装成功`（statusCallsLog.length===120）、`done 但非 ready（如 rolled-back）返回 restart-failed 并透传 phase 与原因（回滚状态可呈现）`（toEqual restart-failed）、`保存受理不可用（apply.available=false）时仅保存并带回原因，不发起受控重启`（applied=[]）杀死。锁定成立。

## 5. 既有测试修订（双向留痕）

| 位置 | 旧 | 新 | 依据 |
| --- | --- | --- | --- |
| m5-settings-frontend.test.ts「appSettings.ts：两命名空间端点…」 | `toMatch(/restartRequired/)` | `not.toMatch(/TdxPathSaveResult/)`＋`not.toMatch(/putTdxPath/)` | 旧「仅保存＋提示手动重启」客户端语义退役（本任务对象）。注意负向断言未用 /restartRequired/——V1.2.6 dataDir 分栏的 `DataDirSaveResult.restartRequired` 是合法存在（另一设置域，不在本任务范围），按语义收窄到 TDX 专属符号 |
| m5-settings-frontend.test.ts「设置面板：应用偏好开关与数据目录区块齐备…」 | `toMatch(/重启应用后生效/)` | `not.toMatch(/重启应用后生效/)` | 分栏不再要求手动重启应用（用户原话 oracle）。相邻的「重启训练器后生效」（V1.2.6 dataDir 分栏）保留不动 |

断言修订不是删断言换绿：两处都是从旧语义断言升级为新语义断言（正负互换），旧语义的退场本身被新负向断言锁住。

## 6. 偏差与相邻问题登记（不顺手修）

1. **e2e 未跑**（派发约束）：分栏保存→受控重启→ready 的浏览器端到端链路本轮未验证，留集成阶段。已由 runTdxApplyFlow 可执行测试＋源形状接线断言覆盖静态与编排语义。
2. **弹层中途关闭的边缘行为**：受控重启轮询期间用户关闭设置弹层（v-if 卸载组件）会中止前端轮询与「自动刷新」，但服务端受控重启不受影响照常完成；用户重开弹层或刷新页面可见新状态。向导在页面刷新时同族（页面级轮询同样中断）。如需弹层关闭后继续后台轮询+全局通知，属增强项待拍板。
3. **向导未收敛到 runTdxApplyFlow**：App.vue saveAndApplyWizard 仍是独立内联实现（语义同构）。改动向导有回归风险且超出本任务范围，登记为后续收敛项（收敛后两链路共享单一实现）。
4. **PUT /api/settings/tdx-path 成为无前端入口的兼容 API**：保留不删（已发布端点删除需另行拍板）。经此端点保存后再调 /api/setup/apply 会因 `lastSavedChoice`（进程内存）未设置而 409 SETUP_SAVE_MISMATCH——apply 冻结语义「必须先经 save-choice 保存」故意的；前端两链路均已按 save-choice→apply 顺序编排，无实际触发路径。
5. **V1.2.6 dataDir 分栏仍是「保存＋手动重启」语义**（restartRequired:true 提示）：与本任务同款体验断裂但属另一设置域（写回启动器配置），是否同样接受控重启待用户拍板。
6. **review-profile.test.ts docs-only 用例在全量并行下 beforeEach 15s hook 超时**（单跑绿）：环境波动登记，如再现建议调 hookTimeout。

## 7. proposed_default 清单（呈现类，先实现提验）

1. 保存按钮 busy 文案二级：保存阶段「保存中…」、受理生效阶段「生效中…」；主文案保持「保存数据目录」未改（既有断言锁定＋语义仍准确）。
2. ready 成功文案沿用向导逐字「已切换到新的通达信目录。」；saved-only 文案「已保存：{原因}」。
3. savedChoice 与 effectiveRoot 不一致的展示从「（与当前不同，重启后生效）」改为「（与当前不同，下次启动生效）」——避免「重启」字样残留误导（该状态仅在 saved-only/失败残留时可见）。
4. ready 后数据状态刷新用 `checkDataStatus({force:true, manual:true})`（manual＝用户显式动作链路，符合 M5-01「设置面板手动路径不受自动检查偏好门闩」既有口径）；向导用的是非 manual force——若用户关闭「自动检查日线数据」，向导保存后数据状态不刷新而分栏会刷新。分栏选择 manual 的理由如上，向导是否对齐留验收确认。

## 8. 矩阵行 test_ids 提案（orchestrator 录入）

行 `TDX-SETTINGS-APPLY-RESTART`，建议绑定（全部位于 `server/test/m5-settings-frontend.test.ts`）：

- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 runTdxApplyFlow（分栏保存→生效编排，与向导同语义） > 保存受理不可用（apply.available=false）时仅保存并带回原因，不发起受控重启`
- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 runTdxApplyFlow（分栏保存→生效编排，与向导同语义） > 保存成功后受理受控重启，轮询到 done+ready 返回 ready（status 拉取失败不中断）`
- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 runTdxApplyFlow（分栏保存→生效编排，与向导同语义） > done 但非 ready（如 rolled-back）返回 restart-failed 并透传 phase 与原因（回滚状态可呈现）`
- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 runTdxApplyFlow（分栏保存→生效编排，与向导同语义） > 轮询上限与向导同款 120 次后如实返回 timeout，不假装成功`
- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 runTdxApplyFlow（分栏保存→生效编排，与向导同语义） > 保存本身失败（复验 400 等）返回 error 并透传服务端 message，不发起重启`
- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 设置分栏接线（源形状） > TrainingSettings.vue 保存走 runTdxApplyFlow 受控重启链，不要求手动重启应用`
- `server/test/m5-settings-frontend.test.ts::TDX-RECONNECT-01 设置分栏接线（源形状） > App.vue 监听 tdx-connected 后刷新连接状态（reloadEnv）`

覆盖说明：runTdxApplyFlow 五用例锁 EARS 全文（保存→受控重启→轮询 ready→自动刷新由接线用例锁；不要求手动重启由面板负向断言锁；未达 ready 呈现原因与回滚由 restart-failed/timeout 用例锁）。e2e 级「轮询到 ready 后页面自动刷新」未覆盖（§6.1 缺口）。
