# 自更新链工程师审查简报（供独立 AI reviewer 冷审）

> 任务：U5-BRIEF（用户 2026-10-19 拍板 9：AI 冷审）。撰写日期 2026-10-19，基线 main@6533196。
> 纪律依据：ai-harness skill（证据优于声明——本文每个事实标注来源「文件:行号」或矩阵行 ID；
> 未验证项显式标 **unknown** 或「库域行为」。矩阵文件＝工作区 `.zcode/skills/ai-harness/matrix/updater.yaml`。
> 本简报须自足：reviewer 无需口头补充即可审。

---

## 0. 审查范围与链路状态界定（先读，防误审）

本仓库自更新相关代码实际构成 **三条链路、两种存续状态**。reviewer 必须先分清「live」与
「retired-but-in-code」，不能把退役链当现行链审，也不能漏掉它：

| 链 | 形态 | 状态 | 激活条件 | 依据 |
|---|---|---|---|---|
| **A. NSIS＋electron-updater** | NSIS 安装版（v1.3.0 起唯一正式发布形态） | **live（生产主链路）** | `app.isPackaged` 且非便携形态 | `desktop/src/main.ts:439-455`；`desktop/electron-builder.yml:34-39`（INSTALL-01 拍板，NSIS 单 target） |
| **B. zip＋服务端 HTTP 换装（UPD-01/02）** | zip 包直跑（server＋web） | **live（兜底形态，同 Release 共存）** | zip 形态运行（渲染端回落 HTTP 端点） | 发布手册 `docs/release/desktop-release-manual.md` §四：「zip：历史用户与离线环境兜底；zip 内置的 HTTP 在线更新（UPD-01/02）语义不变，同 Release 共存」。注意：root 任务卡的「现行生产链路」表述只点名链 A，但链 B 仍在每版发布物中随包分发且语义活跃，防护清单里的「备份 5 份/逆序回滚」就在这条链上——漏审它＝漏审主防护 |
| **C. 便携自研 cmd 替换链（PORT-UPD-01）** | 便携 exe 自替换 | **retired-but-in-code（退役但代码在仓库）** | `isPortableExecution`（env `PORTABLE_EXECUTABLE_DIR` 非空白，仅 electron-builder portable target 注入） | `desktop/src/portable-updater.ts:1-8` 头注（@deprecated，INSTALL-01 2026-10-11 用户拍板）；v1.3.0 起 latest.yml 不再含便携条目，存量 ≤v1.2.7 便携 exe 检查更新得「更新源未提供便携版产物」fail-closed 拒装（`portable-updater.ts:495`）。模块保留一个版本周期防发布回滚；**若未来复活便携形态，本链即成 live** |

链 A 的端到端时序（本文第 3 节逐步展开）：
检查（latest.yml，feed 计划＝env 注入 > 用户三态设置 > 自动＝国内镜像优先、失败回退 GitHub 一次）
→ 手动下载（electron-updater，下载产物 sha512 内建校验；90s 停滞看门狗在 controller 层）
→ 下载完成 → 排空退出管线（drain.prepare(allowActiveTraining:true) → shutdown 收敛）
→ exit 分支 `quitAndInstall(true,true)` → NSIS 静默安装（--updated 旗标；旧版静默卸载 /S /KEEP_APP_DATA）
→ 重启。数据目录 `%USERPROFILE%\.a-share-kline-trainer` 不在安装目录，安装/卸载天然不触碰。

---

## 1. 现有防护清单（防护项 × 代码位置 × 矩阵行）

