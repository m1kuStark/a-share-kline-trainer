# PACK-02 验证记录：桌面应用生命周期

任务卡：`docs/work-items/tasks/PACK-02.md`（里程碑 PACK）｜base cc6289f｜2026-10-06

## 一、验证收据（机器结果）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| TDD RED | `npm run test:desktop`（实现前） | 1 | 5 个新测试文件 Cannot find module；server 扩例 `current.drain` undefined——缺功能失败（非语法/环境错） |
| desktop 定向单测 | `npm run test:desktop` | 0 | **40/40**（desktop-config 6＋boot-plan 2＋port-conflict 16＋quit-state 9＋window-bounds 4＋external-links 3） |
| server 定向单测 | `npx vitest run --config server/vitest.config.ts server/test/server-entry-programmatic.test.ts` | 0 | 3/3（含新增 drain 句柄暴露例） |
| 全量测试 | `npm test` | 0 | **1556/1556 全绿，零存量失败**（server 120 文件 1516＋desktop 6 文件 40；基线 1521→1556：+1 server＋34 desktop） |
| 构建 | `npm run build` | 0 | typecheck:web＋build:server＋build:web 全过 |
| 桌面主进程编译 | `npm run build:desktop:main` | 0 | tsc 零错误 |
| 桌面打包 | `npm run build:desktop` | 0 | 便携 exe 99.0 MB（103,845,724 B） |
| 打包冒烟（扩展） | `node desktop/scripts/smoke-desktop.mjs --exe desktop/release/kline-trainer-desktop-v1.2.7-windows-x64.exe` | 0 | **SMOKE_PASS total=53.4s**，全断言过（见 §二） |
| 绑定检查 | `check-binding.mjs --matrix desktop-app.yaml --strict --include-untracked` | 3（设计内） | 20 行：covered=12／open=8／**RED=0**；open＝PACK-01 手册/粘合行 5＋PACK-03..05 占位 3（派发简报要求的预期占位） |
| 回归：launcher-lifecycle | `check-binding.mjs --matrix launcher-lifecycle.yaml --strict` | 0 | 8/8 covered 不受影响 |
| 回归：updater | `check-binding.mjs --matrix updater.yaml --strict` | 0 | 16/16 covered 不受 index.ts 增量影响 |
| 零破坏 | `git diff --stat origin/main..HEAD -- scripts/release/ web/ launcher.cjs` ＋工作树同查 | — | **空**（zip 形态/PORT-02/UPD 语义零改动） |
| 变异 M1（executed） | quit-state：request-quit 跳过排空直接退出（退回 PACK-01 行为）→ 定向跑 | 1 | 5 例死，杀手＝`DESKTOP-GRACEFUL-QUIT-DRAIN: quitting a running embedded server drains with the in-app exit profile before closing`；回退后 9/9 绿 |
| 变异 M2（executed） | port-conflict：restart 分支去掉 pid 复核（recheck 是训练器即杀）→ 定向跑 | 1 | 精确 1 例死＝`DESKTOP-PORT-CONFLICT-TRAINER-ASK: restart spares a vanished or identity-changed occupant and binds instead`；回退后 16/16 绿 |

### 全量套件失败复盘（如实记录）

第 2 次全量跑出现 5 例失败（release-launcher 子进程 exit 0xC0000409＋临时目录清理失败）、第 3 次 1 例超时（review-profile docs-only 30s timeout）。定位：连续快速重跑 `npm test` 且管道 grep 提前关闭 stdout，前一轮 teardown 被跳过留下 rel-launch 孤儿 node.exe（PID 64028/48164，其一与失败测试临时目录同路径）污染下一轮；清理孤儿后 release-launcher 单跑 52/52 绿、review-profile 单跑 16/16 绿，随后无管道早退的完整跑 **1556/1556 exit 0**。结论：环境污染，非代码回归（本轮 diff 不触及 launcher/发布脚本，被杀孤儿属测试基建残留）。教训：全量套件重跑之间先清 `rel-launch-*` 孤儿进程。

