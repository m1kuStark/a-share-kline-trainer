# PACK-03 设计：数据与配置兼容（历史数据零丢失防线）

任务卡：`docs/work-items/tasks/PACK-03.md`｜base 5f74db0｜2026-10-06

## 一、现状数据落点清单（阶段①产出，先读透再设计）

### 1.1 各形态数据落点（源码核对）

| 形态 | 配置来源 | dataDir 默认 | DB 默认路径 | dataDir 内文件 | 状态文件 |
|---|---|---|---|---|---|
| zip v1.2.6+（launcher.cjs） | `<ziproot>/trainer.config.json`（可选字段 tdxRoot/port/dataDir/databasePath）＋env 覆盖 | `<ziproot>/data`（launcher.cjs:177-181 `resolveConfig`，V1.2.6 注释明示改宗原因） | `<dataDir>/trainer.sqlite` | trainer.sqlite(±-wal/-shm)、saved-tdx-choice.json、server.log、trainer-state.json、launch.lock | `<dataDir>/trainer-state.json`（launcher 写，`writeStateFile` launcher.cjs:744；字段 appId/runId/pid/port/baseURL/startedAt/version/gitCommit/databasePath/tdxRoot） |
| zip ≤v1.2.5（launcher.cjs） | 同上（无 dataDir 字段时代） | `%USERPROFILE%\.a-share-kline-trainer`（`DATA_DIR_NAME`） | `<home>\.a-share-kline-trainer\trainer.sqlite` | 同上 | 同上（写在主目录库内） |
| server 独立运行（npm start / CLI） | 仅 env（server/src/config.ts:74-117） | `dirname(databasePath)`＝`%USERPROFILE%\.a-share-kline-trainer` | `join(homedir(), '.a-share-kline-trainer', 'trainer.sqlite')`（config.ts:76） | 同上（无状态文件——server 不写 trainer-state.json；ready 文件仅 spawn 托管契约） | 无 |
| desktop exe（PACK-01/02 现状） | env（TRAINER_DATA_DIR/TRAINER_DB/PORT/TDX_ROOT，desktop/src/desktop-config.ts） | **exe 同级 `data/`**（PACK-01 拍板项①便携语义） | `<dataDir>/trainer.sqlite` | trainer.sqlite、window-state.json（PACK-02） | **无（缺口：不写任何状态记录）** |

### 1.2 dataDir 文件分类（零丢失不变量的「库文件」边界）

- **库文件（绝不删改覆盖）**：`trainer.sqlite`（±`-wal`/`-shm`）、`saved-tdx-choice.json`（UPD-01 `PRESERVE_DATA_FILES` 同清单含 trainer-state.json——该文件虽在 preserve 清单，但它是运行态记录而非用户数据，launcher 自身日常写删（`writeStateFile`/`clearState`））。本任务口径：**desktop 在共存裁决放行（此刻无活占用者）后写入自有 trainer-state.json（至多覆盖已死占用者的残留记录——launcher clean+write 同终态）；退出清理仅在文件内容仍是本进程 runId+pid 身份时删除，绝不删他人记录**；不动其余任何既有文件。
- **运行态/桌面自身状态（允许写）**：`trainer-state.json`（共存防线，launcher 同格式）、`launch.lock`（launcher 同语义）、`window-state.json`（PACK-02 已有）、exe 同级 `desktop-data-choice.json`（本任务新增采用记录，desktop 专属文件）。

### 1.3 库识别判据（oracle，冻结）

**候选目录存在 `trainer.sqlite` 文件即「有训练库」**（含 0 字节/空库——一个曾被启动过的目录就算有库，宁可采用不可漏检；`-wal`/`-shm`/`saved-tdx-choice.json`/空目录均不构成库）。判据来源＝server/src/config.ts:76 DB 默认 `join(dataDir,'trainer.sqlite')`＋server/src/db.ts `openDatabase/migrateDatabase` 的建库位置＝TRAINER_DB 指向的文件本身。

### 1.4 现状缺口（本任务要堵的三处）