| # | 防护 | 适用链 | 代码位置（文件＋函数/常量） | 矩阵行 |
|---|---|---|---|---|
| 1 | **sha512 校验（下载产物）** | A | electron-updater 库内建（latest.yml 条目 sha512；fixture 集成测试证据 `desktop/test/desktop-updates-fixture.test.ts`「env feed routes the updater to the local generic source」断言 sha512 校验后下载成功）。我方层不做二次校验（`desktop/src/update-adapter.ts:87-101` 纯透传） | UPD-DESKTOP-CHANNEL-PACKAGED（「下载产物经 sha512 校验（electron-updater 内建）」）；C 链等价物见 `portable-updater.ts:533-537`（自算 sha512+size 对 latest.yml 条目，fail-closed 删文件拒装，行 UPD-PORTABLE-CHECK 时代语义，今 superseded） |
| 2 | **SHA256SUMS 强制校验（zip 资产）** | B | `server/src/update/api.ts:83-91`（pickShaFromSums：按名取唯一校验和，多处/缺失即拒）＋ `server/src/update/zip.ts:155` 起（带期望值强制校验；无期望值退 zip central directory＋release.json 版本＋nodeVersion 一致性校验） | UPD-DOWNLOAD-VERIFY |
| 3 | **更新前备份（5 份轮换）** | **仅 B** | `server/src/update/updater-core.ts:99-119` `backupPreserveFiles`（preserve 集＝trainer.config.json＋trainer.sqlite(+wal/shm)＋saved-tdx-choice.json＋trainer-state.json）＋ `:122-132` `rotateBackups`（字典序保留最新 keep 份，默认 5）；编排挂接 `server/src/update/updater.ts:198-204`（备份失败 fail：不动任何包文件） | UPD-BACKUP-BEFORE-SWAP。**缺口提示：链 A（NSIS）与链 C（便携）均无应用级备份**——链 A 的结构性替代＝数据目录在安装目录外＋NSIS /KEEP_APP_DATA；链 C 的结构性替代＝数据目录与 exe 分离（`portable-updater.ts` staging 落数据目录）。安装目录本体无备份 |
| 4 | **失败逆序回滚** | **仅 B（JS catch 路径）** | `server/src/update/updater-core.ts:190-198`（performSwap 任一步失败→rollbackSwap 逆序：已放置删除、已移走移回；回滚失败叠加进错误消息）＋ `:207-217` `rollbackSwap`；preserve 核验失败→备份恢复＋整体回滚（`updater.ts:225-230`、`rollbackSwapFromTrash :253-257`） | UPD-APPLY-ROLLBACK。**缺口提示：回滚仅在更新器进程存活的 catch 路径执行；断电/被杀 mid-swap 时不触发（见 §3-B 表与 §4）** |
| 5 | **prerelease 灰度** | 发布流程层（A/B 共用） | 无代码落点（grep `prerelease|allowPrerelease` 于 desktop/src、server/src、web/src 零命中）——依赖 electron-updater **缺省 allowPrerelease=false**：GitHub Release 标记 prerelease 的版本（如 v1.3.1 验证版）不会推给普通用户。流程证据：`docs/复盘缺口修补-开发计划.md`（v1.3.1 prerelease 验证存档）；发布手册排障表（「Release 是否为 latest（非 prerelease/draft）」） | 无专属矩阵行（发布实践，非 EARS 行为）。**unknown 项：electron-updater 缺省 allowPrerelease 语义未被仓库测试直接锁定**，reviewer 可评估是否补行 |
| 6 | **下载停滞看门狗（90s）** | A（controller 层，对 electron-updater 与便携适配器同面生效） | `desktop/src/desktop-updates.ts:171` `DOWNLOAD_STALL_TIMEOUT_MS=90_000`；`:177-183` `resolveDownloadStallTimeoutMs`（env `TRAINER_DESKTOP_DL_STALL_MS` 覆盖；坏值 fail-safe 回默认，不允许关看门狗）；`:241-252` `fireStall`（Promise.race 独立收敛，不依赖底层 settle）；`:254-262` progress 推进即重置 | UPD-DL-WATCHDOG（含 RED/变异收据，DL-HANG-01）。**注意：链 B 是 900s 总预算超时而非进度看门狗**（`server/src/update/api.ts:100,108-109`：manifest 30s、zip 900s；DL-HANG-01 §1.3 已登记「慢速 trickle 理论上可占满 15 分钟」为残余） |
| 7 | **断线重连（渲染端轮询）** | B（A 链为事件面，无轮询） | `web/src/updateFlow.ts:57-59` `RECONNECT_INTERVAL_MS=2_000` / `RECONNECT_MAX_ATTEMPTS=15`；`web/src/components/TrainingSettings.vue:583` 起 `pollUpdateStatus`（15 次用尽→手动 Start.cmd 指引，:620） | UPD-UI-APPLY-FLOW（2s×15 为简报冻结参数） |
| 8 | **进程级 uncaught 兜底** | A/B/C（桌面主进程域） | `desktop/src/main.ts:124-129` `process.on('uncaughtException'/'unhandledRejection')`→记日志不退出；`:112-122` `formatUnknownError`（undefined/不可字符串化全容忍）；注册位置＝模块体最早可达语句（`main.ts:95-111` 注释：Electron 默认崩溃窗本身是 uncaughtException 监听器，listenerCount>1 即自禁） | UPD-NET-ROBUST-PROCESS-WIDE；UPD-QUIT-TYPEERROR-GUARD（含「handler 注册最早化」源码契约用例） |
| 9 | **镜像回退（国内优先→GitHub）** | A＋B 双链 | A：`desktop/src/cn-feed.ts:57-76` `resolveDesktopFeedPlan`（env > official/custom 三态设置 > auto＝[镜像, GitHub] 有序；镜像常量 `CN_MIRROR_BASE`＝`server/src/update/manifest.ts:27`，当前已填 CloudBase 镜像 URL）＋ `:103-154` `createFeedFallbackAdapter.checkForUpdates`（逐源 setFeedURL，全失败抛最后一源错误；check 成功源冻结用于下载）。B：`server/src/update/manifest.ts:35` `cnMirrorManifestUrl`＋清单获取回退（矩阵行 UPD-CN-FALLBACK-HTTP） | UPD-CN-FALLBACK-DESKTOP / UPD-CN-FALLBACK-HTTP；观测缝 boot-check.json sources（`desktop/src/update-ipc.ts:64-70`） |
| 10 | 排空前置安装守卫（补充项，链 A/C 安装不绕过数据排空） | A＋C | `desktop/src/desktop-updates.ts:126-128` `resolveInstallActionOnExit`（forced 路径绝不安装→plain-quit，更新留缓存可重试）；`desktop/src/main.ts:785-801` exit 分支唯一消费点；`update-adapter.ts:62-63` autoDownload/autoInstallOnAppQuit 双 false | UPD-DESKTOP-INSTALL-DRAINS-FIRST（变异 executed：删 forced 守卫被击杀） |

---

## 2. 关键代码位置索引（文件级＋函数级）

### 链 A（live·NSIS＋electron-updater）