## 二、打包冒烟扩展断言（SMOKE_PASS 收据逐条）

| 阶段 | 断言 | 实测 |
|---|---|---|
| A 启动 | /api/health 200＋status ok＋currentVersion=1.2.7 | 200，boot 11.9s |
| B 页面/窗口 | 首页 HTML 200；窗口标题「K线训练器」存在 | 200 (476B)；count=1 |
| C 第二实例 | 同 exe 二次启动→限时自然退出 exit 0；首实例 health 仍 200 | exited promptly code 0；first instance still healthy |
| D 优雅退出 | CloseMainWindow（只发给我们进程树子进程）→根进程限时自然退出 exit 0→端口可重绑＋health 拒连 | natural exit 0；port rebindable＋health refused（无孤儿） |
| E 冲突 restart 注入 | 假训练器（独立 node 进程，isTrainerHealth 身份 pid/runId）占随机端口→`TRAINER_DESKTOP_CONFLICT_ANSWER=restart` 启动 exe→假占用者被结束→exe 自己服务接管该端口（runId≠fake＋currentVersion）→优雅退出＋端口释放 | fake occupant stopped；exe took over port 12098（runId=run-bc43…＋1.2.7）；conflict exe exited 0；port released |

隔离铁律执行：全部临时目录（pack02-smoke-*）＋动态随机端口；CloseMainWindow 按父进程 PID 过滤只发给我们 spawn 的进程树，绝不动用户真实实例；TDX_ROOT 置空；8787 真实占用者全程未触碰。

## 三、行为矩阵状态（desktop-app.yaml，20 行）

- **covered=12**：PACK-01 四行（CONFIG-RESOLVE／SERVER-ENV-ASSEMBLY／APP-URL／SERVER-ENTRY-PROGRAMMATIC——后者扩展 drain 暴露条款＋第 4 测试）＋PACK-02 八行：
  - `DESKTOP-SINGLE-INSTANCE`（取代 PACK-01 的 BASIC 占位行）：boot-plan 决策合同（锁检查先于一切启动分支）＋冒烟阶段 C
  - `DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK`：PORT-01 口径镜像（bind 探测/EACCES→reserved/+1 起向上 40 次/TRAINER_PORT_FALLBACK 严格格式）
  - `DESKTOP-PORT-CONFLICT-TRAINER-ASK`：三应答×复核矩阵（reuse 不启第二服务/bindCheck 未调用为证；restart 复核 pid 一致才杀；cancel 不杀不启；应答期间消失落 bind 裁决）＋冒烟阶段 E
  - `DESKTOP-GRACEFUL-QUIT-DRAIN`：in-app 退出口径（prepare(allowActiveTraining:true)——未完成训练保留 SQLite）＋单飞＋无服务直退；冒烟阶段 D
  - `DESKTOP-DRAIN-TIMEOUT-FORCE`：drain-timeout/outer-timeout/shutdown-timeout→强制退出如实记录；env 默认 15000/覆盖/非法拒绝
  - `DESKTOP-QUIT-NO-ORPHAN`：关闭错误/重复路径收敛 exit＋shutdown 至多一次；冒烟阶段 D 端口释放断言
  - `DESKTOP-EXTERNAL-LINKS`：classifyUrl 三分支（external/in-app/denied）；main.ts setWindowOpenHandler＋will-navigate 粘合
  - `DESKTOP-WINDOW-BOUNDS-PERSIST`：严格解析/工作区 clamp/1024×680 最小/序列化回读；持久化位置 `<dataDir>/window-state.json`
- **open=8（planned）**：PACK-01 手册/粘合行（EMBED-SERVER-STARTS／WINDOW-LOCAL-URL／DEV-SCRIPTS／PORTABLE-EXE-SMOKE／ZIP-ZERO-BREAK——后两者的脚本收据本轮已更新但 vitest 绑定形态未建）＋PACK-03..05 占位三行。strict exit=3 为设计内状态。

