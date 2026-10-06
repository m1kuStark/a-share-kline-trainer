# PACK-04 设计：更新通道整合（electron-updater 对接 GitHub Releases）

任务卡：`docs/work-items/tasks/PACK-04.md`｜base 091cf98｜2026-10-05

## 一、现状事实（阶段①，读透再设计）

### 1.1 既有资产与约束

| 资产 | 现状 | 本任务处置 |
|---|---|---|
| `server/src/update/`（UPD-01/02） | HTTP 三端点 check/apply/status＋zip 换装编排；设置页「关于与更新」分栏消费 | **零行为改动**（零破坏证明对象）；dev/源码运行继续用它 |
| `web/src/updateFlow.ts` | UPD-02 纯呈现逻辑（八态文案/轮询决策/守卫人话/断线重连 2s×15） | **扩展不修改**：新增 desktop 通道探测＋事件映射纯函数 |
| `desktop/src/main.ts` | PACK-02/03 生命周期＋数据防线；决策层全在纯函数模块 | 追加更新接线（IPC 注册＋安装退出变体）；既有路径不动 |
| PACK-02 决策「无 preload 无 IPC」 | contextIsolation/sandbox 全开 | **最小化打破**：仅更新相关窄接口 preload（本设计 §三） |
| `desktop/electron-builder.yml` | win target=portable（NSIS 留 PACK-05）；无 publish 配置 | 新增 publish（github）配置使 app-update.yml 入包（§5.3） |
| GitHub repo | m1kuStark/a-share-kline-trainer（Releases 现有 zip＋SHA256SUMS，**无 latest.yml**） | PACK-05 落实发布资产；本任务通道就绪即可 |

### 1.2 electron-updater 调研结论（v6.8.10 实装源码＋文档核实，2026-10-05）

1. **autoUpdater＝win32 上 NsisUpdater**；`checkForUpdates()` 返回 `{isUpdateAvailable, updateInfo{version, releaseNotes…}, downloadPromise}`；`downloadUpdate()`（autoDownload=false 时手动）返回 `{updateFile}`；`quitAndInstall(isSilent?, isForceRunAfter?)`（v6 布尔参数；v7 改对象）。
2. **feed 注入**：`setFeedURL(options|string)`——string＝generic provider（GET `<url>/latest.yml`）；对象可给 `{provider:'github', owner, repo}`。setFeedURL 只覆盖 provider（clientPromise），**不提供 configOnDisk**。
3. **configOnDisk（resources/app-update.yml）是 downloadUpdate 的硬依赖**：`getOrCreateDownloadHelper` 无条件读它取 `updaterCacheDirName`，缺失即 ENOENT 抛错。**实测当前打包产物（PACK-03 portable＋`--publish never`＋无 publish 配置＋package.json repository 字段）resources/ 与 asar 内均无 app-update.yml**——必须让构建产出它（§5.3）。
4. **Windows 无签名行为**：下载校验阶段 `verifySignature` 读 configOnDisk 的 `publisherName`；**缺失→warn＋放行（fail-open，v26 现状）**，electron-builder v28 起改 fail-closed；app-update.yml 整个缺失→ENOENT→静默 success（但见第 3 条 downloadUpdate 先死于 ENOENT）。本工程无代码签名，走 fail-open 放行——写进验证记录供验收参考（未来签名或 PACK-05+ 决策项）。
5. **portable 目标不被 electron-updater 原地更新**（electron-builder#1813）：quitAndInstall 会运行下载的 NSIS 安装器（安装到固定位置），而非替换 portable exe 本体。NSIS 发布资产（PACK-05）后，**安装器形态**才有真实端到端；本任务把通道/编排/UI 全部就绪，真机全流程留验收（与 UPD-01 同理）。
6. **测试注入面**：`new NsisUpdater(null, appAdapter)` 接受注入 AppAdapter（`{version, name, isPackaged, appUpdateConfigPath, userDataPath, baseCachePath, whenReady, relaunch, quit, onQuit}`）——vitest node 环境可跑真实 electron-updater 逻辑（NodeHttpExecutor：`process.versions.electron` 缺省时生效）；appUpdateConfigPath 指向测试自写 fixture yml（含 updaterCacheDirName），即绕开第 3 条依赖。
7. **latest.yml 最小形状**（generic provider）：`{version, files: [{url, sha512, size}], path, sha512, releaseDate}`；文件缺 sha512/sha2 直接 `ERR_UPDATER_NO_CHECKSUM`。blockmap 差分下载失败自动回退全量（win32）。
8. v6 事件：`checking-for-update`/`update-available`/`update-not-available`/`error`/`download-progress`（`{percent, transferred, total, bytesPerSecond}`）/`update-downloaded`（`{version}`）。`autoInstallOnAppQuit`（v6 存在，v7 移除）默认 true——**显式关掉**保证安装只经我们的排空路径。

