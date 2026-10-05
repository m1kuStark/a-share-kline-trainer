# UPD-01 设计文档：在线版本更新·服务端核心

- 任务：UPD-01（里程碑 UPD 首任务；UPD-02 设置页 UI 接线不在本任务范围）
- 日期：2026-10-06
- base：cd06a71
- 参考方案：架构师对 cc-switch 的适配调研（proposed_default），任务派发简报冻结
- 行为矩阵：`.zcode/skills/ai-harness/matrix/updater.yaml`（镜像 `ai-harness-lab/skill-v1/matrix/updater.yaml`）

## 1. 现状核实结论（先核实再依赖）

| 事实 | 结论 | 证据 |
|---|---|---|
| 默认数据目录 | **V1.2.6 起＝`<包根>/data`（包内）**，不再是 `~/.a-share-kline-trainer` | `scripts/release/launcher.cjs` resolveConfig（V1.2.6 注释）；旧版数据仍在主目录，可在应用内"训练数据目录"设置指回 |
| 包内需保护文件 | 整个 `data/` 目录（trainer.sqlite 历史训练数据、saved-tdx-choice.json、trainer-state.json 等）＋包根 `trainer.config.json` | 同上＋`server/src/config.ts`（TRAINER_DATA_DIR/TRAINER_DB 注入口径） |
| 新包是否含用户文件 | 不含。`classifyStagedPath` 拒绝打包 `trainer.config.json`、`trainer.sqlite*`；`data/` 本就不在发布清单 | `scripts/release/build.mjs:273-293` |
| 包自带文件清单 | 每个包内附 `release-manifest.json`（逐文件 SHA256） | build.mjs `manifest` 写入 staging |
| SHA256SUMS 发布资产 | **已存在**：build.mjs 已生成 `<out>/SHA256SUMS`（内容 `<zipSha>  <artifactName>.zip`）并随 zip 独占发布——无需新增逻辑，仅需确认发布流程把该文件作为 release 资产上传（本设计将「manifest 带 SHA256SUMS 资产→强制校验」作为消费端） | build.mjs:602-605 |
| 版本端点 | 无既有版本出口；`/api/health` 只回 status/runId/pid | `server/src/index.ts:25`，全仓 grep 无 currentVersion |
| 优雅退出先例 | SETUP-01：控制 API（`/api/setup/control/prepare|shutdown`，loopback＋Host＋无 Origin＋X-Control-Token＋runId 匹配）→ drain → 202 → 真实 shutdown；detached 监管进程经 `env: process.env` 继承控制令牌（令牌永不落盘/入 plan 文件） | `server/src/setup/control-api.ts`、`api.ts` spawnRestartSupervisor |
| Start 重启语义 | `launcher.cjs`（无参）＝inspectPackage→config→port→spawn detached server→ready→state | PORT-02 冻结，本任务**只读复用不改** |

## 2. API 契约（定稿；UPD-02 消费）

字段命名沿用仓库 API 惯例（camelCase）。三个新端点注册于 `server/src/update/api.ts`，由 `index.ts` 挂接。

### 2.1 GET /api/update/check

- 请求：无参。
- 响应 200（**网络失败也是 200＋error 字段，不抛 5xx 裸异常**）：

```json
{
  "currentVersion": "1.2.7",
  "latestVersion": "1.2.8" | null,
  "updateAvailable": true | false,
  "releaseNotes": "…" | null,      // 清单 body，截断至 4000 字符
  "downloadUrl": "https://…/kline-trainer-v1.2.8-windows-x64.zip" | null,
  "downloadSize": 123456 | null,   // zip 资产 size
  "manifestUrl": "…",              // 本次实际使用的清单源（可配置项生效证据）
  "error": null | "人话中文错误"
}
```

- 清单源（GitHub Releases latest API 形状）：`{tag_name, name, body, assets: [{name, browser_download_url, size}]}`；zip 资产＝`/^kline-trainer-v\d+\.\d+\.\d+-windows-x64\.zip$/`；校验和资产＝名 `SHA256SUMS`。
- 版本比较：`tag_name` 去前导 `v` 后按三段整数比较；latest>current → updateAvailable；≤ → false＋downloadUrl=null。
- 失败（fetch 异常/非 JSON/缺 tag_name/无 zip 资产）：`{updateAvailable:false, latestVersion:null, downloadUrl:null, error:"无法检查更新：<原因>"}`，仍 200。