| 关注面 | 位置 |
|---|---|
| 主进程更新编排 | `desktop/src/desktop-updates.ts` `createDesktopUpdateController`（:227-340）：checkForUpdates（mapCheckView 单一版本口径复核，adapter 回显仅参考，:265-281）、downloadAndInstall（:283-338：downloading/checked 双守卫→看门狗状态→download-started 事件→Promise.race→downloaded→requestInstallWithDrain） |
| 通道切换/初始化 | `desktop/src/main.ts` `setupUpdateChannel`（:404-488）：便携分支（:407-438）→NSIS 分支 `defaultDesktopUpdater()`→`adaptElectronUpdater`→`createFeedFallbackAdapter` 包装（:439-455）；controller 装配（:457-469，stallTimeoutMs env 解析）；`registerUpdateIpc`（:470-487，boot 检查观测缝＋onBootNotice 投递） |
| electron-updater 适配 | `desktop/src/update-adapter.ts` `adaptElectronUpdater`（:60-118；手动语义双 false :62-63；downloadUpdate CancellationToken 转换 :87-101）；`defaultDesktopUpdater`（:125-133，CJS getter interop 取实例——冒烟曾因具名导入拿不到 autoUpdater 崩，:120-124 注释） |
| feed 计划/镜像回退 | `desktop/src/cn-feed.ts`（见 §1-9）；用户三态设置读取 `readUpdateSourceSetting`（server 编译产物 re-export，:10） |
| 退出/安装裁决 | `desktop/src/quit-state.ts` `nextQuitState`（:43-116，纯 reducer：request-quit→draining→closing→quit；外层超时 15s 缺省 :36）；`desktop/src/main.ts` `dispatchQuitEvent`（:772-811，exit 分支 :785-809 安装裁决＋quitAndInstall 同步抛错就地捕获回落 plain quit）；`requestGracefulQuit`（:813-825）；window-all-closed→优雅退出（:827） |
| IPC 面 | `desktop/src/update-ipc.ts` `registerUpdateIpc`（:42-81；`desktop-update:invoke`/`desktop-update:event` 两条通道，UPD-DESKTOP-IPC-MINIMAL）；preload＝`desktop/src/preload.cts`（contextBridge 只暴露 desktopUpdates） |
| 包内更新配置 | `desktop/build-resources/app-update.yml`（provider github＋updaterCacheDirName=a-share-kline-trainer；经 extraResources 静态入包——electron-builder v26.15.3 --publish never 不产该文件，`desktop/electron-builder.yml:3-16` 注释） |
| 安装器钩子 | `desktop/build-resources/installer.nsh`：`customInit`（:29-78，升级检测呈现＋幽灵注册守卫）、`customUnInstall`（:106-116，卸载询问删数据目录；Silent 守卫隔离升级链） |
| 渲染端（B 链 UI＋A 链事件映射） | `web/src/updateFlow.ts`（轮询决策/重连/事件映射纯函数）；`web/src/components/TrainingSettings.vue`（「关于与更新」分栏：check 三态/apply 状态机/守卫人话/断线重连 :583-620） |

### 链 B（live·zip HTTP 换装）

| 关注面 | 位置 |
|---|---|
| API 端点/守卫 | `server/src/update/api.ts`（/api/update/check 三态；apply 前置守卫 UPDATE_NOT_PACKAGED :314 / ACTIVE_TRAINING :323 / UPDATE_IN_PROGRESS :327 / UPDATE_NOT_AVAILABLE :341） |
| 清单/校验 | `server/src/update/manifest.ts`（清单四级优先级＋镜像回退）；`server/src/update/zip.ts`（SHA256/central directory/版本/nodeVersion 校验）；`server/src/update/safe-http.ts`（原生网络层，截断→人话错误） |
| 换装核心 | `server/src/update/updater-core.ts`（备份/轮换/performSwap/rollbackSwap/preserve 快照核验/备份恢复） |
| 独立更新器编排 | `server/src/update/updater.ts` `runFromPlan`（:175-251，detached 进程；控制令牌经 env :56-87）＋ `defaultDeps`（:93-172：等 pid 退出 20s/端口释放 10s/健康核验 40s/relaunch spawn launcher.cjs） |
| 状态文件 | `server/src/update/status.ts`（writeUpdateStatus，渲染端轮询的数据源） |

### 链 C（retired-but-in-code·便携 cmd 替换）

| 关注面 | 位置 |
|---|---|
| 适配器（DesktopUpdaterAdapter 同面） | `desktop/src/portable-updater.ts` `createPortableUpdaterAdapter`（:459-582：checkForUpdates :484-506 / downloadUpdate :508-540 / quitAndInstall :542-576） |
| 替换目标解析（P0-1 修复） | `resolvePortableTargetExe`（:60-67：PORTABLE_EXECUTABLE_FILE 优先，缺失 fail-closed throw 绝不回退 execPath 临时副本） |
| 替换脚本渲染 | `renderReplaceScript`（:181-216；时序/退出码见 §5） |
| 启动残留清理 | `cleanupPortableUpdateLeftovers`（:224-237；挂接 `main.ts:606-612`，非便携 no-op，失败仅吞） |
| 网络层（P0-3 修复） | `openUpdaterResponse` :271-323（重定向上限 5）/`defaultFetchText` :335-368（15s 超时）/`defaultDownloadToFile` :370-412（600s 总预算＋截断人话） |

---

## 3. 中断点状态机表（核心）

> 阅读约定：「中断」指断电/进程被杀/未捕获异常等**进程不存活**的硬中断（JS catch 路径的软失败见各链防护行）。
> 「下次启动」指用户下一次双击图标。**凡标「需人工」即无自动恢复，为 reviewer 重点核查项。**

### 3-A. 现行生产链路（NSIS＋electron-updater）

