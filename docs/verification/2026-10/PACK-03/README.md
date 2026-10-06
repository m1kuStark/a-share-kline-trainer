# PACK-03 验证记录：数据与配置兼容（历史数据零丢失防线）

任务卡：`docs/work-items/tasks/PACK-03.md`（里程碑 PACK）｜base 5f74db0｜2026-10-06｜设计：`design.md`

本轮为**接续轮**：前代理遗留未提交半成品（data-home/coexist-guard 决策层＋三测试文件＋main.ts 粘合＋冒烟扩展草稿），本审计沿用其主体、按 TDD 修正三处偏离并补齐全部门禁（审计结论见 §三）。

## 一、验证收据（机器结果）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| TDD RED（本轮修正①③） | `npm run test:desktop`（实现前） | 1 | 精确 2 例失败：损坏 choice 文件按无记录容忍（当前 reject）＋savedChoiceSearchDir 未导出——缺功能失败非语法/环境错 |
| TDD GREEN | `npm run test:desktop` | 0 | **87/87**（data-home 22＋data-home-fs 5＋coexist-guard 18＋desktop-config 8＋PACK-01/02 既有 34） |
| desktop 定向（终态复跑） | `npm run test:desktop` | 0 | 87/87 |
| 全量测试 | `npm test` | 1 | 1515/1516；唯一失败＝`server/test/review-profile.test.ts > docs-only classification > accepts root README and CONTRIBUTING edits and plain markdown deletions`——自建 fixture 仓库与本轮 diff 无共享状态，**单文件复跑 16/16 exit 0**，判并行负载 flaky（PACK-02 验证记录已登记同类现象） |
| 构建 | `npm run build` | 0 | typecheck:web＋build:server＋build:web 全过 |
| 桌面主进程编译 | `npm run build:desktop:main` | 0 | tsc 零错误（notice 收敛后复跑） |
| 桌面打包 | `npm run build:desktop` | 0 | 便携 exe 99.0 MB（最终版含全部修正） |
| 打包冒烟 | `node desktop/scripts/smoke-desktop.mjs --exe desktop/release/kline-trainer-desktop-v1.2.7-windows-x64.exe` | 0 | **SMOKE_PASS total=121.1s**，A-G 全断言过（§二） |
| 绑定检查 | `check-binding.mjs --matrix desktop-app.yaml --strict --include-untracked` | 3（设计内） | 27 行：covered=19／open=8／**RED=0**；open 全为既有 planned 债务（PACK-01 手册/粘合行 5＋saved-choice 粘合行 1＋PACK-04/05 占位 2） |
| 零破坏 | `git diff HEAD --stat -- scripts/release/ web/ launcher.cjs server/src server/test package.json` | — | **空**（zip 形态/PORT-02/UPD 语义零改动；server 侧零改动） |
| 变异 M1（executed） | data-home：E3 库判据 `trainer.sqlite`→`saved-tdx-choice.json`→定向跑 | 1 | 单测桩层 **4 例死**（主杀手＝`DATA-DISCOVERY-ADOPT: a directory containing only saved-tdx-choice.json or -wal files is NOT a library`）；fs 层 2 例幸存（fixture 同时含两种文件，属夹具局限非断言弱）；回退后 87/87 绿 |
| 变异 M2（executed） | coexist-guard：`probeMatchesState` 删 pid 匹配→定向跑 | 1 | 精确 1 例死＝`restart spares a vanished or identity-changed owner and proceeds without killing`（killed=[4321]≠[]——防误杀身份已变进程）；回退后 18/18 绿 |

## 二、打包冒烟断言（SMOKE_PASS 收据逐条）

