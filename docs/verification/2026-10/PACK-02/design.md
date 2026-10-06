# PACK-02 设计：桌面应用生命周期

任务卡：`docs/work-items/tasks/PACK-02.md`｜base cc6289f｜2026-10-06

## 一、设计输入（冻结语义资产，不新造）

| 资产 | 位置 | 复用方式 |
|---|---|---|
| SETUP-01 冻结排空控制器 | `server/src/setup/drain-controller.ts`（`prepare(attemptId,{allowActiveTraining})`→prepared/drain-timeout/…；`beginShutdown`） | **进程内直接调用**（桌面主进程即宿主）；in-app 退出口径＝`allowActiveTraining:true`（训练保留 SQLite，与页面「保存并退出」同语义，见 `server/src/api.ts` `lifecycleInvokeShutdownOnce` 注释「The in-app exit preserves an unfinished training in SQLite」） |
| 控制端点 | `server/src/setup/control-api.ts`（HTTP 路径，严格守卫拒活动训练） | 不走 HTTP：严格守卫（无 allowActiveTraining）会把「有训练时关窗」卡死，与需求②矛盾；lifecycle HTTP 端点是页面会话协议，主进程伪造会话反而绕开冻结语义 |
| PORT-01 端口回退 | `scripts/release/launcher.cjs` `bindCheckPort`＋`findFallbackPort`（bind 探测，preferred+1 起向上 40 次内首个可 bind） | 口径镜像重实现（launcher.cjs 不入包，禁改）；bind 探测含 EACCES→reserved / 其他→occupied |
| PORT-02 冲突询问 | `launcher.cjs`：占用者经 `isTrainerHealth`（`status==='ok' && typeof runId==='string' && Number.isInteger(pid)`，HTTP 200，`/api/health`，redirect:'error'）验证为训练器→决策 reuse/restart；restart＝复核身份一致才杀→等退出＋端口释放→正常启动；reuse＝复核仍存活→直接用，不启新进程 | 口径镜像重实现＋新增第三应答 cancel（桌面专属，派发简报决策③）；应答可注入 `TRAINER_DESKTOP_CONFLICT_ANSWER=reuse|restart|cancel`（对齐 launcher `--conflict-answer` 可注入形态） |

## 二、生命周期状态机（主态×失败分支）

```
[启动] exe 侵入
  │
  ├─ S1 单实例检查：app.requestSingleInstanceLock()
  │    ├─ 失败（第二实例）──→ 立即退出（不启服务不开窗）；首实例收 second-instance 事件→窗口 restore+focus
  │    └─ 成功 ──→ S2
  │
  ├─ S2 开发窗口模式？（DESKTOP_DEV_URL 置位）
  │    ├─ 是 ──→ 只开窗（不内嵌服务）──→ W
  │    └─ 否 ──→ S3
  │
  ├─ S3 端口决策（resolvePortPlan，全部探测可注入）：
  │    ① health 探测 desiredPort：
  │    ├─ 训练器占用（200＋isTrainerHealth＋pid>0）→ 询问应答（env 注入优先，否则原生 dialog 三选）
  │    │    ├─ cancel ──→ QUIT（不动占用者）
  │    │    ├─ reuse  → 复核仍存活──→ REUSE 分支：窗口直接加载占用者 URL，不启内嵌服务 ──→ W
  │    │    │            └─ 复核已消失 ──→ 落 ②bind 裁决
  │    │    └─ restart → 复核身份一致（pid 相同）→ 杀 → 等退出（≤5s）＋端口释放（≤3s）
  │    │                 ├─ 杀失败/未退出 ──→ QUIT（错误呈现，不猜）
  │    │                 ├─ 复核已消失/身份变化 ──→ 落 ②bind 裁决（不杀）
  │    │                 └─ 清理成功 ──→ ②
  │    ② bind 探测 desiredPort：
  │    ├─ 可 bind ──→ START：desiredPort，无回退
  │    └─ 不可 bind（占用者非训练器/已消失的残留）──→ PORT-01 自动回退：preferred+1 起向上 ≤40 次找首个可 bind
  │         ├─ 找到 ──→ START：picked 端口，记 fallback{from,reason}（注入 TRAINER_PORT_FALLBACK 供页面常驻提示）
  │         └─ 40 个全不可用 ──→ QUIT（错误呈现）
  │
  ├─ START：组装隔离 env（含实际端口）→ 动态 import 服务入口 → startTrainerServer()
  │    └─ 任一步抛错 ──→ QUIT（dialog.showErrorBox）
  │
  ├─ W 窗口（bounds 记忆/最小尺寸/安全基线，见 §四）
  │
  └─ 退出路径：
  ├─ QUIT（启动期失败/冲突 cancel）：无服务──app.quit() 直接退
  └─ 窗口全关（window-all-closed）──→ G 优雅退出（单飞）：
       G1 drain：controller.prepare(`desktop-<uuid>`, {allowActiveTraining:true})
         ├─ prepared ──→ G2
         ├─ drain-timeout（控制器内预算 10s）──→ 记录──→ G2（强退口径）
         ├─ busy/closing/expired/cancelled（重复触发等）──→ 记录──→ G2（关闭幂等）
         └─ 外层超时 TRAINER_DESKTOP_DRAIN_TIMEOUT_MS（默认 15000，proposed_default）──→ 记录──→ app.exit(0) 强退
       G2 server close：started.shutdown()（app.close→db close→ready 清理，全部幂等）
         └─ 完成/外层超时 ──→ app.quit() / app.exit(0)
       冒烟断言：退出后根进程消失＋端口可重绑＋health 拒连（无孤儿、端口释放）
```

