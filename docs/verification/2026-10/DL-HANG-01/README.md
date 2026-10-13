# DL-HANG-01 验证记录：更新下载挂起无反馈修复

- 任务：DL-HANG-01（用户 2026-10-13 拍板「严重体验问题」）
- worktree：`D:\tmp\dlhang01`（分支 dl-hang，base=main@f197416 = v1.3.1）
- 矩阵行：UPD-DL-WATCHDOG / UPD-DL-START-CONFIRM / UPD-DL-RETRY-AFTER-STALL（planned，3 行已由架构师预登记；本任务不写矩阵，收尾回 test ID）
- 已读：`.zcode/skills/ai-harness/references/development-principles.md`（全文）

## 一、诊断节（阶段一）

真机缺陷（w5 复现，架构师核实）：3060 真机 v1.3.1，无 VPN，检查环节 11 轮重试后成功发现 v1.3.1；点击「下载并更新」后 20 分钟零反馈——UI 无进度、无错误、无重试入口；系统层观测无外联网络连接（下载似未真正发起）。

### 1.1 假说×证据表

| 假说 | 结论 | 区分性证据 |
|---|---|---|
| H1 UI/控制器层未监听或未呈现 progress 事件 | **证伪** | 事件链结构完整且注册恒先于下载：controller 构造即注册 `adapter.onDownloadProgress`（desktop-updates.ts L163-165）→ electron-updater `executeDownload` 仅在 `listenerCount(DOWNLOAD_PROGRESS)>0` 时挂 onProgress（AppUpdater.js L571-573，监听器注册于模块装配期）；渲染端订阅先于 `downloadAndInstall` invoke（TrainingSettings.vue L698-706）；主进程事件出口 `sendUpdateEvent` → `win.webContents.send('desktop-update:event')`（main.ts L161-173）。区分性：check 链（同事件面同窗口）真机工作正常（发现新版提示可见）——若事件链断裂，boot 检查通知同样不可能呈现。死寂＝「无事件产生」而非「事件丢失」。 |
| H2 `downloadUpdate` promise 挂起且无任何超时 | **成立（根因）** | electron-updater 6.8.10 `ElectronHttpExecutor`（electron `net` 模块，Chromium 网络栈）**零超时**：`grep -n "timeout\|setTimeout" node_modules/electron-updater/out/electronHttpExecutor.js`＝0 匹配。下载链 `controller.downloadAndInstall` → `adapter.downloadUpdate()` → `updater.downloadUpdate()` → `doDownloadUpdate/executeDownload` → ElectronHttpExecutor——全链无超时、无看门狗。网络层挂起（候选机制：GitHub release 资产 302→CDN 域名 DNS/TCP 连接挂起——无 VPN 直连态；请求未真正发出＝w5「无外联连接」观测吻合）时 promise 永久 pending → controller 永久 await → 无 downloaded/error 事件、`downloading` 永不复位。区分性：检查环节 w5 有 11 轮重试错误文案（check 链有人话错误回传），下载环节连错误都没有——唯一解释是 promise 不 settle，而全链无超时使其可能。 |
| H3 下载前置流程（排空确认/staging 清理/对话框）卡住 | **证伪** | desktop 通道 `downloadAndInstall` 前置仅两个内存布尔守卫（`downloading`/`checked`，desktop-updates.ts L186-188）；排空（drain）在 `await adapter.downloadUpdate()` **之后**才触发（`requestInstallWithDrain` 于 L194）；下载路径上无对话框、无 staging 清理、无排空调用。区分性：若卡在前置，UI 不会停在 downloading 呈现（渲染端 `startUpdateApply` 在 invoke 前已置 `applyPollState='downloading'`，且 `applyStarting` 在 finally 复位——真机上 UI 停留 downloading 0% 静止，说明已越过前端守卫进入 await）。 |
| H4 CSP/session 层拦截导致请求未发出 | **证伪（结构性）** | electron-updater 请求由主进程 `ElectronHttpExecutor`（`electron.net`）发起，不经渲染端 session，页面 CSP 不约束主进程 net 请求；NSIS packaged 形态无自定义 session 拦截代码（grep desktop/src 无 `webRequest.onBeforeRequest`）。区分性：若 Chromium 网络栈被系统代理整体拦截，check（同一网络栈同一进程）不应间歇成功（w5：11 轮重试后成功）——代理全拦与 check 成功矛盾。系统代理残留作为 H2 网络层挂起的候选机制保留（无法从代码层证实，且无论何种网络层机制，代码层「无超时无看门狗」都是充分必要的修复点）。 |