1. exe 首启默认静默新建 exe 同级空库——若用户有 `%USERPROFILE%\.a-share-kline-trainer`（≤v1.2.5 zip）或旧 zip 目录 data/（v1.2.6+）历史库，exe 看不见（用户痛点原话）。
2. exe 不读 exe 同级 `trainer.config.json`——用户把 exe 放进旧 zip 文件夹时 port/dataDir/tdxRoot 设置丢失。
3. exe 不写也不查 `trainer-state.json`——zip 与 exe 同时运行且端口不同时可能双写同一 SQLite 库（launcher 侧 `decideRecordedServer` 防线只能看见 launcher 自己写的记录；desktop 内嵌 server `startTrainerServer`（server/src/index.ts:39-86）不写任何状态文件）。

## 二、首启发现/采用状态机（adopt-in-place，不搬数据）

### 2.1 输入与优先级总序

```
env 显式（TRAINER_DATA_DIR 或 TRAINER_DB 非空）
  > exe 同级 trainer.config.json 的 dataDir/databasePath（字段显式时）
  > 采用记录 exe 同级 desktop-data-choice.json
  > 首启发现（一次性，结果写回采用记录）
  > 默认 exe 同级 data/（唯一允许「新建空白库于全新目录」的场景）
```

### 2.2 状态机（resolveDataHome，纯函数＋注入 fs/ask）

```
E0 env 显式 → kind=explicit-env：直接用 env 解析结果（desktop-config 既有权威），
   不发现不记录（显式配置确定性来源，无记忆必要）
E1 读 exe 同级 trainer.config.json（launcher resolveConfig 镜像解析，非法即启动报错）：
   dataDir 字段显式 → kind=legacy-config：用 config.dataDir（相对路径按 exe 同级解析），
   不发现不记录
E2 读采用记录 desktop-data-choice.json（严格形状 {version:1, mode:'default'|'adopted',
   dataDir?, decidedAt?}；损坏/异己→null 视为无记录）：
   ├ mode=default → kind=remembered：dataDir=exe 同级 data/（默认档无需验证——不存在失效）
   └ mode=adopted → 验证记录路径仍有库（trainer.sqlite 存在）：
       ├ 有 → kind=remembered：沿用记录路径（不再探测——幂等核心）
       └ 无（用户已删目录）→ 记录失效，丢弃并落入 E3 重新发现（如实记日志）
E3 首启发现（E0/E1/E2 都未命中才执行；候选序冻结：①exe-data ②legacy-home）：
   ① exe 同级 data/      ② <homeDir>\.a-share-kline-trainer
   hits = 候选中「有库」者：
   ├ 0 hits → kind=discovery-default：dataDir=exe 同级 data/（新建空白库＝唯一允许新建场景）；
   │          记录 mode=default（此后不再探测）
   ├ 仅①  → kind=discovery-default：同默认（行为与 PACK-02 前一致）；记录 mode=default
   ├ 仅②  → kind=discovery-legacy：dataDir=②（原地采用，不复制不迁移）；记录 mode=adopted；
   │          notice「已沿用历史训练数据：<路径>」（v1 收敛为 console-only——见 §八实测发现；
   │          窗口内提示形态留待用户验收拍板）
   └ 双命中 → 对话框二选一（env TRAINER_DESKTOP_DATA_ANSWER=exe|legacy|cancel 可注入；
              非法值启动报错不猜）：
       ├ exe    → 同「仅①」
       ├ legacy → 同「仅②」
       └ cancel → quit（不动任何数据、不开库不启服务）
```

- **幂等性**：E2 命中即 short-circuit，E3 的探测（fileExists 调用）不再发生；测试断言 `probed=false`。
- **候选序①在前的理由**：exe 放进旧 zip 目录（v1.2.6+）时包内 data/ 就是最新库，优先级高于 ≤v1.2.5 的主目录库；只有 ① 无库时 ② 才单独命中；双命中才询问（不替用户猜）。
- **采用记录位置**＝exe 同级 `desktop-data-choice.json`（与 trainer.config.json 同级；记录必须位于 dataDir 之外的固定点，否则采用②后找不到记录）。mode=default 不记绝对路径——保持便携语义（exe 挪窝＝按 zip 惯例数据随目录走）。
- **found-but-dialog 语义说明**（对派发简报「默认位置无既有数据才探测」字面的解释）：若按字面（默认位置有库就不探测），双候选对话框永远不可达；本设计把触发条件定为「无显式配置＋无采用记录」，探测时枚举全部候选，双命中才询问——这是使 DATA-MULTI-CANDIDATE-DIALOG 可达的唯一一致读法，列入 proposed_default 提验。