| 步骤 | 中断后机器状态 | 用户下次启动发生什么 | 自动恢复/残留 |
|---|---|---|---|
| A1 boot 自动检查（`update-ipc.ts:55-80`，fire-and-forget 只读） | 零副作用 | 重新检查 | 无残留（观测缝 boot-check.json 仅 env 注入时落盘） |
| A2 手动检查（latest.yml 拉取＋解析） | 零应用副作用（electron-updater 可能在用户缓存目录留中间态） | 重新检查 | 自动 |
| A3 下载中（electron-updater 下载 setup exe＋blockmap 至 updaterCacheDirName 缓存目录） | 缓存内部分/完整文件；**应用本体零触碰** | boot 检查/手动重试；electron-updater 按缓存与 blockmap 续传或重下（库域行为，repo 未专项测试＝**unknown**） | 自动（缓存可弃）；停滞 90s 有看门狗反馈（进程存活时） |
| A4 下载完成→排空（drain.prepare→shutdown；`main.ts:772-811`） | 服务排空/关闭中断；**安装未触发**（exit 未到达）；更新已在缓存 | 旧版本正常启动；设置页重新「检查→下载」（缓存可复用） | 自动可重试（UPD-DESKTOP-INSTALL-DRAINS-FIRST：forced 路径绝不安装，更新留缓存） |
| A5 `quitAndInstall(true,true)` 已调用→NSIS 静默安装器启动前 | 应用已退出（或正在退出）；安装器未跑 | 旧版本原样启动；更新仍在缓存 | 自动可重试 |
| A6 NSIS 安装器运行中：静默卸旧（`uninstallOldVersion`，/S /KEEP_APP_DATA --updated；electron-builder 模板行为，INSTALLER-UPGRADE-01 §1.2-③ 实证） | **中断窗口①：旧版半卸载**——安装目录文件部分缺失 | **unknown（库域，repo 无断电注入测试）**：若旧 exe 尚存→旧版可启动；若已删→启动失败，需用户手动重跑安装包（缓存里有 setup exe 但无自动重装逻辑） | **需人工（缺口）**：无应用级自动恢复 |
| A7 NSIS 安装器运行中：新文件拷贝中 | **中断窗口②：新旧混合**——部分新文件就位 | 同 A6：可启动则版本混杂（可再跑安装器修复），不可启动则需人工 | **需人工（缺口）** |
| A8 安装完成→注册表刷新→重启应用前 | 新版完整就位 | 用户双击＝新版启动；boot 检查恢复正常 | 自动 |
| 全程 | 数据目录 `%USERPROFILE%\.a-share-kline-trainer` 不在安装目录且卸载链带 KEEP_APP_DATA＋--updated（`installer.nsh:92-96` 注释＋模板实证）——**数据不受任何中断点影响** | — | 结构性保护 |

### 3-B. live 兜底链路（zip＋服务端 HTTP 换装，runFromPlan 逐步）

| 步骤 | 中断后机器状态 | 用户下次启动发生什么 | 自动恢复/残留 |
|---|---|---|---|
| B1 下载 zip＋SHA256SUMS 校验（`api.ts`，900s 预算） | `<dataDir>/update-downloads/` 内部分文件；状态 failed | 重新 apply 即重下 | 自动（下载前可覆盖） |
| B2 拉起 detached 更新器→prepare→shutdown→等旧服务退出（`updater.ts:184-195`） | 服务已停；**包文件零改动**（三重前置任一失败＝安全态：fail 文案明示「服务仍在运行，未改动任何文件」） | 手动 Start.cmd（fail 文案已指引）或重启入口 | **需人工重启服务**（软失败路径有指引；硬中断时状态文件停在 backing_up，渲染端呈现卡住） |
| B3 备份 preserve（`updater-core.ts:99-119`） | backups/update-<ts>/ 部分内容；包零改动 | 正常旧版 | 自动（残留无害，下轮轮换清理） |
| B4 performSwap：rename 旧文件进 trash（`.update-trash-<attemptId>`） | **中断窗口③：部分旧文件已在 trash、原位缺失**；新文件未放 | **无自动恢复**：状态停在 applying；Start.cmd 可能启动文件混杂的包 | **需人工（缺口）**：trash 目录在包根旁（`updater.ts:210`），手动 rename 回可恢复；**进程存活的 catch 路径有逆序回滚（§1-4），断电不触发** |
| B5 copy 新文件就位 | 同 B4（中断窗口③'：部分新就位＋部分旧在 trash） | 同 B4 | **需人工（缺口）** |
| B6 preserve 核验/备份恢复/整体回滚（`updater.ts:225-230`） | 若核验已过：新包就位、服务未起 | Start.cmd 启新版（fail 文案：「包已更新到 vX，自动重启失败…历史训练数据已保留」） | **需人工启动**（指引在错误消息里） |
| B7 relaunch＋健康核验（40s）→completed＋清理 | 同 B6 | 同 B6 | 指引完备 |

### 3-C. retired-but-in-code（便携 cmd 替换脚本，`portable-updater.ts:181-216` 渲染）

前提：主进程已排空并退出，detached cmd 脚本独立运行。脚本步骤＝①ping 固定延时 30s（`ping -n 31`，P0-6 后为计时延时不探活）→②`move /y EXE OLD_EXE`（失败 exit 3）→③`move /y STAGING_EXE EXE`（失败→回滚 `move /y OLD_EXE EXE`→exit 4）→④`del /f /q OLD_EXE`（失败不阻塞）→⑤`start "" /B EXE`→exit 0。