| 阶段 | 断言 | 实测 |
|---|---|---|
| A-E | PACK-02 三阶段回归（health/currentVersion/首页/窗口/单实例/优雅退出/无孤儿/冲突 restart 注入接管/退出释放端口） | 全过（boot 12.6s；窗口计数 2——含当时残留的诊断实例窗口，≥1 判据通过） |
| F 首启发现/采用 | 全套一致 profile 沙箱（USERPROFILE/HOMEDRIVE/HOMEPATH/APPDATA/LOCALAPPDATA/TEMP/TMP→临时 home）＋伪造历史库（真实迁移建库＋settled 行 SMOKEF1）；无 TRAINER_DATA_DIR/TRAINER_DB 启动 | **legacy library adopted in place: history total=1, marker row visible**；no fresh data/ created；exe exited 0；choice record **mode=adopted → 伪造库路径** |
| F 幂等 | 优雅退出后二次启动 | 仍 marker visible；仍 no fresh data/；exit 0；adoption-child PASS |
| G 同库共存防线 | dataDir 预置 launcher 格式活 trainer-state.json（runId=run-<uuid36>）＋假训练器→`TRAINER_DESKTOP_CONFLICT_ANSWER=reuse` | recorded trainer **health-probed (2 hits)**（身份复核＋应答后复测；hits 在 spawn 前清零排除自身轮询污染）；**exe did not start a second server (port stays unbound)**；**no library file created**；cleanup exit 0 |

隔离铁律执行：全部临时目录＋动态随机端口；阶段 F 的 profile 沙箱整套一致重定向（见 §五发现 1）；TDX_ROOT 置空；CloseMainWindow 只发给我们进程树子进程；冒烟脚本自身无孤儿（收尾 process.exit 收口）。

## 三、接续轮审计结论（前代理半成品沿用/修改）

**沿用（主体）**：`data-home.ts`/`coexist-guard.ts` 决策层（launcher.cjs 冻结语义镜像逐条核对一致：resolveConfig 169-203、readOwnedState/assertStateIdentity 704-742、decideRecordedServer 773-788、probeMatchesState、acquireLaunchLock 803-827、writeStateFile、pidAlive EPERM＝活）；三个测试文件主体；desktop-config defaults 合并层；main.ts 粘合骨架；矩阵 7 行 covered＋镜像；design.md 数据落点清单。

**修正（TDD，RED→GREEN）**：
1. `resolveDataHome` E2：desktop-data-choice.json **非 JSON 损坏**→按无记录容忍重发现（原实现经 node 适配层会 throw→brick 启动，偏离 design E2「损坏/异己→null 视为无记录」；desktop 自有文件≠用户配置）。
2. 新增 `savedChoiceSearchDir` 纯函数：saved-tdx-choice 搜索目录＝**生效 dataDir**（env 显式 TRAINER_DATA_DIR>解析产物>便携默认；原实现 E0 时回落 exe/data，违背矩阵行措辞）；main.ts 接线。
3. 冒烟阶段 G 预置记录的 runId 原为假训练器上报的 `run-fake-occupant`，不满足 RUN_ID_PATTERN→判 stale＋活 pid→必拒启动（收据：`node -e` 正则验证 false）；spawnFakeTrainer 增加 runId 参数，阶段 G 传 `run-${randomUUID()}`。

**本轮新增修正（冒烟调试中发现，见 §四/§五）**：冒烟 ready-poll 不死循环（resolve 后无 return→200ms 永久轰击＋node 永不退出＋tail 管道吞输出）；阶段 G 断言竞态（固定 3s vs exe 实测 12s 引导；改为等守卫决策证据＋hits 清零）；成功路径子进程清理＋总超时 process.exit；失败路径 stderr 现场转储＋阶段 F 退出码断言；阶段 F 改 `--adopt-child` 子模式宿主；main.ts notice 收敛 console-only（对话框两形态硬伤）；saved-choice 触发条件补 2s userData 缓冷。

## 四、改动清单（相对 base 5f74db0）