## 二、双通道与 IPC 契约

### 2.1 通道决策（resolveUpdateChannel 纯函数）

```
resolveUpdateChannel({ isPackaged })
  isPackaged=true  → 'packaged'（electron-updater 通道）
  isPackaged=false → 'dev'（既有 UPD HTTP 端点；含 DESKTOP_DEV_URL 开发窗口与纯浏览器）
```

渲染端探测（updateFlow.ts 纯函数 `detectUpdateChannel`）：

```
window.desktopUpdates 不存在（纯浏览器/e2e 环境）      → 'http'（既有流程，零变化）
window.desktopUpdates.channel().kind === 'packaged'    → 'desktop'（IPC 流程）
window.desktopUpdates.channel().kind === 'dev'         → 'http'（既有流程）
```

### 2.2 IPC 窄接口（preload contextBridge 暴露 `window.desktopUpdates`）

| 方法/属性 | 形状 | 语义 |
|---|---|---|
| `channel()` | `() => { kind: 'packaged' \| 'dev' }` | 同步；dev/源码＝dev（渲染端回落 HTTP） |
| `checkForUpdates()` | `() => Promise<DesktopUpdateCheckView>` | 见 §2.3（与 UPD HTTP check 同形，UI 三态复用） |
| `downloadAndInstall()` | `() => Promise<{ ok: true } \| { ok: false, error: string }>` | 下载→（完成后）排空→quitAndInstall；进度/状态经事件 |
| `onUpdateEvent(cb)` | `(cb) => () => void` | 订阅主进程事件（§2.4）；返回退订函数 |

约束：contextIsolation 保持 true、sandbox 保持 true、preload 只经 contextBridge 暴露此一对象；ipcMain 通道仅 `desktop-update:invoke`（invoke/handle 对）＋`desktop-update:event`（单向 send）两条——IPC 面最小化。

### 2.3 check 视图（与 UPD-01 契约 §2.1 同形，camelCase）

```ts
interface DesktopUpdateCheckView {
  currentVersion: string | null      // app.getVersion()（＝包根 package.json version）
  latestVersion: string | null       // latest.yml version
  updateAvailable: boolean           // compareVersions(latest, current) > 0 ——复用 server version.ts 口径
  releaseNotes: string | null        // latest.yml releaseNotes（GitHub release notes 摘要）
  error: string | null               // 人话中文（网络错/清单缺失/解析失败）
}
```

updateAvailable 由**我方**用 `server/src/update/version.ts` 的 `compareVersions` 计算（desktop 经编译产物 `server/dist/update/version.js` 只读 import——单一版本口径），不信 electron-updater 的 isUpdateAvailable 回显（其内部 semver 与三段十进制在 x.y.z 上等价，双算不一致时以我方口径为准并记日志）。

### 2.4 事件表（main→renderer）

| 事件 type | 载荷 | 渲染端映射（desktopEventToApplyView 纯函数） |
|---|---|---|
| `download-progress` | `{percent, transferred, total, bytesPerSecond}` | downloading＋百分比（复用既有文案「正在下载新版本…（N%）」） |
| `downloaded` | `{version}` | downloaded（新增文案「新版本下载完成，准备安装…」，additive） |
| `installing` | `{}` | installing（新增文案「正在安装并重启…」，additive；此后进程退出） |
| `error` | `{message}` | failed（复用失败行样式＋message） |

渲染端 check 三态、确认弹窗、进度行 DOM 结构与 class 全部复用既有（`.update-progress` 等）；仅新增两个呈现文案键（proposed_default，验收可调）。

## 三、主进程更新模块与退出接线

### 3.1 新模块 `desktop/src/desktop-updates.ts`（纯决策＋载荷层，vitest 直接测）