| 步骤 | 中断后机器状态 | 用户下次启动发生什么 | 自动恢复/残留 |
|---|---|---|---|
| C0 主进程 drain/spawn 脚本前中断 | staging＋脚本已写（或未写）；用户 exe 完好 | 旧版正常启动；`cleanupPortableUpdateLeftovers`（`main.ts:606-612`）清 staging 与 .old | 自动 |
| C1 脚本 30s 延时等待期中断 | 零触碰（只写了 replace.log 首行） | 旧版正常启动；启动清理删 staging（含脚本/日志） | 自动 |
| C2 ②rename 执行后、③staging move 前中断 | **用户 exe 缺失；<exe>.old 存在；staging exe 存在** | **双击启动失败（找不到 exe）**——清理逻辑在应用内，应用自身已无法启动 | **需人工（关键缺口）**：手动把 .old 改回原名即恢复（数据目录不受影响） |
| C3 ③staging move 失败→回滚 move 执行前中断（AV 持锁触发 exit 4 分支窗口） | 同 C2（exe 缺失＋.old 在） | 同 C2 | **需人工**；进程存活时回滚分支会复位（冒烟用例「替换失败回滚 exit 4 无 .old 残留」锁定） |
| C4 ③成功后、④del .old 前中断 | 新 exe 就位＋.old 残留 | **新版正常启动**；启动清理删 .old | 自动（.old 残留无害） |
| C5 ⑤start 前中断 | 新 exe 就位 | 用户双击＝新版 | 自动 |
| 全程 | 数据目录与 exe 分离（staging 落数据目录），替换只动 exe 与 .old（UPD-PORTABLE-DATA-INTACT） | — | 结构性保护 |

---

## 4. 三类灾难恢复路径分析（现状防护 vs 缺口）

### 4.1 断电（各中断点归并）

- **下载阶段（A3/B1）**：有防护——产物在缓存/下载目录，可弃可重下；A 链 90s 看门狗（进程存活时）＋B 链 900s 预算。
- **排空/退出阶段（A4/B2）**：有防护——安装/换装未开始，旧包完整；A 链 forced 绝不安装（更新留缓存）；B 链三重前置失败＝零改动安全态。
- **换装/替换执行阶段（A6/A7/B4/B5/C2/C3）**：**缺口集中区**。JS catch 回滚（B 链）与 cmd 回滚分支（C 链 exit 4）只在执行体存活时生效；断电绕过一切 catch。B 链残留 trash 目录＋混杂包；C 链残留「exe 缺失＋.old 在」且应用自清理不可达。A 链为 electron-builder/NSIS 库域事务性，repo 无测试证据（unknown），但有天然缓解：安装器可从 GitHub/缓存重新获取手动重跑。**reviewer 重点：是否需要 B 链「启动时检测 .update-trash-* 残留并提示/自动回滚」、C 链若复活便携形态时的同型启动自愈。**
- **数据**：三条链数据目录均与被替换物分离（A：profile 下；B：preserve 不在搬移清单；C：目录分离）——断电不伤数据。

### 4.2 杀软文件锁/隔离

| 场景 | 现状 | 依据 |
|---|---|---|
| C 链 .old 改名被锁 | **有防护**：exit 3 零触碰（脚本 `if not errorlevel 1 goto renamed_ok` 失败即退出，旧 exe 原样） | UPD-PORTABLE-ROLLBACK；冒烟 exit 3/4 用例 |
| C 链 staging 被隔离 | **有防护**：应用前复验 staging 字节（`portable-updater.ts:552-555`），不符→放弃安装并如实退出（fail-closed） | 同上；quitAndInstall catch→onApplyFailure＋quit |
| B 链下载/解压产物被隔离 | **有防护**：sha256/zip 结构校验失败→拒绝进入换装（绝不带病应用） | UPD-DOWNLOAD-VERIFY |
| A 链 quitAndInstall 同步抛错（含安装器被拦立即失败） | **有防护**：`main.ts:795-799` 就地捕获回落 plain quit，更新留缓存可重试 | UPD-QUIT-TYPEERROR-GUARD 绑定用例「quitAndInstall call site catches synchronous adapter throws」 |
| A 链 NSIS 安装器运行中被拦/隔离（中途） | **缺口/unknown**：库域静默安装无 repo 级观测与恢复；残余状态同 A6/A7 | — |
| A 链缓存目录被隔离 | 缓解：重下（缓存可弃）；看门狗兜死寂 | UPD-DL-WATCHDOG |
| 杀软杀 detached 更新器/脚本进程 | 等同断电中断点（B4/C1-C5） | §3 |

### 4.3 盘满

| 阶段 | 现状 |
|---|---|
| A 链下载 | 有缓解：下载失败→error 事件＋重试入口（`desktop-updates.ts:331-333`）；ENOSPC 作为普通下载错误呈现（**未专项测试＝unknown，但不会死寂：看门狗保证收敛**） |
| B 链下载/解压 | 有防护：safe-http 错误/解压 throw→fail 状态人话（`updater.ts:248-250` 外层 catch 兜全部步骤） |
| B 链备份阶段 | **有防护（关键设计）**：备份失败→fail「更新前备份失败，已停止（未改动包文件）」——盘满时绝不动包（`updater.ts:200-204`，UPD-BACKUP-BEFORE-SWAP 编排分支） |
| B 链换装中盘满 | copy 新文件失败→catch→逆序回滚（进程存活时）；回滚自身若再失败→错误消息明示「请勿继续使用该包，从备份目录恢复」（`updater-core.ts:193-198`）——**备份目录此时是唯一恢复源（B 链独有优势）** |
| C 链 staging 写脚本/spawn | 有防护：quitAndInstall 内全捕获→onApplyFailure＋正常退出（`portable-updater.ts:545-576`） |
| A 链 NSIS 安装中盘满 | **缺口/unknown**：库域，无 repo 级处理；等同 A6/A7 残余 |

---

## 5. .old 回滚时序与失败分支（链 C，`renderReplaceScript` 渲染产物语义）