不变量：
- 单飞：退出流程只进入一次（`quitStarted` 标志；before-quit 只做兜底 shutdown，不重入 drain）。
- 任何 QUIT 都不杀未经 isTrainerHealth 复核的进程（PORT-02 冻结口径）。
- REUSE 分支永不启动第二个服务进程（无双写）。

## 三、server 侧最小接线（allowed：确需的最小改动）

`server/src/index.ts`：`StartedTrainerServer` 增加 `drain: DrainController` 字段并在 return 暴露（＋3 行）。理由：桌面主进程进程内复用冻结排空语义的唯一通道；HTTP 控制端点严格守卫拒活动训练、lifecycle 端点是页面会话协议，均与需求②的 in-app 退出语义错位。行为保持：纯增量，CLI 分支零改动；既有测试＋新增 1 例（句柄暴露与 prepare 可用）为证。

## 四、窗口行为与安全基线（proposed_default，见 README 提验清单）

- **bounds 记忆**：`<dataDir>/window-state.json`（严格形状 {x,y,width,height} 整数；损坏/缺失→默认 1360×860）；启动时 clamp 到所在显示器工作区（`screen.getDisplayMatching`）＋最小尺寸 1024×680；窗口 close 时落盘（best-effort，失败仅日志）。
- **菜单**：沿用 PACK-01 `autoHideMenuBar: true`（Windows 惯例：平时无菜单栏、Alt 呼出；保守默认）。
- **标题**：沿用「K线训练器」（PACK-01 拍板项③默认，page-title-updated preventDefault）。
- **安全基线**：`webPreferences` 显式 `contextIsolation:true`＋`nodeIntegration:false`＋`sandbox:true`＋默认 webSecurity 不放低；无 preload（PACK-04 更新 IPC 再最小暴露）。
- **外部链接**：`setWindowOpenHandler` 一律 deny 新 Electron 窗口；http(s) 且非应用源 → `shell.openExternal`（系统默认浏览器）；非 http(s)（file:/mailto:/about:）→ 仅 deny。`will-navigate`：非应用源导航→prevent＋openExternal。

## 五、纯函数抽层（TDD 载体）与粘合层

| 模块 | 职责 | 测试 |
|---|---|---|
| `desktop/src/port-conflict.ts` | `isTrainerHealthBody`／`portUnavailableReason`／`pickFallbackPort`（注入探测）／`resolvePortPlan`（注入 probeHealth/bindCheck/askConflict/killOccupant）／`parseConflictAnswerEnv`／`portFallbackEnvValue` | vitest 全分支（含三应答×复核矩阵） |
| `desktop/src/quit-state.ts` | 退出状态机 reducer（idle→draining→closing/forcing→quit；非法迁移拒绝）＋`resolveDrainTimeoutMs`（默认 15000） | vitest |
| `desktop/src/window-bounds.ts` | `parseWindowState`（严格）／`clampToBounds`（工作区＋最小尺寸）／`serializeBounds` | vitest |
| `desktop/src/external-links.ts` | `classifyUrl(url, appOrigin)`：'external'（http(s) 非应用源）｜'internal'｜'denied'（非 http(s)） | vitest |
| `desktop/src/main.ts` | 粘合：真实探测/bind/dialog/screen/shell 注入上述决策函数；不可单测部分以冒烟收据验证 | smoke-desktop.mjs 扩展 |

## 六、冒烟扩展（smoke-desktop.mjs）

1. 既有断言保留（health/currentVersion/首页/窗口标题）。
2. **第二实例**：主实例存活期再 spawn 同一 exe（同 env）→ 断言第二实例限时自然退出（非强杀）且主实例 health 仍 200。
3. **优雅退出替代强杀**：`CloseMainWindow()`（按窗口标题定位）→ 断言根进程限时自然退出（退出码 0）→ 端口可重绑＋health 拒连。
4. **冲突 restart 注入路径**：假训练器（node http，/api/health 回 `{status:'ok',runId:'run-fake',pid}`）占随机端口 → spawn 新 exe 实例（独立临时 dataDir）＋`TRAINER_DESKTOP_CONFLICT_ANSWER=restart` → 断言：假训练器进程退出；该端口 health 变为 exe 自己的服务（runId≠fake 且有 currentVersion）；随后优雅关窗退出＋端口释放。
5. 隔离铁律不变：全部临时目录＋动态端口，绝不动 8787 真实占用者与真实数据目录。