- `resolveUpdateChannel(input)`：§2.1。
- `resolveUpdateFeed(env)`：`TRAINER_DESKTOP_UPDATE_FEED`（http(s) URL，trim 非空即用）→ generic 注入；否则 `{provider:'github', owner:'m1kuStark', repo:'a-share-kline-trainer'}`（常量，与 package.json repository 同源）。
- `mapCheckView({ currentVersion, latestVersion, releaseNotes, error })`：error 非 null → `{updateAvailable:false, latestVersion:null, error}`；否则 compareVersions 判定（不可解析版本→error 人话，不猜）。
- `normalizeUpdaterError(error)`：electron-updater 错误码→人话（`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`→「无法检查更新：更新源未提供 latest.yml」；网络类→「无法检查更新：网络错误」；其余 message 直传截断）。
- `resolveInstallActionOnExit({ installPending, forced })`：`forced=true → 'plain-quit'`（排空超时绝不安装，缓存的更新留待下次）；`forced=false && installPending → 'quit-and-install'`；否则 `'plain-quit'`。
- `createDesktopUpdateController(deps)`（编排对象，deps 全注入）：`{ updaterAdapter, sendEvent, requestInstallWithDrain, logger }`：
  - `checkForUpdates()`：调用 adapter.checkForUpdates → mapCheckView；错误→normalizeUpdaterError。
  - `downloadAndInstall()`：守卫（下载中拒绝「更新已在进行中」；未检查过→「请先检查更新」）→ adapter.downloadUpdate() →（事件流经 adapter 回调）→ 下载完成 → sendEvent downloaded → **requestInstallWithDrain()**（≠直接 quitAndInstall——安装统一走排空退出管线，见 3.2）；downloadUpdate reject → sendEvent error＋返回 ok:false（可重试）。
  - updaterAdapter 接口（main 里绑 autoUpdater，测试里绑真实 NsisUpdater 或桩）：`{ setFeedURL(feed), checkForUpdates(), downloadUpdate(), onProgress(cb), onDownloaded(cb), onError(cb), quitAndInstall(isSilent, isForceRunAfter) }`。

### 3.2 退出接线（main.ts；复用 PACK-02 优雅退出，不新造协议）

```
downloaded 事件 → controller.requestInstallWithDrain() → main.ts: installPending=true
  + requestQuit 触发（attemptId=update-<uuid>）——走既有 quit-state 管线：
  drain.prepare(allowActiveTraining:true)（in-app 口径：未完成训练保留 SQLite）
  → drain-outcome → shutdown → state=quit + action={call:'exit', forced, reason}
dispatchQuitEvent 的 exit 分支新增：
  const installAction = resolveInstallActionOnExit({ installPending, forced: action.forced })
  installAction==='quit-and-install' → sendEvent('installing') → autoUpdater.quitAndInstall(true, true)
  否则 → app.quit()/app.exit()（既有行为不变）
```

- 排空超时（drain-timeout/outer-timeout→forced exit）：**不安装**（resolveInstallActionOnExit 强制 plain-quit），更新留在 electron-updater 缓存，用户重开应用可重新走流程（autoInstallOnAppQuit=false 保证不绕过排空）。
- 下载期间用户关窗口（window-all-closed→graceful quit）：正常退出不安装（installPending 仅在 downloaded 后置位；下载中被 quit 则 downloadUpdate 的 promise 悬空、进程退出即止——无半安装状态，重试全量下载）。
- in-app 口径与 UPD HTTP 通道 ACTIVE_TRAINING 守卫的等价性：HTTP 通道 409 拒绝活动训练后在 apply 时排空；desktop 通道以 allowActiveTraining:true 排空保留未完成训练于 SQLite 后再装——两通道都不丢训练数据（差异登记：desktop 不挡活动训练，靠排空保留；写入 proposed_default 清单）。

### 3.3 IPC 粘合 `desktop/src/update-ipc.ts`（依赖注入 Electron API，vitest 不 import 本文件）

- `registerUpdateIpc({ ipcMain, getWindow, controller, isPackaged })`：handle `desktop-update:invoke`（method 路由 channel/checkForUpdates/downloadAndInstall）＋ sendEvent 经 `webContents.send('desktop-update:event', payload)`（窗口不存在时丢弃，仅日志）。
- **可观测性缝**（冒烟用，off by default）：env `TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT=<path>` 且 packaged → app ready 后做**一次** checkForUpdates 并把 `{channel:'packaged', ...view}` 原子写该路径（失败写 `{channel:'packaged', error}`）。与 TRAINER_DESKTOP_CONFLICT_ANSWER 同类的 env 注入缝；不改变用户可见行为（手动检查仍是产品行为）。