### 1.2 放大器缺陷（使 20 分钟死寂成立的伴随缺陷）

1. **无启动观测缝**：点击「下载并更新」后主进程无任何日志/事件记录下载已触发——「下载未开始」vs「下载卡住」对用户与观测缝均不可区分（UPD-DL-START-CONFIRM 目标）。UI 层渲染端虽立即置 `downloading 0%`（TrainingSettings.vue），但主进程侧零痕迹。
2. **无重试入口**：挂起时 `applyPollState='downloading'` 恒成立 → `updateInProgress` computed 恒 true（TrainingSettings.vue L552-554）→「下载并更新」按钮永久禁用——w5「无重试入口」吻合。
3. **渲染端死等**：`await desktopUpdatesApi.downloadAndInstall()` 永久 pending，无独立超时。

### 1.3 zip HTTP 链诊断（server apply 下载——相邻问题核查）

**结论：已有超时覆盖，登记不修（本轮矩阵行限 desktop 形态）。** 证据：server/src/update/api.ts L96-110——manifest fetch `timeoutMs: 30_000`（「检查更新超时（30 秒）」）；zip 下载 `safeRequest` `timeoutMs: 15 * 60_000`（「下载超时（900 秒总预算）」，safe-http 预算覆盖头＋体整个生命周期，L15 注释）。已知残余（登记）：900s 为总时长预算而非进度看门狗，慢速 trickle 理论上可占满 15 分钟才失败——按相邻问题登记，不顺手修。

### 1.4 根因结论

**根因链**：点击「下载并更新」→ 渲染端置 downloading 0% → IPC `downloadAndInstall` → controller → `adapter.downloadUpdate()` → electron-updater `ElectronHttpExecutor`（electron net，零超时）→ 网络层挂起（DNS/TCP，请求未发出）→ promise 永久 pending → 无任何事件回流 → UI 静止 0%、按钮永久禁用、无错误、无超时、无重试 → 20 分钟死寂。修复点＝controller 层统一看门狗＋启动观测＋重试清理（唯一同时覆盖 electron-updater 链与便携链的位置——两链实现同一 `DesktopUpdaterAdapter` 面）。

## 二、设计节

### 2.1 改动面（全部在 allowed paths 内）

| 文件 | 改动 | 矩阵行 |
|---|---|---|
| `desktop/src/desktop-updates.ts` | ①`DesktopUpdateEvent` 加 `{type:'download-started'}`（additive）；②`DownloadCancellation` 接口＋`createDownloadCancellation()`；③`resolveDownloadStallTimeoutMs(env, default=90_000)`；④controller deps 加 `stallTimeoutMs`；⑤`downloadAndInstall` 看门狗 | WATCHDOG/START-CONFIRM/RETRY |
| `desktop/src/update-adapter.ts` | `downloadUpdate(cancellation?)` → 转 electron-updater `CancellationToken`（`new CancellationToken()`＋`whenCancelled.then(()=>token.cancel())`；builder-util-runtime CancellationToken 形态已核实：`.cancel()/.cancelled`，EventEmitter） | WATCHDOG（中止尽力语义） |
| `desktop/src/cn-feed.ts` | FeedFallbackAdapter.downloadUpdate 透传 cancellation 参数 | —（同面零语义变化） |
| `desktop/src/main.ts` | 接线 `stallTimeoutMs: resolveDownloadStallTimeoutMs(process.env)` | — |
| `web/src/updateFlow.ts` | `DesktopUpdateEvent` 加 download-started 成员＋`desktopEventToApplyView` 映射 downloading 0%（additive，复用既有态，八态文案表零改动） | START-CONFIRM 呈现侧 |
| `desktop/test/desktop-updates-stall.test.ts`（新） | RED 用例（§4） | 3 行绑定 |

### 2.2 看门狗语义（UPD-DL-WATCHDOG）