### 2.2 POST /api/update/apply

- 前置守卫（按序）：
  1. 非发布包运行（包根无 `release.json`，或缺 `TRAINER_LAUNCHER_CJS`/dataDir）→ 503 `{error:'UPDATE_NOT_PACKAGED', message:'当前运行方式不支持在线更新，请使用发布包'}`；
  2. 已有进行中的更新尝试 → 409 `{error:'UPDATE_IN_PROGRESS'}`；
  3. 有进行中的训练 → 409 `{error:'ACTIVE_TRAINING', message:'有进行中的训练，结束后再更新'}`（提前拒绝，排空层仍会再守一次）；
  4. 清单重取后 latest ≤ current 或清单失败 → 409 `{error:'UPDATE_NOT_AVAILABLE'}` / 502 形态并入 `{error:'UPDATE_MANIFEST_FAILED', message}`。
- 受理：`attemptId = update-<uuid>`，写状态文件 `{state:'downloading', fromVersion, targetVersion}`，启动后台任务（不阻塞响应），返回 **202** `{attemptId, state:'downloading'}`。
- 后台任务（服务端内）：下载 zip（`<dataDir>/update-downloads/<attemptId>.zip`，进度写状态）→ 若清单带 SHA256SUMS 资产则一并下载 → 校验（见 §3.2）→ 失败即置 failed（服务继续运行，零文件改动）；通过则准备更新器工作目录（§3.3）→ spawn detached 更新器 → 状态置 `backing_up`。

### 2.3 GET /api/update/status

- 读 `<dataDir>/update-status.json`（无文件/损坏 → idle）：

```json
{
  "state": "idle|downloading|verifying|backing_up|applying|restarting|completed|failed",
  "progress": 0..1 | null,          // 仅 downloading 阶段有值
  "error": null | "人话原因",
  "attemptId": "…" | null,
  "fromVersion": "…" | null,
  "targetVersion": "…" | null,
  "updatedAt": "ISO" | null
}
```

- 补全协调（fallback）：文件为 `restarting` 且当前服务 `currentVersion === targetVersion` → 就地改写并返回 `completed`（更新器自行确认死亡的兜底；正常路径由更新器写 completed）。
- 状态文件不含路径与令牌；跨重启窗口（旧服务已退、新服务未起）页面连接会断——UPD-02 轮询需容连断，新服务起后本端点恢复。

### 2.4 版本暴露

`GET /api/health` 增补 `currentVersion`（来源＝包根 `package.json` 的 `version`，构建时写入发布包；开发运行＝仓库 package.json）。不新增 `/api/version`（轻量出口并入 health）。launcher `isTrainerHealth` 只认 `status/runId/pid` 三字段，加字段不破坏 PORT-02 身份语义（已核实 launcher.cjs:309-314）。

## 3. 换装编排（Windows 现实）

### 3.1 总时序

```
页面(UPD-02)          旧服务(包内)                更新器(detached node)           新服务(新包)
   │ POST /api/update/apply ─►│                          │                        │
   │◄─ 202 {downloading} ─────│                          │                        │
   │   GET status ◄───────────│ 下载→校验(失败=failed终止) │                        │
   │                          │ 准备 workdir＋spawn ─────►│                        │
   │   GET status: backing_up │                          │                        │
   │                          │◄─ control/prepare(排空) ──│                        │
   │                          │◄─ control/shutdown(202) ──│                        │
   │   (连接断开窗口)          │      优雅退出              │ 等待 pid 退出＋端口释放  │
   │                          │                          │ 备份 preserve→backups/  │
   │                          │                          │ 换装(旧移走→新就位)      │
   │                          │                          │ preserve 核验/恢复       │
   │                          │                          │ spawn launcher.cjs ────►│ Start 语义启动
   │                          │                          │ 健康版本核验 ──────────►│
   │   GET status: completed ◄────────────────────────────┘ (状态文件在 dataDir，新旧服务同读)
```

### 3.2 校验（UPD-DOWNLOAD-VERIFY / UPD-RUNTIME-COMPAT）