### 3.4 preload `desktop/src/preload.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron'
// channel 同步走 invoke？——invoke 是异步的。channel() 需同步 ⇒ preload 启动时先 invoke 一次缓存，
// channel() 返回缓存值（主进程在窗口创建前已定 isPackaged，值恒定不漂移）。
const ready = ipcRenderer.invoke('desktop-update:invoke', { method: 'channel' })
let cachedChannel = { kind: 'dev' }        // 未就绪保守值：渲染端回落 HTTP 流程
ready.then(v => { cachedChannel = v }).catch(() => {})
contextBridge.exposeInMainWorld('desktopUpdates', {
  channel: () => cachedChannel,
  checkForUpdates: () => ipcRenderer.invoke('desktop-update:invoke', { method: 'checkForUpdates' }),
  downloadAndInstall: () => ipcRenderer.invoke('desktop-update:invoke', { method: 'downloadAndInstall' }),
  onUpdateEvent: cb => { const listener = (_e, payload) => cb(payload); ipcRenderer.on('desktop-update:event', listener); return () => ipcRenderer.off('desktop-update:event', listener) },
})
```

（通道名/载荷形状为契约；preload 不做任何业务逻辑。）

## 四、渲染端接线（TrainingSettings.vue，既有行为零改动）

- `enterAboutSection` 增加一次性通道探测：`updateChannel = detectUpdateChannel(window.desktopUpdates)`（'http'|'desktop'）。
- `runCheckUpdate`：desktop → `window.desktopUpdates.checkForUpdates()` 返回同形 view → **同一套三态渲染分支**（文案/DOM 零变化）；http → 既有 fetch 分支不动。
- `startUpdateApply`：desktop → 同一确认弹窗 → 订阅 onUpdateEvent（desktopEventToApplyView 映射到既有进度行呈现）→ `downloadAndInstall()`；http → 既有分支不动。
- `web/src/updateFlow.ts` 新增（additive）：`DesktopUpdateChannelKind`、`DesktopUpdatesApi`、`detectUpdateChannel`、`DesktopUpdateEvent`、`desktopEventToApplyView`、`DESKTOP_APPLY_STATE_TEXT`（downloading 复用既有文案值；downloaded/installing 新增）。组件既有 HTTP 状态机函数与八态文案表一字不动。

## 五、构建与发布侧

### 5.1 依赖

`package.json` dependencies 新增 `electron-updater@^6.8.10`（dist-tag v26＝6.8.10，与 electron-builder 26.15.3 同代；运行时依赖随 exe 打包——node_modules 闭包入 asar，electron-builder files 规则既有保留策略覆盖）。

### 5.2 UPD-01/02 既有资产处置

HTTP 端点＋UI 状态机＋updater.yaml 既有 16 行零降级（零破坏 diff 收据：`git diff HEAD --stat -- server/src scripts/release launcher.cjs` 空；web 侧仅 updateFlow.ts 追加导出＋TrainingSettings.vue 分支扩展——既有 e2e（update-settings.spec.ts 三用例）必须全绿）。开发运行（npm run dev / dev:desktop）下 check/apply 行为与 UPD-02 验收时完全一致（浏览器无 preload→恒 http 通道）。

### 5.3 app-update.yml 入包（downloadUpdate 硬依赖，§1.2-3）

`desktop/electron-builder.yml` 追加：

```yaml
publish:
  - provider: github
    owner: m1kuStark
    repo: a-share-kline-trainer