### 2.3 旧配置沿用（CONFIG-LEGACY-ADOPT）

`parseLegacyTrainerConfig` 镜像 launcher.cjs `resolveConfig`（169-203）语义，差异一处明示：

| 字段 | launcher 语义（镜像） | desktop 差异 |
|---|---|---|
| port | 显式才尊重；空串/null/缺省→默认 8787；非整数/越界→报错 | 同；desktop 无「显式端口拒绝」之分（PACK-02 已拍板一律 PORT-01 回退） |
| dataDir | 空串/缺省→`<root>/data`；相对路径按 root 解析 | 同（root＝exe 同级）；**dataDirExplicit 标记**供 E1 判断 |
| databasePath | 必须绝对路径，相对即报错；缺省→`<dataDir>/trainer.sqlite` | 同 |
| tdxRoot | 相对按 root 解析；缺省 null | 同；**env 折叠不做**（env 权威在 desktop-config，避免双处折叠） |
| 非对象 JSON | 报错不猜 | 同 |

合并进 `resolveDesktopConfig(env, paths, defaults?)`（env 显式值恒胜 defaults，defaults 胜内置默认——优先级结构化保证，不靠 if 堆叠）。

### 2.4 saved-tdx-choice.json 沿用（proposed_default，附加项）

采用/解析出的 dataDir 内有 `saved-tdx-choice.json`（SETUP-SAVE-01 形状 `{version:1, root:string}`）且 tdxRoot 未被 env/config 决定时，读其 root 作为 TDX_ROOT 注入＋`TRAINER_TDX_SOURCE='saved-choice'` 标签（server 隔离模式自行做存活性校验，死路径→tdxRoot null→setup pending，与 launcher 行为等价）。**server 零改动**（经 env 通道）。理由：无缝升级场景下用户的通达信目录选择也是历史配置；不读会强制重做 setup（非数据丢失但违背无缝升级精神）。

## 三、双形态共存防双写（COEXIST-SAME-DATADIR-GUARD）

### 3.1 竞态全景（核实结论）

| 场景 | 既有防线 | 结论 |
|---|---|---|
| exe 后启、zip 服务在前、**同端口** | PACK-02 端口三应答（health 身份→reuse/restart/cancel） | 已防（不启第二服务） |
| exe 后启、zip 服务在前、**不同端口**（zip config 显式 port） | 无——exe 不读 trainer-state.json | **缺口→本任务 S3.5 堵** |
| zip 后启、exe 在前、任意端口 | launcher `decideRecordedServer` 只认 trainer-state.json，exe 不写 | **缺口→exe 写同格式记录堵**（launcher 读到活记录→health 复核→reuse，不开第二进程；此为 launcher 既有冻结行为，零改动） |
| 同时启动竞态 | launcher `launch.lock` 单飞 | desktop 需取**同一把锁**才能与 launcher 互斥（锁不住则 TOCTOU：双方都读「无记录」后各自起服务） |

### 3.2 S3.5 状态记录裁决（decideCoexistence，纯函数＋全部可注入）

位置：端口决策（S3）得 `start` 之后、内嵌服务启动之前；`reuse`（端口层）分支不进（已是「连已有服务」终态）。