```
[等待] ping -n 31 127.0.0.1        ← 固定 30s 计时延时（P0-6：不探活，见 §7-P0-6）
   │
[改旧] move /y "%EXE%" "%OLD_EXE%"  ──失败──► log「failed to rename」──► exit 3（现场保留：旧 exe 原样、
   │                                        staging 原样；下次启动旧版可跑，启动清理 staging）
   ▼
[放新] move /y "%STAGING_EXE%" "%EXE%" ──失败──► [回滚] move /y "%OLD_EXE%" "%EXE%"
   │                                              │成功→ exit 4（旧 exe 复位可用）
   │                                              │回滚也失败→ exit 4 前置（exe 缺失＋.old 在＝§3-C3 人工场景）
   ▼
[清扫] del /f /q "%OLD_EXE%"        ← 失败不阻塞（残留 .old 由下次启动 cleanupPortableUpdateLeftovers 删）
   ▼
[拉起] start "" /B "%EXE%"  → exit 0
```

要点：

1. 退出码收敛 **0/3/4**（现实现，`portable-updater.ts:196-213`）。**文本漂移警示**：矩阵行
   UPD-PORTABLE-ROLLBACK 的 EARS 仍写「超时零触碰 exit 2」——那是 P0-6 改固定延时**之前**的语义；
   现行行为由 UPD-PORTABLE-REPLACE-EXEC 承载，其 binding_note 明记「exit 2 分支删除（proposed_default
   待追认：探活语义从轮询 pid 判活改为固定延时后照常替换，旧进程届时仍活由新实例端口冲突处理兜底）」。
   reviewer 应指出该 EARS 是否需 root 同步修订。
2. 「rename 运行中映像」是 Windows 合法操作（映射对象仍持有，文件名可改）——这是整个 cmd 替换链的
   平台前提（`portable-updater.ts:176-177` 注释）。
3. del .old 的「不阻塞」是刻意取舍：清扫失败只留无害残留（UPD-PORTABLE-DATA-INTACT 行锁定启动清理）。
4. **回滚自身的失败分支**（move 回也失败，如 AV 同时锁住 .old）：脚本只记日志退出，无进一步手段——
   现场＝exe 缺失＋.old 在，需人工（§3-C3）。**repo 无该复合场景测试＝缺口提示。**

---

## 6. per-machine/per-user 双安装模式差异对更新链的影响

事实基线（`desktop/electron-builder.yml:46-52`）：

- `oneClick: false`（assisted 向导式）；**`perMachine: false`（默认 per-user**：装
  `%LOCALAPPDATA%\Programs`，注册表 HKCU）；`allowToChangeInstallationDirectory: true`
  （**向导安装模式页可选 all users→HKLM＋UAC 提权**——INSTALL-UPGRADE-01 §1.1 表实证）。

对更新链的影响分析：

| 维度 | per-user（默认） | per-machine（用户在向导自选） |
|---|---|---|
| 静默更新提权 | 免管理员；quitAndInstall 拉起的静默安装器直接写 HKCU＋用户目录 | **需要提权写 HKLM/Program Files**：electron-updater 静默更新链是否可靠触发 UAC／在非管理员会话直接失败＝**unknown（repo 无 per-machine 在线更新测试；冒烟均 /currentuser 等价路径，MIRROR-URL-FIX §5.2）**。reviewer 重点问题 |
| 模式继承 | initMultiUser 读 HKCU InstallLocation 同位置升级（模板行为，INSTALLER-UPGRADE-01 §1.2-①） | 同左（HKLM）；历史 per-machine 安装会令后续 per-user 安装继承 HKLM 位置 |
| 幽灵注册风险 | 低 | **已发生过**：打包冒烟残留 per-machine 幽灵注册指向已删临时目录（UIUX-RELEASE-FIX 2026-10-17，`installer.nsh:22-28` 注释）；现有守卫＝customInit 检测目录不存在→清 HKCU 失效登记＋重置 per-user 模式（HKLM 幽灵无提权删不动，但切换模式后不再继承，`installer.nsh:42-68`） |
| 卸载询问数据目录 | `$PROFILE`＝当前用户（正确） | 已知限制：提权卸载时 $PROFILE＝提权过程用户档案；跨用户装/卸（A 装 B 卸）指向错档案（`installer.nsh:99-102`，electron-builder 口径的模板级限制） |
| 数据目录 | 恒 `%USERPROFILE%\.a-share-kline-trainer`（两模式同一唯一默认，INSTALL-NSIS-ASSISTED）→ per-machine 双 Windows 用户共用二进制、各持各数据 | 同左 |
| 升级链隔离 | 静默卸旧 /S /KEEP_APP_DATA --updated 不弹卸载询问（`installer.nsh:107` Silent 守卫） | 同左 |

历史注记：本机曾出现「用户 per-machine 真实安装与打包冒烟共存」事故（skill v1.7 记录，MIG-MERGE-01/CN-FEED-01 轮披露）——per-machine 形态在本工程的真实暴露主要来自打包冒烟与个别用户自选，正式用户群默认 per-user。

---

## 7. 历史事故清单（现象/根因/修复/矩阵行）