1. 清单带 `SHA256SUMS` 资产 → 下载并按 `<sha256>  <zip 名>` 行强制校验（不匹配→failed）。
2. zip 完整性：EOCD/central directory 可解析（自实现最小读取器：EOCD 定位→目录项→local header→stored/inflateRaw 解压单文件）。
3. 版本 tag 匹配：读 zip 内 `<单层根>/release.json`，`version` 必须等于清单版本。
4. **runtime 兼容（v1 保守）**：zip 内 `release.json.nodeVersion` 必须与当前包 `release.json.nodeVersion` **完全一致**，否则 failed＋「该版本更换了内置 Node 运行时，请从 GitHub Releases 下载全量包重新安装（历史训练数据目录不受影响）」。一致时换装**跳过 `runtime/` 目录**（同版本无需搬运，同时规避更新器自身 node.exe 文件锁——Windows 运行中 exe 不可删/覆写）。
   - 拍板项（proposed_default）：简报原文为"大版本不兼容提示重装"；v1 收紧为完全一致（次版本变更也走全量包）。理由：可测性（运行中 exe 换装需真实进程实验）＋YAGNI。

### 3.3 更新器进程（独立 detached node 脚本）

- 服务端在 spawn 前把编译产物 `server/dist/update/updater.js`＋`updater-core.js` 复制到 `<dataDir>/update-work/<attemptId>/`，并写 `package.json {"type":"module"}` 与 `plan.json`（**不含控制令牌/路径外敏感信息**；令牌经 `env: process.env` 继承，与 SETUP-01 同通道）。复制出包的原因：更新器脚本本体属被换装的包内文件，从包外工作目录运行消除自搬移。
- spawn：`spawn(process.execPath, [workdir/updater.js, workdir/plan.json], {detached:true, windowsHide:true, stdio:'ignore', env:process.env})` 后 `unref()`；`process.execPath`＝`runtime/node.exe`（运行时目录不搬移，无锁）。
- 步骤（`runFromPlan`，IO 边界全注入可测）：
  1. `control/prepare {runId, attemptId}`＋`X-Control-Token`（复用 SETUP-01 冻结排空；active-training/drain-timeout/busy → failed，服务仍在运行，安全态）；
  2. `control/shutdown` → 202 → 等待 `plan.serverPid` 退出（上限 20s）＋端口拒绝连接（上限 10s）；超时 → failed（**不补刀 SIGKILL**，PORT-02 应急停止语义不属更新器）；
  3. 备份 preserve 集（§4.2）→ `backups/update-<时间戳>/`，轮换保留 5 份；失败 → failed＋尽力拉回旧服务；
  4. 换装（状态 `applying`）：解压新 zip 到 workdir `extracted/`（PowerShell Expand-Archive，先解压后搬移缩小失败窗口）→ 复核 extracted 内 `release-manifest.json.version===target` → 按新旧清单逐文件「旧→trash、新→就位」（`<包根>/.update-trash-<attemptId>/` 同卷 rename，绝不原位覆写；排序遍历；`runtime/` 与 preserve 集永不搬移）；
  5. preserve 核验（存在性＋sqlite 在则在）；失败 → 从备份恢复＋整体回滚；
  6. 重启（状态 `restarting`）：`spawn(nodePath, [launcherPath], {detached…})`（**Start 语义**：launcher 自行处理端口/ready/state；openBrowser 缺省开——Start.cmd 对等，proposed_default）；
  7. 健康版本核验：轮询 `GET /api/health`（plan.serverPort，上限 40s）至 `currentVersion===target` → 状态 `completed`＋删除本次下载 zip＋清 trash；超时/版本不符 → `failed`＋原因（包已换新，指引手动 Start.cmd）。

### 3.4 preserve 清单（定稿）

换装**原位不动**（不在旧包 release-manifest 清单内，天然不搬移）：
- 包根 `trainer.config.json`（用户配置；新包不含该文件）
- 包内 `data/` 整目录（V1.2.6 默认 dataDir：trainer.sqlite 历史、saved-tdx-choice.json、trainer-state.json 等）；dataDir 配置在包外时该目录本就不在包内，同样不动

备份集（backups/update-<ts>/ 内容，缺省跳过）：`trainer.config.json`；dataDir 下 `trainer.sqlite`、`trainer.sqlite-wal`、`trainer.sqlite-shm`、`saved-tdx-choice.json`、`trainer-state.json`。排除：`backups/`、`update-downloads/`、`update-work/`、`*.log`（防递归与体积）。

## 4. 失败回滚矩阵