- 触发即启动：`downloadAndInstall` 进入即记 `startedAt`/`lastActivityAt` 并启动定时器；**progress 事件推进即重置**（controller 构造期注册的全局 progress handler 刷新 `lastActivityAt` 并重排定时器）。
- 90s 无任何进度 → ①置 `fired`；②`cancellation.cancel()`（尽力中止底层下载——若 electron-updater 内部消费 CancellationToken 则下载中断；若网络层挂死不响应 cancel，看门狗仍独立生效，见④）；③以 `Promise.race([downloadPromise, stallPromise])` 的 stallReject 使 `downloadAndInstall` 立即以 `{ok:false}` 返回——**不依赖 downloadUpdate settle**（这是对 H2 挂起形态的根治：即使底层永不返回，controller 层必然收敛）。
- 失败呈现：`sendEvent({type:'error', message})`（渲染端既有 failed 呈现＋`applyFailedReason` → `updateInProgress` 复位 → 按钮重新可用＝重试入口）＋人话消息（proposed_default）：「下载停滞：已等待 N 秒没有任何进度。可能是网络不稳定或更新源无法访问，请检查网络后重试」。
- 晚到 settle 兜底：stall 赢得 race 后 downloadUpdate 才 settle 的，显式 attach catch 吞掉并记日志（绝不产生 unhandledRejection）。
- 阈值常量 `DOWNLOAD_STALL_TIMEOUT_MS=90_000`；env `TRAINER_DESKTOP_DL_STALL_MS` 可覆盖（合法正数生效，非法/空/0/负回默认——测试注入小值，不真等 90s）。
- **中止语义局限（如实登记）**：cancel 是尽力中止。electron-updater `downloadUpdate(cancellationToken)` 接受 token，但若请求已挂死在 Chromium 网络栈 DNS/TCP 层，token cancel 不保证中断底层 socket——此时旧 downloadPromise 残留 pending，重试时 electron-updater 返回同一 pending promise（`downloadUpdate: if (this.downloadPromise != null) return this.downloadPromise`），新看门狗再次超时、再次失败呈现。行为可接受（用户持续得到失败反馈与重试入口，绝不死寂），局限如实记录。

### 2.3 启动反馈（UPD-DL-START-CONFIRM）

`downloadAndInstall` 进入即：`sendEvent({type:'download-started'})`（渲染端经既有事件面映射 downloading 0%——使「已触发」可被用户看到）＋`logger.info('[desktop-updates] download started (stall watchdog Nms)')`（日志观测缝——真机事后可查「下载已触发」）。事件即时发出（不等下载完成），满足「10 秒内可观测」。

### 2.4 重试清理（UPD-DL-RETRY-AFTER-STALL）

重试＝用户再点已复位的「下载并更新」→ `startUpdateApply` 重走 confirm→订阅→invoke 完整链；controller 侧：①看门狗触发即复位 `downloading`（不被「更新已在进行中」拒绝）；②`downloadAndInstall` 进入时防御性清上一轮定时器/中止句柄（残留状态清理）；③不设重试计数器（不设上限）；④每次调用独立看门狗与 download-started 事件（完整链重启）。feed 解析：下载沿用最近成功 check 的源（UPD-CN-FALLBACK-DESKTOP 冻结口径——「check 成功后下载沿用成功源」），重走完整下载链含 controller→adapter→网络全栈。

### 2.5 矩阵红线自查

- UPD-DESKTOP-PROGRESS-EVENTS（既有 covered）：八态文案表零改动；download-progress/downloaded/installing/error 四事件语义零变化——新事件类型为 additive。
- UPD-CN-FALLBACK-DESKTOP：回退适配器仅透传可选参数，逐源 setFeedURL 语义零变化。
- UPD-DESKTOP-INSTALL-DRAINS-FIRST：`requestInstallWithDrain` 仍只在下载成功 resolve 后调用；quitAndInstall 路径零触碰。

## 三、RED 证据

命令：`cd /d/tmp/dlhang01 && npx vitest run --config desktop/vitest.config.ts desktop/test/desktop-updates-stall.test.ts`
结果：**6 failed | 1 passed（7）**——失败原因全部正确（缺功能，非语法/环境错）：