| 事故 | 现象 | 根因 | 修复 | 矩阵行（binding_note 溯源） |
|---|---|---|---|---|
| **P0-1 目标 exe 误指自解压副本**（2026-10-11） | 真机验收：staging 生成、替换「成功」，但用户 exe 原字节未变；replace.log 指向 %TEMP% 路径 | electron-builder portable 壳把真实应用解压到 `%TEMP%\{uuid}\`，`process.execPath`＝临时副本；用户实际双击的 exe 由 `PORTABLE_EXECUTABLE_FILE` 给出，替换了副本＝更新无效 | `resolvePortableTargetExe`（`portable-updater.ts:60-67`）：便携形态取 PORTABLE_EXECUTABLE_FILE，缺失 fail-closed throw 绝不回退；提交 6bd4ef5 | UPD-PORTABLE-TARGET-ENV（9 用例＋smoke 字节级 P0 绑定链；RED-2 变异实测背书） |
| **P0-3 undici 截断崩溃**（2026-10-11） | 两轮下载确定性截断于缺 100,500 字节处；主进程弹「A JavaScript error occurred in the main-process: AssertionError assert(this.paused) at Parser.finish (undici)」崩溃窗（用户截图确认） | 全局 fetch（undici）在 socket 异常结束路径从内部异步抛断言，不经任何可 await 路径，try/catch 不可拦 | 网络层换 Node 原生 http/https（`portable-updater.ts:241-264` 注释＋实现）；截断→「下载中断：已收 X/Y 字节」人话错误；提交 6688067 | UPD-PORTABLE-NETWORK-ROBUST（7 用例真实边界：py http.server 少发/RST/302 等） |
| （关联）**P0-4 进程级 fetch 崩溃** | P0-3 修复后真机仍弹同一崩溃——崩溃源在主进程其他 fetch 调用点（server 内嵌更新域/端口冲突探测） | 同 undici 语义，多调用点 | server 更新域三文件＋port-conflict 全部换线 safe-http；grep 全局 fetch 清零；主进程双 handler 兜底（§1-8）；提交 b9e4623 | UPD-NET-ROBUST-PROCESS-WIDE（RED 基线＝未修复形态执行级证据；兜底为 proposed_default 待追认） |
| **P0-5 app.exit 挂起**（2026-10-11 两轮真机） | spawn 替换脚本后 `app.exit(0)` 进程僵死占端口：server 已停、进程残留、脚本 60s 等不到 pid 超时零触碰 | app.exit 不走 will-quit 清理（DevTools agent 等句柄未释放）即终止，部分环境挂起 | `quitApp: () => app.quit()`（`main.ts:426-430`）——GUI 正常退出路径复现退净 | UPD-PORTABLE-REPLACE-EXEC（quitApp=app.quit 源码契约锁定） |
| **P0-6 tasklist 挂死改 ping**（2026-10-11 最小复现实证） | 替换脚本用 tasklist 探活旧 pid，在 detached＋windowsHide 的 cmd 里挂死（stdio pipe/windowsHide:false/非 detached 变体均不救；ping 正常） | 探活工具在隐藏 detached cmd 环境不可用（平台事实；另有 `find` 在 Git Bash PATH 解析为 GNU find 的坑，PORT-UPD-01 §5-5） | 改 `ping -n <N+1> 127.0.0.1` 固定计时延时，不探活；旧进程届时仍活由新实例端口冲突处理（ask-on-conflict）兜底；exit 2 分支删除（§5 文本漂移警示） | UPD-PORTABLE-REPLACE-EXEC（「旧进程等待＝ping 固定延时」渲染断言＋「固定等待后照常替换」冒烟） |
| **UPD-QUIT-TYPEERROR**（2026-10-11 第三形态截图；2026-10-12 拍板修复） | 更新退出瞬间弹一次「TypeError: Cannot read properties of undefined (reading 'message')」窗，不影响替换结果 | teardown 撕裂期对 undefined error 的无守卫 message 读取；兜底注册时机晚于该窗口 | 提交 d9e4be5：全表面 undefined-safe（messageOf/formatUnknownError）＋兜底注册最早化（Electron init.ts 双 handler 在则默认崩溃窗自禁——弹窗只能来自 teardown 撕裂期 fatal 路径，根因候选 C1 排序见验证记录）；quitAndInstall 调用点同步抛错捕获（`main.ts:795-799`） | UPD-QUIT-TYPEERROR-GUARD（8 用例；变异 M2 在单测层复现截图原句）。**遗留（该行 binding_note 明记）：data-home.ts 两处启动面无守卫（下轮）＋electron-updater 库内不可修** |
| **DL-HANG 下载挂起死寂**（2026-10-13 用户拍板「严重体验问题」；w5 真机复现） | 3060 真机 v1.3.1：点「下载并更新」后 20 分钟零反馈——UI 无进度无错误无重试、系统层无外联连接 | electron-updater 6.8.10 ElectronHttpExecutor **零超时**（grep timeout 零命中）；网络层 DNS/TCP 挂起→promise 永久 pending→无事件回流 | dl-hang 分支@0109740：controller 层 Promise.race 看门狗 90s（不依赖底层 settle）＋download-started 启动观测（事件＋日志）＋重试清理（无上限、每次独立看门狗） | UPD-DL-WATCHDOG / UPD-DL-START-CONFIRM / UPD-DL-RETRY-AFTER-STALL（变异 M1/M2/M3 executed 击杀；RED 阶段 1 天然绿负向用例由 M3 兑现）。**残余（如实登记）：cancel 尽力语义——网络挂死时重试复用 pending promise→新看门狗再超时，用户持续有反馈** |
| **MIRROR-URL-FIX 镜像双拼 404**（v1.3.2 发布事故，2026-10-13） | v1.3.2 真机 boot-check 恒回退 GitHub；镜像侧 `…/feed/latest.yml/latest.yml` 404（URL 双拼） | `cnMirrorLatestYmlUrl` 返回全文件 URL；electron-updater GenericProvider 把 configuration.url 作 baseUrl（`newBaseUrl(url)` 无尾斜杠则补）再拼 channel 文件⇒二次拼接 | v1.3.3（a713df2）：`cnMirrorFeedUrl` 返回**目录形态** `<base>/`；测试 oracle 从桩回显升级为真实库 newBaseUrl/newUrlFromBase 解析链断言（W-D 真机：目录形态 2.3s 三次稳定成功，全 URL 404；117MB 下载校验安装重启 4.9s） | UPD-CN-FALLBACK-DESKTOP（binding_note 补记双拼根因；EARS 零改动）＋RELEASE-CN-FEED-SYNC（releaseNotes 增强同轮） |
| （相邻，发布侧）**junction node_modules asar 坏包**（MIRROR-URL-FIX §5.1 披露） | worktree junction 环境打包 EXIT=0 但 asar 依赖链断裂（109.2MB 坏包 vs 正确 111.8MB）；NSIS 冒烟第一轮 FAIL：`Cannot find module 'fs-extra'` | electron-builder 依赖收集按真实路径解析，junction 目标在工程根外被剔除 | 摘 junction→worktree 真实 npm ci 重打包；坏包未上传；纪律沉淀＝**打包必须真实 node_modules** | 无矩阵行（发布流程缺陷；直接影响可更新性故收录） |

---

## 8. reviewer 请重点回答的问题清单

1. **中断点状态机有无漏步**：§3 三张表是否覆盖全部会改动磁盘/进程状态的步骤？特别核查：
   (a) A 链 quitAndInstall 与 NSIS 安装器交接的原子性假设；(b) B 链 extract（解压在 backup 之后、
   performSwap 之前，`updater.ts:209`）中断点的归类；(c) C 链 staging 写脚本与 spawn 之间的窗口。
2. **恢复路径是否充分**：B4/B5 断电无自动回滚（trash 残留无启动期检测）与 C2/C3「exe 缺失＋.old 在
   且应用无法自启动」是否可接受？若不可接受，最小修法是什么（如启动期 .update-trash-* 检测、
   便携复活时加 boot 检查器）？权衡：这些是低频灾难 vs 增加启动面复杂度。
3. **时序竞态**：(a) C 链固定 30s 延时后旧进程仍存活的兜底（新实例端口冲突 ask-on-conflict）是否
   在所有端口决策分支下都成立（`main.ts:614-629` reuse 分支会直接复用旧实例窗口——此时「替换已成功
   但连到旧进程」如何呈现）？(b) A 链 `installPendingUpdate` 布尔与多次退出的交叠（下载完成→排空中
   用户又触发下载/检查）是否有守卫（`downloading` 布尔的复位时点）？(c) boot 自动检查与 setupUpdateChannel
   数据目录回填的已知时序限制（CN-FEED-01 §1.2：boot 检查读 auto 默认计划）是否需要收口？
4. **杀软系列**（逐问）：若杀软在 ②rename 持有 exe 锁（exit 3 已防护）但同时在 ③staging move 后、
   ④del .old 前隔离了新 exe？若杀软在 NSIS 静默安装 mid-way 隔离新拷贝的 dll？若杀软隔离
   electron-updater 缓存目录中的 blockmap（差分续传是否退化为全量重下）？若杀软杀 detached 更新器
   进程（B 链）后状态文件永久停在 applying——渲染端 15 次重连放弃后的指引是否足以让用户自救？
5. **矩阵文本漂移**：UPD-PORTABLE-ROLLBACK EARS 的「exit 2」与现实现（0/3/4）不一致（§5-1）——
   应修订 EARS 还是加注 superseded 说明？同理检查 UPD-PORTABLE-DOWNLOAD-VERIFY/RELEASE-PORTABLE-YAML-VALID
   两行 superseded 的表述是否足以防误读。
6. **链 B 的兜底定位复核**：NSIS 主形态下 zip 链仍在发布物中共存（§0）——其防护（备份/回滚）与
   A 链防护（无备份）的不对等是否需要在用户文档/发布手册中显式披露？
7. **per-machine 在线更新**（§6）：per-machine 安装＋非管理员会话的静默更新行为 unknown——
   建议的验证路径（真机矩阵或文档声明「per-machine 形态请手动更新」）？
8. **prerelease 灰度的代码级缺位**（§1-5）：依赖 electron-updater 缺省 allowPrerelease=false 的隐式
   语义，是否值得加显式设置行/测试锁定？

---

## 附：本文档事实溯源清单（reviewer 抽查入口）

- 源码：`desktop/src/{main,desktop-updates,cn-feed,update-adapter,update-ipc,portable-updater,quit-state}.ts`、
  `server/src/update/{api,updater,updater-core,zip,manifest,safe-http}.ts`、`web/src/updateFlow.ts`、
  `desktop/electron-builder.yml`、`desktop/build-resources/{installer.nsh,app-update.yml}`
- 矩阵：工作区 `.zcode/skills/ai-harness/matrix/updater.yaml`（行 ID 与 binding_note 逐条对应本文）
- 验证记录：`docs/verification/2026-10/{PORT-UPD-01,DL-HANG-01,MIRROR-URL-FIX,CN-FEED-01,INSTALLER-UPGRADE-01}/README.md`
- 发布手册：`docs/release/desktop-release-manual.md`（§四 形态策略、§五 国内镜像）
- 修复提交：6bd4ef5（P0-1）/6688067（P0-3）/b9e4623（P0-4）/d9e4be5（QUIT-TYPEERROR）/a713df2＋de7878f（MIRROR-URL-FIX v1.3.3）/dl-hang@0109740