| # | 阶段 | 失败注入 | 服务态 | 包态 | 处置 |
|---|---|---|---|---|---|
| F1 | 下载 | 网络断 | 运行 | 原样 | failed＋原因 |
| F2 | 校验 | sha 不符/zip 损坏/版本 tag 不符 | 运行 | 原样 | failed＋原因 |
| F3 | 校验 | nodeVersion 不一致 | 运行 | 原样 | failed＋全量包重装指引 |
| F4 | 排空 | 活动训练/忙/超时 | 运行 | 原样 | failed＋原因 |
| F5 | 退出等待 | 优雅退出超时 | 运行 | 原样 | failed（不 SIGKILL） |
| F6 | 备份 | 磁盘错 | 已退出 | 原样 | failed＋尽力拉回旧服务（拉不起→指引手动 Start.cmd） |
| F7 | 换装 | 旧文件搬移失败 | 已退出 | 部分移走 | **回滚**：移走的移回；failed＋尽力拉回 |
| F8 | 换装 | 新文件放置失败 | 已退出 | 部分新旧 | **回滚**：新放置的删除＋移走的移回；failed＋尽力拉回 |
| F9 | preserve 核验 | preserve 损失 | 已退出 | 已换新 | 从备份恢复 preserve＋整体回滚到旧包；failed＋尽力拉回 |
| F10 | 重启 | launcher 拉起失败/健康超时 | 无 | 已换新（F9 前） | failed＋指引手动 Start.cmd（包已更新，数据完好） |

回滚实现：`performSwap` 维护 `moved[]`（旧→trash）与 `placed[]`（新→就位）两个账本；任一步 throw 时逆序回滚（placed 删除→moved 移回），回滚自身的失败如实叠加进 error 报告（不吞）。

## 5. 模块布局与注入面

```
server/src/update/
  version.ts      # 包根定位＋package.json 版本读取（进程内缓存）＋三段版本比较＋tag 归一
  manifest.ts     # 清单 URL 解析（env>config>默认）＋清单拉取解析（fetch 注入）
  zip.ts          # EOCD/central directory 最小读取器＋verifyZipArtifact（version/nodeVersion/sha）
  status.ts       # update-status.json 读写＋形状
  api.ts          # registerUpdateApi：check/apply/status（fetch/spawn/路径/trackTask 全注入）
  apply.ts        # 受理＋下载＋校验＋workdir 准备＋spawn 更新器（launchUpdater 注入）
  updater-core.ts # 纯库：backupPreserve/rotateBackups/performSwap(回滚)/verifyPreserved/restorePreserve
  updater.ts      # runFromPlan：编排（control/exit/relaunch/health 全注入）＋独立进程入口
server/test/
  updater-check.test.ts   # UPD-CHECK-*＋UPD-MANIFEST-INJECTABLE＋UPD-VERSION-EXPOSE
  updater-verify.test.ts  # UPD-DOWNLOAD-VERIFY＋UPD-RUNTIME-COMPAT（真 zip 三态）
  updater-swap.test.ts    # UPD-BACKUP/PRESERVE/APPLY-SWAP/ROLLBACK（迷你包临时目录）
  updater-apply.test.ts   # apply 端到端（注入 fetch＋launchUpdater 内联跑 runFromPlan）
```

测试纪律：manifest fetcher 全注入（**零 api.github.com 访问**）；zip 用 PowerShell Compress-Archive 造真 zip＋字节截断/篡改构造三态；换装在 tmp 迷你包上做；`process.execPath`/spawn/control HTTP/健康探针全注入。

## 6. v1 范围裁剪（YAGNI，proposed_default，随收尾报告转呈）

不做：增量更新、强制更新、自动检查、签名校验、channel/预发布选择；runtime 变更不走在线换装（nodeVersion 完全一致才换，收紧自简报的"大版本"口径）；备份数量 5（简报冻结）；重启后自动开浏览器（Start.cmd 对等）。
手动兜底：GitHub Releases 手动下载路径永久可用（README/文档注明——发布侧文档更新属 UPD-02/发布任务，本设计先落任务卡与验证记录）。

## 7. 发布侧配套核实结论

`scripts/release/build.mjs` **已生成** SHA256SUMS（`<zipSha>  <artifactName>.zip`，随 zip 同目录独立发布，行 602-605），格式与 manifest 消费端解析一致（`^([0-9a-fA-F]{64})[ \t]+\*?(.+)$` 同源口径）。本任务对 build.mjs **零改动**；发布流程需把 SHA256SUMS 一并上传为 release 资产（操作口径，非代码）。门禁跑一次 release 构建验证产物不破坏（§验证记录）。