```

构建后**实证核验** win-unpacked/resources/app-update.yml 存在且含 provider/updaterCacheDirName；若 v26.15.3 在 `--publish never` 下不落该文件（打包器行为差异风险），回退方案＝extraResources 静态映射该 yml 到 resources/（内容自写，同 provider＋updaterCacheDirName: a-share-kline-trainer）。任一路径都以构建产物实证为准，写进验证记录。

## 六、TDD 计划（阶段③④；先红后绿）

| 层 | 文件 | 用例群（先红后绿） |
|---|---|---|
| 纯函数 | `desktop/test/desktop-updates.test.ts` | resolveUpdateChannel 两档；resolveUpdateFeed 注入/缺省/空串；mapCheckView（新版/平版/旧版/解析错→人话 error/版本不可解析不猜）；normalizeUpdaterError 三类；resolveInstallActionOnExit 三档（**forced 永不安装**）；controller 编排（桩 adapter）：check 错误映射、downloadAndInstall 守卫（进行中拒/未检查拒）、下载完成→**requestInstallWithDrain 被调且 quitAndInstall 未被调**（锁安装必经排空管线）、下载失败→error 事件＋可重试（二次调用放行） |
| 真实集成 | `desktop/test/desktop-updates-fixture.test.ts` | 注入 AppAdapter 的真实 `NsisUpdater`＋本地 fixture HTTP 服务（latest.yml v9.9.9＋假 exe＋sha512）：check→updateAvailable true＋view 字段；autoDownload=false；downloadUpdate→progress 事件≥1＋resolve updateFile 落盘；feed 404→人话 error；**全程零 api.github.com**（fixture 服务即唯一端点） |
| 渲染纯函数 | `server/test/updater-ui.test.ts` 追加 describe | detectUpdateChannel 三档（undefined→http、packaged→desktop、dev→http）；desktopEventToApplyView 四事件映射（downloading+percent 夹取/downloaded/installing/error）；DESKTOP_APPLY_STATE_TEXT downloading 文案＝既有 UPDATE_STATE_TEXT.downloading（锁复用）；TrainingSettings.vue 源码契约：desktop 分支接线（detectUpdateChannel 调用＋downloadAndInstall＋onUpdateEvent 订阅与退订）且既有 http 分支 fetch 调用原样 |
| 冒烟 | `smoke-desktop.mjs` 阶段 H | 本地 fixture HTTP 服务（latest.yml v9.9.9＋假 exe）＋`TRAINER_DESKTOP_UPDATE_FEED`＋`TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT` spawn packaged exe（全套 profile 沙箱同阶段 F）→ 断言 out 文件：channel=packaged＋updateAvailable=true＋latestVersion=9.9.9；exe 正常退出（不安装——boot check 只查不装）；A-G 全阶段回归 |
| 主进程粘合 | 源码契约（并入 desktop-updates.test.ts） | main.ts 含 resolveInstallActionOnExit 于 exit 分支、quitAndInstall 仅经该分支调用（grep 级契约）；preload 仅 contextBridge 一对象＋无其他 require 业务面 |

## 七、零破坏与边界

- **禁改**：`server/src/**`（version.ts 只读 import 经编译产物）、`scripts/release/**`、`launcher.cjs`；package.json 仅新增 electron-updater 依赖。
- **web**：updateFlow.ts 仅追加导出（既有导出一字不动）；TrainingSettings.vue 既有 http 分支与文案不动（e2e update-settings.spec.ts 全绿为证）。
- **矩阵**：updater.yaml 既有 16 行不动，追加 6 行 desktop 行；desktop-app.yaml DESKTOP-AUTO-UPDATE 占位行升格为伞行（指向 updater.yaml desktop 行，真机端到端留验收）；镜像同步 diff 空为证。
- 真实数据铁律：冒烟阶段 H 沿用阶段 F 全套 profile 沙箱＋spawn 前断言重定向路径位于临时目录（fail-closed，development-principles §五）。

## 八、proposed_default 清单（收尾报告呈报）

1. **手动检查不自动**：不注册任何自动 checkForUpdates（含启动时）；用户点击才查。
2. **安装前排空**：downloaded → in-app 口径排空（allowActiveTraining:true，未完成训练保留 SQLite）→ quitAndInstall(true, true)（静默安装＋装完自动重启）。
3. **排空超时不安装**：forced exit 路径 plain-quit，更新留缓存可重试。
4. **feed 注入口**：env `TRAINER_DESKTOP_UPDATE_FEED`（generic URL）；缺省 GitHub provider 常量（owner/repo 同 package.json repository）。
5. **boot check 可观测缝**：env `TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT`（冒烟专用，off by default，不改用户行为）。
6. **新增两个呈现文案**（downloaded/installing）；check 三态与确认弹窗复用既有文案。
7. **desktop 通道不挡活动训练**（以排空保留替代 HTTP 通道的 ACTIVE_TRAINING 409 拒绝——语义等价性见 §3.2）。
8. **app-update.yml 入包方式**（publish 配置 vs extraResources 回退，以构建实证为准）。
9. **无签名 fail-open 现状**：v26 下载校验 publisherName 缺失放行＋warn；v28 将 fail-closed——签名决策留后续任务。
10. **portable 形态端到端限制**（§1.2-5）：真实安装全流程待 PACK-05 NSIS 资产＋真机验收。