| 用例 | 失败原文（摘） | 正确原因 |
|---|---|---|
| WATCHDOG: a silent download converges… | `Error: 看门狗未生效：downloadAndInstall 对永不 settle 的下载挂起（真机缺陷复现）` | 挂起场景复现——无看门狗时 downloadAndInstall 永不返回（=真机 20 分钟死寂的代码层复现） |
| WATCHDOG: late settlement after a stall… | `Error: 看门狗未生效：晚到 settle 场景同样挂起` | 同上（另一挂起形态） |
| WATCHDOG: resolveDownloadStallTimeoutMs… | `AssertionError: expected 'undefined' to be 'function'` | env 解析函数缺失（动态 import 探测，避免整文件 import 崩溃） |
| START-CONFIRM: download start is observable… | `AssertionError: expected [] to deep equally contain { type: 'download-started' }` | 启动事件缺失 |
| RETRY-AFTER-STALL: retry after a stall… | `Error: 第一次下载停滞未收敛` | 无看门狗→第一次调用挂起→重试链无从谈起 |
| START-CONFIRM: renders download-started… | `AssertionError: expected { state: 'failed', message: undefined } to deeply equal { state: 'downloading', … }` | 渲染端映射缺失（事件落入 failed 兜底分支） |
| WATCHDOG: slow-but-alive progress resets… | **通过（天然绿，如实登记）** | 防误杀负向用例：期望行为（慢速下载成功）在无看门狗时也成立。其杀手作用由变异 M3 兑现（删重置逻辑→本用例死）；GREEN 后仍绿＝看门狗存在且不误杀 |

## 四、GREEN＋变异＋门禁全表

### 4.1 GREEN

最小实现（六文件，见 §2.1 表）：
- `desktop/src/desktop-updates.ts`：DesktopUpdateEvent 加 download-started；DownloadCancellation/createDownloadCancellation；DOWNLOAD_STALL_TIMEOUT_MS=90_000＋resolveDownloadStallTimeoutMs（env TRAINER_DESKTOP_DL_STALL_MS 覆盖，非法回默认）；deps.stallTimeoutMs 注入；downloadAndInstall 重写——启动即发事件＋日志、`Promise.race([downloadPromise, stallPromise])` 独立收敛（不依赖底层 settle）、progress 推进重置、晚到 settle 双分支吞掉（warn 日志）、fired 后忽略底层结果。
- `desktop/src/update-adapter.ts`：downloadUpdate 接受 cancellation，动态 import builder-util-runtime（default 通道 interop，沿 defaultDesktopUpdater 实证模式）构造 CancellationToken 转发 cancel。
- `desktop/src/cn-feed.ts`：FeedFallbackAdapter.downloadUpdate 透传 cancellation（下载同源冻结语义零变化）。
- `desktop/src/main.ts`：接线 `stallTimeoutMs: resolveDownloadStallTimeoutMs(process.env)`。
- `web/src/updateFlow.ts`：DesktopUpdateEvent 加 download-started 成员＋desktopEventToApplyView 映射 downloading 0%（复用既有态）。

GREEN 命令与结果：`npx vitest run --config desktop/vitest.config.ts desktop/test/desktop-updates-stall.test.ts` → **7 passed（exit 0）**。

### 4.2 变异抽检（3/3 被击杀）

| 变异 | 操作 | 击杀用例 | 死因 |
|---|---|---|---|
| M1 删看门狗收敛 | fireStall 的 `state.rejectStall?.(...)` 注释 | WATCHDOG: a silent download converges… | `expected 'cancelled download' to contain '下载停滞'`——cancel 生效但停滞人话缺失（锁人话语义） |
| M2 删启动反馈 | `sendEvent({type:'download-started'})` 注释 | START-CONFIRM: download start is observable…（事件缺失）＋RETRY-AFTER-STALL（download-started 计数 0≠3） | 启动观测断言死 |
| M3 删进度重置 | onDownloadProgress 重置块替换为 no-op | WATCHDOG: slow-but-alive progress resets… | `expected false to be true`——慢速下载被误杀（RED 天然绿用例兑现杀手作用） |