- `desktop/src/data-home.ts`（新）：首启数据发现/采用决策层（E0-E3 状态机＋trainer.config.json 镜像解析＋采用记录＋saved-tdx-choice 形状门＋savedChoiceSearchDir＋node fs 适配＋原子落盘）。
- `desktop/src/coexist-guard.ts`（新）：双形态共存裁决层（状态记录分类/decideCoexistence 三应答×复核/launch.lock/状态记录写入体/身份复核清理）。
- `desktop/src/desktop-config.ts`：defaults 合并参数层（env>defaults>内置结构化保证）＋hasExplicitDataOverride＋buildServerEnv runId/tdxSource 通道。
- `desktop/src/main.ts`：启动序插入发现/采用（步骤1）→saved-choice 沿用（步骤2）→launch.lock＋共存裁决＋状态记录写入/清理（步骤3）；notice console-only。
- `desktop/test/`：data-home 22 例＋data-home-fs 5 例（真实 fs 哈希不变量）＋coexist-guard 18 例＋desktop-config +2 例。
- `desktop/scripts/smoke-desktop.mjs`：阶段 F（子模式宿主＋全套沙箱＋幂等二次启动）＋阶段 G（决策证据等待＋hits 清零）＋生命周期收口修正。
- `docs/verification/2026-10/PACK-03/`（design.md＋本 README）＋任务卡；skill 侧矩阵 desktop-app.yaml（7 行 covered＋note/binding_note 刷新）＋`ai-harness-lab/skill-v1/matrix/` 镜像（diff 空为证）。
- **server/src、server/test、web、scripts/release、launcher.cjs、package.json 依赖：零改动。**

## 五、Electron/Windows 平台实测发现（诊断矩阵摘要；全文见 design.md §八）

| # | 实验 | 结果 |
|---|---|---|
| 1 | 仅 USERPROFILE 重定向（env 路径/发现路径均然） | 崩 0x80000003 @+17s（WER：exe 本体断点；固定偏移） |
| 2 | 全套一致 profile 重定向（独立宿主） | 健康（diag5/6/7、t2/t4、electron CLI 直跑） |
| 3 | 同参数 spawn：冒烟主进程内 vs 独立宿主 | 主进程内 100% 自退 0xFFFFF003（无 WER/无输出/无解压残留，含最小 env 白名单对照）；独立宿主 100% 健康（7+ vs 10+） |
| 4 | 保留现场拆分（t2 场景exe+新home／t3 新exe+旧home／t4 补 TEMP） | t2/t4 健康、t3 崩（TEMP 缺失时 stub 不解压即自退） |
| 5 | `dialog.showMessageBox` 无父窗口 vs 挂主窗口 | 无父→原生崩溃；挂主→模态阻塞 CloseMainWindow 60s 不退出 |
| 6 | 打包 exe console 输出（双流捕获） | 恒 0 字节（GUI 子系统；健康/崩溃皆然） |

**隔离事故披露（needs_user_attention，如实呈报）**：诊断变体 `no-userprofile`/`temp-only` 曾以真实 %USERPROFILE% 启动打包 exe 一次，本机恰存在真实历史库 `C:\Users\Stark_Du666\.a-share-kline-trainer`，被 adopt-in-place 采用并起服务约 25 秒（health 200）。损害评估：既有文件零删除零覆盖（备份库/server.log/saved-tdx-choice 原样）；`trainer-state.json`/`launch.lock` 被身份复核清理正确移除（反向防线实证）；唯一残留新文件 `window-state.json` 已删除；`trainer.sqlite` mtime 变更（SQLite WAL 打开/检查点所致，仅调用读端点，无逻辑写入）。事故主因＝诊断变体未保持 USERPROFILE 重定向铁律；副产启示＝**adopt-in-place 在真实历史库上端到端有效**（发现→采用→服务→退出清理全链路正确）。

## 六、行为矩阵状态（desktop-app.yaml，27 行）

- **covered=19**（本轮新增 7）：`DATA-DISCOVERY-ADOPT`／`DATA-MULTI-CANDIDATE-DIALOG`／`DATA-FRESH-DEFAULT`／`DATA-ADOPT-IDEMPOTENT`／`CONFIG-LEGACY-ADOPT`／`COEXIST-SAME-DATADIR-GUARD`／`NO-DELETE-INVARIANT`——L2 证据见各 binding_note（变异 M1/M2 executed）。
- **open=8（planned，既有债务）**：PACK-01 手册/粘合 5 行＋`DATA-SAVED-TDX-CHOICE-FOLLOW`（决策层已测、e2e 粘合无断言，design §2.4 proposed_default）＋PACK-04/05 占位 2 行。strict exit=3 为设计内状态。