```
取 launch.lock（<dataDir>/launch.lock，launcher 同语义：'wx' 独占；EEXIST 时
  appId+pid 可识别且 pid 已死→删锁重试≤5 轮；活→有界等待释放≤3s；仍持→拒绝启动）
  → 读 <dataDir>/trainer-state.json：
  ├ 缺失/非 JSON/非对象 → proceed（无防线义务）
  ├ appId ≠ 'a-share-kline-trainer' → refuse（他应用文件，绝不碰）
  ├ 身份不完整（stale：runId/pid/port/baseURL 任一非法）：
  │    ├ 记录 pid 是 ≥1 整数且存活 → refuse（launcher 不可验证活占用同口径：宁拒不双写）
  │    └ pid 缺失/已死 → proceed（launcher 'clean' 口径；desktop **不删**该文件——非本进程记录)
  ├ 身份完整：
  │    ├ pid 已死 → proceed（残留记录，同上不删）
  │    ├ pid 存活 → health 探测记录端口（probeMatchesState 口径：127.0.0.1、redirect:'error'、
  │    │   仅 200 且 status ok＋runId/pid 双匹配）：
  │    │   ├ 匹配（确认活训练器正用同库）→ 三应答（与 PORT-02 共用询问器与注入 env
  │    │   │   TRAINER_DESKTOP_CONFLICT_ANSWER）：
  │    │   │   ├ reuse → 复核仍匹配 → REUSE 分支：窗口加载记录 baseURL，不启内嵌服务
  │    │   │   │          复核失配/消失 → proceed（占用者已退场）
  │    │   │   ├ restart → 复核 pid 一致才杀（等退出≤5s）→ proceed；杀失败/超时 → refuse
  │    │   │   │            复核消失/身份变化 → proceed（不杀，launcher 同口径）
  │    │   │   └ cancel → quit（不动数据不动进程）
  │    │   └ 不匹配/不可达 → refuse（unverifiable live owner：活进程可能正写同库，
  │    │                      launcher unverifiableOwnerMessage 同口径，错误信息含 PID＋排查指引）
  释放锁（REUSE/quit/refuse 即释；proceed 持锁至服务起＋记录写完再释）
```

- refuse/quit＝`dialog.showErrorBox` 呈现原因后退出（非静默）；proceed 后正常启内嵌服务。
- **锁持有期含对话框询问**——与 launcher 一致（launcher 冲突询问也在锁内）。

### 3.3 desktop 状态记录写入/清理（反向防线）

- **写**：内嵌服务 listen 成功后（端口已知），原子写 `<dataDir>/trainer-state.json`：`{appId:'a-share-kline-trainer', runId, pid: process.pid, port, baseURL:'http://127.0.0.1:<port>', startedAt, databasePath}`——身份字段满足 launcher `assertStateIdentity` 全部校验（runId `run-<uuid36>` 格式、baseURL 与 port 严格一致），launcher `decideRecordedServer` 读到→pidAlive→probeMatchesState→reuse（开浏览器，不启第二进程）。
- **清**：优雅退出 shutdown 完成后，**身份复核**（文件内容 runId+pid 仍是本进程）才删；失配（他进程已覆写）不删。崩溃残留由读取方按「pid 死→clean」收敛（launcher/desktop 读取口径均已覆盖）。

## 四、零丢失不变量（NO-DELETE-INVARIANT）

1. 全部路径不删除/覆盖：`trainer.sqlite`（±-wal/-shm）、`saved-tdx-choice.json`、任何既有目录内非 desktop 自有文件。
2. 允许写的新文件：全新目录的空白库（server 建库，唯一新建库场景）、`desktop-data-choice.json`（desktop 专属）、`window-state.json`（PACK-02 既有）、`launch.lock`、`trainer-state.json`（仅本进程身份记录；删除仅限身份匹配的自有记录）。
3. 集成测试以**文件哈希前后对照**锁定：发现/采用/共存全流程后既有库文件字节不变。

## 五、TDD 计划（阶段③④）

| 层 | 文件 | 用例群 |
|---|---|---|
| 纯函数 | `desktop/test/data-home.test.ts` | parseLegacyTrainerConfig 镜像语义（默认/相对解析/绝对强制/非法报错/dataDirExplicit）；parseDataChoiceRecord 严格形状；enumerateDataHomeCandidates 候选序；resolveDataHome 全分支（E0-E3×hits×应答×幂等 probed=false×记录产物×notice）；parseSavedTdxChoice；resolveDesktopConfig defaults 合并（env>defaults>内置） |
| 纯函数 | `desktop/test/coexist-guard.test.ts` | parseStateRecord（absent/foreign/stale±pid/valid）；decideCoexistence 全分支（§3.2 树逐叶）；buildStateRecord launcher 断言兼容形状；stateRecordIsOurs；acquireLaunchLock（fresh/死锁恢复/活锁有界拒绝/垃圾锁拒绝/5 轮上限）；parseDataAnswerEnv 严格解析 |
| 集成 | `desktop/test/data-home-fs.test.ts` | 真实临时目录伪造候选布局：仅②有库→采用②；双库→注入应答；无库→默认；记录持久化→二次 remembered 不探测；adopted 失效→重发现；**哈希不变量**（库文件前后一致） |
| 冒烟 | `desktop/scripts/smoke-desktop.mjs` 扩展 | 阶段 F（全套一致 profile 沙箱重定向＋伪造历史库→health＋history 含预置记录＋exe 同级 data/ 未创建＋desktop-data-choice.json mode=adopted＋优雅退出 exit 0＋二次启动幂等；**经 `--adopt-child` 子模式在全新 node 宿主执行**——同 spawn 参数在冒烟主进程内 100% 崩溃、独立宿主 100% 健康，见 §八）；阶段 G（dataDir 预置活 trainer-state.json＋假训练器→reuse 注入→假服务被健康探测（spawn 前清零 hits 计数）＋exe 端口未 bind＋不新建库文件）；PACK-02 A-E 阶段全保留回归 |