### 4.3 门禁全表（机器结果，收退出码不隔管道）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| desktop 全量 | `npx vitest run --config desktop/vitest.config.ts` | **0** | 26 files / 257 tests 全绿 |
| updater 域定向（server 侧影响面） | `npx vitest run --config server/vitest.config.ts server/test/updater-*.test.ts server/test/update-safe-http.test.ts` | **0** | 9 files / 92 tests 全绿（web updateFlow 改动消费方 updater-ui/updater-notice 在内） |
| server 全量 | `npx vitest run --config server/vitest.config.ts` | 1（两轮） | **环境抖动，非本任务引入**——逐名披露见 §4.4 |
| build（typecheck:web＋build:server＋build:web） | `npm run build` | **0** | vite built in 3.62s |
| build:desktop:main | `npx tsc -p desktop/tsconfig.json` | **0** | 无错误输出 |
| vitest list 实名核对 | `node node_modules/vitest/vitest.mjs list --config desktop/vitest.config.ts desktop/test/desktop-updates-stall.test.ts` | **0** | 7 条 ID 实名输出（§5 表＝逐字照抄） |
| check-binding --strict（真矩阵） | `check-binding.mjs --repo D:\tmp\dlhang01 --matrix …updater.yaml --strict` | 3 | 预期中间态：3 行 planned 待 orchestrator 录入 test_ids（矩阵禁写，§4.5 副本验证）＋2 行既有 superseded 未闭合（main 上同形） |
| check-binding --strict（**副本**：test_ids＋covered 预填＋`--include-untracked`） | 同上，matrix 指向临时副本 | 3 | **3 行 DL 零 ref 悬空**（问题明细段消失；索引 2015→2022 恰＋7）；余 2 未闭合＝既有 superseded。证明 §5 test ID 与 checker 索引完全一致，orchestrator 录入即可闭合 |

### 4.4 server 全量失败逐名披露（全量任何失败逐名报告纪律）

两轮全量失败（均超时形态）：
1. `server/test/api.test.ts > lifecycle exit protocol (REL-LAUNCH-UX-01) > rejects cross-origin requests…` — Test timed out in 5000ms（第二轮为同 describe 另一用例 `maps honest failures…`）
2. `server/test/review-profile.test.ts > docs-only classification > accepts root README and CONTRIBUTING edits…` — Test timed out in 30000ms

**判定＝既有环境抖动，非本任务引入**，证据链：
- 两文件单独复跑（含本任务改动）：38/38 绿（exit 0）；
- 涉事文件与本任务改动域零 import 关联（改动仅 desktop/src＋web/src/updateFlow.ts；api/review-profile 不消费）；
- **基线对照**：stash 全部改动后在干净 f197416 上跑 server 全量，同样失败且**换了文件**（`train-range-preview.test.ts > 过期与未知previewId返回409` 断言失败，且本轮 api/review-profile 反而通过）——失败集合漂移＋基线同样红＝负载型 flake（全量 316s/634s 测试时间、Windows 2-worker 并发）实锤。
- 本任务影响面（updater 域 9 套件 92 用例）定向全绿（§4.3）。

### 4.5 矩阵合规

- 矩阵文件零写入（单写者＝orchestrator）；test_ids 经收尾报告回传。
- 副本验证用后即删（/tmp，不在 worktree）。

## 五、test ID（vitest list 实名核对）

以下 7 条为 `vitest list` 实名输出逐字照抄（格式 `文件 > describe > 用例`；矩阵录入格式＝`文件::用例名`，副本验证已确认零悬空）：

| 矩阵行 | test ID（`文件::用例名`） |
|---|---|
| UPD-DL-WATCHDOG | desktop/test/desktop-updates-stall.test.ts::UPD-DL-WATCHDOG: a silent download converges to a human failure with waited seconds, cancel handle fired, error event sent |
| UPD-DL-WATCHDOG | desktop/test/desktop-updates-stall.test.ts::UPD-DL-WATCHDOG: slow-but-alive progress resets the watchdog and completes without stall |
| UPD-DL-WATCHDOG | desktop/test/desktop-updates-stall.test.ts::UPD-DL-WATCHDOG: late settlement after a stall is swallowed without unhandled rejection |
| UPD-DL-WATCHDOG | desktop/test/desktop-updates-stall.test.ts::UPD-DL-WATCHDOG: resolveDownloadStallTimeoutMs defaults to 90s with env override and rejects garbage |
| UPD-DL-START-CONFIRM | desktop/test/desktop-updates-stall.test.ts::UPD-DL-START-CONFIRM: download start is observable immediately via event and log line |
| UPD-DL-START-CONFIRM | desktop/test/desktop-updates-stall.test.ts::UPD-DL-START-CONFIRM: renders download-started onto the downloading presentation at zero percent |
| UPD-DL-RETRY-AFTER-STALL | desktop/test/desktop-updates-stall.test.ts::UPD-DL-RETRY-AFTER-STALL: retry after a stall reruns the full chain with a fresh watchdog and no attempt cap |