## 四、改动清单

- **desktop/src/** 新增纯函数决策层（全部 vitest 覆盖）：`boot-plan.ts`（单实例启动分支）、`port-conflict.ts`（isTrainerHealthBody 身份/冲突应答解析/bind 探测+回退扫描/resolvePortPlan 决策树/真实 probeHealthHttp+bindCheckTcp）、`quit-state.ts`（退出状态机 reducer＋drain 超时 env 解析）、`window-bounds.ts`（严格解析/工作区 clamp/最小尺寸/序列化）、`external-links.ts`（URL 三分类）。
- **desktop/src/main.ts** 重写粘合层：planInstanceBoot→端口决策（env 应答注入优先于原生 dialog 三选）→reuse 分支直接加载占用者 URL／start 分支注入 TRAINER_PORT_FALLBACK＋实际端口→内嵌服务；窗口（bounds 记忆/clamp/最小尺寸/安全基线 contextIsolation+nodeIntegration:false+sandbox/外部链接 setWindowOpenHandler+will-navigate→shell.openExternal）；退出（window-all-closed→quit-state reducer 驱动 drain→shutdown→quit；外层超时 app.exit 兜底；before-quit 单飞兜底）。
- **desktop/test/** 新增五文件 34 例＋既有 desktop-config 6 例。
- **desktop/scripts/smoke-desktop.mjs** 扩展：阶段 C/D/E（见 §二）；stderr 捕获三通道＋fd 显式关闭；CloseMainWindow 按父 PID 限定进程树。
- **server/src/index.ts**：**+9/−2 行纯增量**——`StartedTrainerServer` 增加 `drain: DrainController` 字段并在 return 暴露（优雅退出接线；复用冻结控制器函数本体，不新造退出协议；CLI 分支零改动）。`server/test/server-entry-programmatic.test.ts` ＋1 例锁句柄暴露。
- skill 侧：`desktop-app.yaml` 8 行升级＋SERVER-ENTRY 扩条款（工作区 `.zcode/skills/ai-harness/matrix/`＋`ai-harness-lab/skill-v1/matrix/` 镜像同步，diff 空为证）。

## 五、待拍板项（proposed_default，呈现/默认类——已按保守默认实现，验收确认或调整后升级）

1. **排空超时默认 15s**（`TRAINER_DESKTOP_DRAIN_TIMEOUT_MS` 可覆盖；控制器自身 drainBudget 10s，外层 15s 覆盖之）——派发简报给的默认值。
2. **窗口 bounds 持久化位置**＝`<dataDir>/window-state.json`（与数据同目录，随数据迁移；备选 %APPDATA%）。
3. **最小尺寸 1024×680／默认 1360×860 居中**（无记忆时 Electron 默认居中）。
4. **菜单形态**：沿用 `autoHideMenuBar: true`（Windows 惯例：平时无菜单栏、Alt 呼出）。
5. **非训练器占用一律自动回退**（含 PORT env 显式给定时）——按派发简报决策③字面；与 launcher「显式端口拒绝」存在口径差（桌面形态「应用必须能启动」UX 优先），如需对齐 launcher 再拍板收紧。
6. **外部链接 deny 策略**：非 http(s) 协议（mailto/file/about）一律拒绝且不外开（保守）；应用源内 window.open 也拒绝（应用无多窗形态）。
7. **无 preload**：本轮无需 IPC（PACK-04 更新通道再最小暴露面）。
8. **冲突对话框文案/按钮序**（连接已有服务=默认/结束并重启/取消=Esc）——呈现类可验收时调整。

## 六、设计细节

见同目录 `design.md`（生命周期状态机全失败分支、冻结语义资产复用表、纯函数抽层与冒烟扩展设计）。