## 六、server 侧改动预算

**目标零改动，实际零改动**（git diff 收据：server/src、server/test 均无改动；发现/采用/共存全部经 desktop 侧 env 与文件通道完成）。

## 七、proposed_default 清单（收尾报告呈报）

1. adopt-in-place 政策（不迁移不复制；迁移路径 v1 不做——派发简报决策⑤）。
2. 候选序（①exe-data 先于 ②legacy-home）与触发条件解释（§2.2 末条：使多候选对话框可达的唯一一致读法）。
3. 采用记录位置/形状（exe 同级 desktop-data-choice.json；mode=default 不记绝对路径保便携）。
4. 多候选对话框文案/按钮序（exe=「使用 exe 旁数据」默认，legacy=「使用历史主目录数据」，cancel=Esc）。
5. adopted 记录失效（目录被删）→ 重新发现而非报错。
6. saved-tdx-choice.json 沿用（§2.4，附加项；经核对 launcher.cjs resolveTdxWithSource 本就有 env→explicit-config→saved-choice 冻结优先链，desktop 属零破坏镜像而非新语义）。
7. desktop 写 trainer-state.json（launcher 兼容格式）作为反向防线；自有记录身份复核后删除。
8. 「已沿用历史数据」提示形态：**v1＝console-only**（设计原稿为 console＋一次性 info 对话框；实测原生对话框两种形态均有硬伤——见 §八——窗口内提示（页面 toast 等）留待用户验收拍板后实现）。

## 八、Electron/Windows 实测发现（工程记录，PACK-04/05 必读）

冒烟阶段 F 调试过程中（诊断矩阵全记录见验证 README §五）实证的四个平台事实：

1. **仅重定向 USERPROFILE 而其余 profile env（APPDATA/LOCALAPPDATA/TEMP/TMP）指真实目录 → 打包 exe 原生崩溃 0x80000003（+17s，WER 确认 exe 本体断点）**；全套一致重定向（USERPROFILE＋HOMEDRIVE/HOMEPATH＋APPDATA＋LOCALAPPDATA＋TEMP/TMP 指向同一临时 home）则健康。结论：给 Electron 应用做 home 沙箱必须整套一致搬。
2. **打包 exe（GUI 子系统）主进程 console.log/console.error 在 spawn 管道下全部丢失**（stdout/stderr 双流捕获均为 0 字节，健康与崩溃路径皆然）；`ELECTRON_ENABLE_LOGGING=1` 也不回收 console 输出。打包形态的可观测性只有 HTTP/文件/`npx electron` CLI 直跑三条路。
3. **`dialog.showMessageBox` 无父窗口（引导期、任何窗口创建前）→ 原生崩溃（0x80000003，A/B 隔离定位）**；挂主窗口则成为**模态**对话框，阻塞窗口关闭（CloseMainWindow 后 60s 不退出）。故采用提示 v1 收敛 console-only。
4. **同参数 spawn 打包 exe（全套沙箱 env）：在冒烟主 node 进程内 100% 自退 0xFFFFF003（无 WER、无输出、stub 解压目录空）；在独立 node/直连 bash/`npx electron` 宿主 100% 健康**（7+ 次崩溃 vs 10+ 次健康，含最小 env 白名单对照与保留现场 t2/t3/t4 拆分）。宿主进程内某暂态状态致原生层故障，超出脚本层可及范围——冒烟阶段 F 因此改为 `--adopt-child` 子模式（主冒烟再 spawn 一个全新 node 宿主执行断言，断言面不变）。