绑定层次说明（如实）：WATCHDOG 四用例锁执行语义（挂起收敛/推进重置/晚到吞掉/阈值解析）；START-CONFIRM 两用例分锁主进程观测（事件＋日志）与渲染端映射（真实 web/src/updateFlow.ts 导出）；RETRY 一用例锁完整链重启＋不设上限＋独立看门狗。UI 浏览器级呈现（IPC→DOM）沿 PACK-04 先例留真机验收。

## 六、proposed_default / needs_user_decision / 相邻问题

### 6.1 proposed_default（待用户追认）

1. **看门狗阈值 90 秒**（DOWNLOAD_STALL_TIMEOUT_MS=90_000；矩阵行 binding_note 已注明）；env `TRAINER_DESKTOP_DL_STALL_MS` 可覆盖（诊断/测试注入）。
2. **停滞人话文案**：「下载停滞：已等待 N 秒没有任何进度。可能是网络不稳定或更新源暂时无法访问，请检查网络后重试」（N＝ceil 毫秒/1000，下限 1）。
3. **观测缝**：启动＝事件 download-started（渲染端 downloading 0%）＋主进程日志 `[desktop-updates] download started (stall watchdog Nms)`；停滞失败＝error 事件＋`logger.error`。未新增 boot-check 式 env 落盘缝（事件＋日志已可区分「未启动/卡住」；如需落盘缝另行登记）。
4. **重试入口形态**：沿用既有失败态呈现（「更新失败：{原因}」＋「下载并更新」按钮复位重可用），不新造「重试」按钮（与 http 通道失败重试同构）。

### 6.2 needs_user_decision

（无——行为语义已由用户 2026-10-13 拍板（严重体验问题须修）＋矩阵 EARS 冻结；其余均为呈现类默认，见 6.1。）

### 6.3 中止语义局限（如实登记）

cancel 为尽力中止：electron-updater 链经 CancellationToken；若请求已挂死在 Chromium 网络栈 DNS/TCP 层，token cancel 不保证中断底层——此时旧 downloadPromise 残留 pending，重试时 electron-updater 可能返回同一 pending promise（`downloadUpdate` 复用 `this.downloadPromise`），新看门狗将再次超时、再次失败呈现。用户始终得到失败反馈与重试入口（绝不死寂），但「重试立即成功」需等底层真恢复或应用重启。局限已写入代码注释。

### 6.4 相邻问题（只登记不顺手修）

1. **zip HTTP 链 900s 总预算≠进度看门狗**：server/src/update/api.ts zip 下载 `timeoutMs: 15*60_000`（已有超时覆盖——本任务诊断结论「已有覆盖」）；慢速 trickle 理论可占满 15 分钟才失败。若需对齐「无进度即停」语义，另开 server 侧任务（本轮矩阵行限 desktop 形态）。
2. **check 环节 11 轮重试无退避上限**（w5 观察）：检查链用户可手动重试且有人话错误（体验合格），未在本任务范围。
3. **渲染端死等 IPC invoke**：desktop 通道 `await downloadAndInstall()` 无独立超时——现由主进程看门狗保证 invoke 必然 settle（race 独立收敛），渲染端无需第二看门狗；若未来 controller 移出主进程需重新评估。

## 七、发布记录（v1.3.2，2026-10-13）

看门狗随 **v1.3.2** 正式发布（DL-HANG-01＋CN-FEED-01 镜像常量填入同版，发布提交 eb94f54＝tag v1.3.2）：

- GitHub Release：https://github.com/m1kuStark/a-share-kline-trainer/releases/tag/v1.3.2（id=411567776，7 资产全 uploaded，latest 已翻页）。
- 门禁与发布全收据：`ai-harness-lab/gpu3060-bench/reports/wc-release-v132.md`（发布执行者报告；desktop 全量 26 文件 257/257 全绿含本任务 7 用例）。
- NSIS 安装器冒烟（等价 /currentuser 序列）：安装→health `currentVersion=1.3.2`→优雅退出→卸载→无残留全过；真实用户数据目录与用户 per-machine 安装（D:\K-line-trainer）前后 INTACT。
- CHANGELOG v1.3.2 段含看门狗条目（proposed_default 文案）；设置页 UI 浏览器级呈现留待用户真机验收（沿 §5 绑定层次说明）。
