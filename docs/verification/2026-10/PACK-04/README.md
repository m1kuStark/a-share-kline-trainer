# PACK-04 验证记录：更新通道整合（electron-updater 对接 GitHub Releases）

任务卡：`docs/work-items/tasks/PACK-04.md`（里程碑 PACK）｜base 091cf98｜2026-10-05｜设计：`design.md`

## 一、验证收据（机器结果）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| TDD RED（desktop 决策层） | `npm run test:desktop`（实现前） | 1 | 精确失败于缺模块 `../src/desktop-updates.js`（缺功能非语法/环境错）；既有 87 例全绿 |
| TDD RED（fixture 集成） | `npx vitest run desktop/test/desktop-updates-fixture.test.ts`（实现前） | 1 | 失败于缺 `update-adapter.js` |
| TDD RED（渲染端） | `npx vitest run server/test/updater-ui.test.ts`（实现前） | 1 | 8 例新测试失败（detectUpdateChannel/desktopEventToApplyView/接线缺失），既有 12 例全绿 |
| desktop 定向（GREEN＋终态） | `npm run test:desktop` | 0 | **102/102**（desktop-updates 12＋fixture 3＋既有 87） |
| web/契约定向（终态） | `npx vitest run server/test/updater-ui.test.ts` | 0 | **20/20**（UPD-02 既有 12＋PACK-04 新 8） |
| e2e 回归（http 通道零变化） | `TDX_ROOT=… npm run journey -- e2e/update-settings.spec.ts --retries=0` | 0 | 3/3（run-8b0b79d5；unexpected=0） |
| 全量测试 | `npm test`（契约基线演进后终态复跑） | 0 | **1524/1524 server＋102/102 desktop**（两次全绿；首跑 2 失败：①ODO-NO-DEPS 依赖冻结清单红＝授权依赖变更检出，按 PACK-01 先例演进基线（§五.1）；②train-range-preview.test.ts 1 例并行负载 flaky，单跑 21/21 绿、全量复跑绿——PACK-02/03 已登记同类现象） |
| 构建 | `npm run build` | 0 | typecheck:web＋build:server＋build:web 全过 |
| 桌面打包 | `npm run build:desktop` | 0 | 便携 exe **104.1 MB**（+5.1MB＝electron-updater 闭包）；**app-update.yml 入包实证**（package-desktop 构建后 fail-closed 核验打印 embedded） |
| 打包冒烟 | `node desktop/scripts/smoke-desktop.mjs --exe desktop/release/kline-trainer-desktop-v1.2.7-windows-x64.exe` | 0 | **SMOKE_PASS total=161.5s**，A-H 全断言过（§二） |
| 绑定检查 updater.yaml | `check-binding.mjs --matrix updater.yaml --strict --include-untracked` | **0** | 22 行：covered=22／open=0／**RED=0**（16 既有行零降级＋6 新 desktop 行全闭合） |
| 绑定检查 desktop-app.yaml | `check-binding.mjs --matrix desktop-app.yaml --strict --include-untracked` | 3（设计内） | 27 行：covered=19／open=8／RED=0（open 全为既有 planned 债务＋PACK-04 伞行＋PACK-05 占位；与 PACK-03 基线数值一致，本轮仅改写 DESKTOP-AUTO-UPDATE 绑定说明为伞行） |
| 零破坏 | `git diff HEAD --stat -- scripts/release launcher.cjs server/src` | — | **空**（UPD-01/02 既有行为零改动；version.ts 只读经编译产物 import，server/src 本体零触碰） |
| 变异 M1（executed） | mapCheckView `> 0`→`>= 0`→定向跑 | 1 | 精确 1 例死＝`UPD-DESKTOP-CHANNEL-PACKAGED: mapCheckView computes updateAvailable with the shared triple-decimal oracle`（平版 1.2.7 误报有更新）；回退后 102/102 绿 |
| 变异 M2（executed） | resolveInstallActionOnExit 删 forced 守卫→定向跑 | 1 | 精确 1 例死＝`UPD-DESKTOP-INSTALL-DRAINS-FIRST: resolveInstallActionOnExit never installs on a forced exit`（排空超时仍带病安装）；回退后 102/102 绿 |

## 二、打包冒烟断言（A-H 全收据）

| 阶段 | 断言 | 实测 |
|---|---|---|
| A-E＋F＋G | PACK-02/03 全阶段回归（health/currentVersion/首页/窗口/单实例/优雅退出/无孤儿/冲突 restart/首启采用幂等/同库共存 reuse） | 全过（收据行见 SMOKE_PASS 输出） |
| H 更新通道（新） | 本地 fixture HTTP（latest.yml v9.9.9＋假安装器＋sha512）＋`TRAINER_DESKTOP_UPDATE_FEED`＋`TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT`，全新 node 宿主＋全套 profile 沙箱（spawn 前 fail-closed 断言重定向位于 scene 临时目录） | **channel=packaged**；**fixture update detected: latest=9.9.9 current=1.2.7 updateAvailable=true**（error null）；**fixture served: /latest.yml**（真实 electron-updater 链路非桩，零 api.github.com）；exe 优雅退出 exit 0（boot check 只查不装） |

## 三、本轮实证的三个平台事实（阶段①调研＋实现期实测，PACK-05/验收必读）

1. **electron-updater v6.8.10 的 `autoUpdater` 是 getter 式 CJS 导出**：`import { autoUpdater } from 'electron-updater'` 在 ESM 下为 **undefined**（cjs-module-lexer 不识别 Object.defineProperty getter）——必须经 `module.default.autoUpdater` 取实例。冒烟阶段 A 曾因此全红（Cannot set properties of undefined (setting 'autoDownload')），修于 `update-adapter.ts defaultDesktopUpdater`（注释留档）。
2. **electron-builder 26.15.3 ＋ `--publish never` 不产出包内 resources/app-update.yml**（实证两轮：无 publish 配置不产出；有 publish 配置同样不产出——PublishManager 发布路径才写）。而该文件是 electron-updater `downloadUpdate` 的硬依赖（getOrCreateDownloadHelper 读 updaterCacheDirName，缺失即 ENOENT）。**回退方案（design §5.3）＝extraResources 静态映射**：`desktop/build-resources/app-update.yml` → `resources/app-update.yml`；package-desktop.mjs 构建后 fail-closed 核验（缺即构建失败）。PACK-05 转正式发布后可复核是否回归 electron-builder 原生产出。
3. **sandboxed preload 不支持 ESM imports**（Electron 官方 ESM 文档）：preload 以 `.cts` 源形态编译出 `dist/preload.cjs`（tsc include 需显式加 `src/**/*.cts`——带扩展名的 include 不匹配 .cts）；sandbox:true/contextIsolation:true 全部保持。

## 四、改动清单（相对 base 091cf98）

**desktop/**（新增 5＋修改 5）：
- `src/desktop-updates.ts`（新）：更新通道纯决策/载荷层（resolveUpdateChannel／resolveUpdateFeed env>GitHub 常量／mapCheckView（compareVersions 单一口径，经 server/dist/update/version.js 只读 import）／normalizeUpdaterError 人话／resolveInstallActionOnExit（forced 永不安装）／createDesktopUpdateController 编排（下载完成→requestInstallWithDrain，绝不直接 quitAndInstall；失败可重试；进行中/未检查守卫））。
- `src/update-adapter.ts`（新）：electron-updater 适配层（手动语义 autoDownload/autoInstallOnAppQuit=false；releaseNotes 归一；defaultDesktopUpdater 走 CJS default 通道取单例——§三.1）。
- `src/update-ipc.ts`（新）：IPC 粘合（handle `desktop-update:invoke` 三方法路由＋boot check 可观测性缝 TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT，off by default 只查不装）。
- `src/preload.cts`（新）：最小 preload（contextBridge 暴露 desktopUpdates 四成员；channel 预取缓存，未就绪保守 dev＝渲染端回落 http，fail-closed）。
- `src/main.ts`：bootstrap 先 setupUpdateChannel（IPC 先于窗口）＋createWindow webPreferences.preload＋exit 分支接入 resolveInstallActionOnExit（quit-and-install→sendEvent installing→quitAndInstall(true,true)；forced→既有退出路径不变）＋requestInstallWithDrain＝installPending+requestGracefulQuit（复用 PACK-02 排空管线零改动）。
- `tsconfig.json`（include＋`src/**/*.cts`）；`electron-builder.yml`（publish github 声明＋extraResources 映射 app-update.yml）；`build-resources/app-update.yml`（新，feed 配置本体）；`scripts/package-desktop.mjs`（REQUIRED＋preload.cjs；构建后 app-update.yml fail-closed 核验）；`scripts/smoke-desktop.mjs`（阶段 H＋--update-child 子模式，阶段 F 同款独立宿主＋全套沙箱）。
- `test/desktop-updates.test.ts`（新，12 例）＋`test/desktop-updates-fixture.test.ts`（新，3 例，真实 NsisUpdater＋注入 AppAdapter＋node HttpExecutor＋本地 fixture HTTP，零 api.github.com）。

**web/**（2 文件，均授权范围内）：
- `src/updateFlow.ts`：additive 扩展（DesktopUpdatesApi/DesktopUpdateEvent/detectUpdateChannel/desktopEventToApplyView/DESKTOP_APPLY_STATE_TEXT——downloading/failed 复用既有冻结文案值，downloaded/installing 新增）；既有导出一字未动。
- `src/components/TrainingSettings.vue`：通道探测（模块级 detectUpdateChannel）＋runCheckUpdate/startUpdateApply 的 desktop 分支（IPC check 同形视图复用三态呈现；downloadAndInstall＋onUpdateEvent 订阅/退订）＋applyStateText computed（http 通道文案值不变）；既有 http 分支与八态表零改动（e2e 3/3 为证）。

**server/test/**（2 文件）：`updater-ui.test.ts`＋84 行（4 describe：通道探测/事件映射/文案复用/接线源码契约）；`frontend-contract.test.ts` ODO-NO-DEPS 依赖冻结清单基线演进（dependencies＋electron-updater，PACK-04 派发简报显式授权，沿 PACK-01 devDeps 先例留档注释）。

**package.json**：dependencies 新增 `electron-updater@^6.8.10`（dist-tag v26 线，与 electron-builder 26.15.3 同代；运行时依赖随 exe 打包，+5.1MB）。**其余零依赖变更**。

**skill 侧**：updater.yaml 追加 6 行 desktop 行（全 covered）＋`form` 轴＋index_dirs 增 desktop/test；desktop-app.yaml DESKTOP-AUTO-UPDATE 占位行改写为伞行（指向 updater.yaml 六行，真机端到端留验收）；镜像 diff 空为证。

**禁改区零改动**：scripts/release/**、launcher.cjs、server/src/**（git diff 空）。

## 五、无签名 Windows 行为说明（验收参考，proposed_default #9）

electron-updater 下载校验阶段读 app-update.yml 的 `publisherName`：本工程无代码签名，publisherName 缺失 → **v26 现状 fail-open**（warn「Signature verification … skipped because no publisherName」后放行安装）；**electron-builder v28 起将 fail-closed**（无 publisherName 直接拒装）。选项留后续任务：①保持无签名（v27 升级前补签名决策）②自签＋publisherName 字段入 app-update.yml。另：portable 目标不被 electron-updater 原地更新（quitAndInstall 会运行下载的 NSIS 安装器——electron-builder#1813）；真实安装端到端＝PACK-05 NSIS＋latest.yml 发布资产后真机验收（与 UPD-01 手动下载兜底同理）。

## 六、行为矩阵状态

- **updater.yaml 22 行：covered=22／open=0／RED=0**（strict --include-untracked exit 0）。既有 16 行（UPD-01 服务端 11＋UPD-02 UI 5）零降级；新增 6 行 desktop 行全部 covered（test_ids＋L2 binding_note 逐行落位；变异 M1/M2 executed 击杀）。
- **desktop-app.yaml 27 行：covered=19／open=8／RED=0**（strict exit 3＝设计内既有债务；数值与 PACK-03 基线一致）。DESKTOP-AUTO-UPDATE 改写为伞行：工程覆盖在 updater.yaml 六行，真实安装端到端（依赖 PACK-05 资产＋真机）保持 planned。

## 七、遗留与移交

1. **真实更新全流程（真机验收）**：发布下一版本（PACK-05 NSIS＋latest.yml 上 GitHub Releases）后，packaged exe → 检查更新 → 下载（进度）→ 排空 → quitAndInstall → 新版自启 → 历史训练数据仍在（adopt-in-place 路径不变）。本轮已就绪通道/编排/UI/事件，未真装。
2. PACK-05 需知：latest.yml 由 electron-builder 发布流生成（publish 配置已就位）；app-update.yml 目前走 extraResources（§三.2），转正式发布时复核。
3. e2e 环境无 preload → 渲染端 desktop 分支的浏览器级呈现未自动化（决策/文案已被单测锁定；真机验收覆盖）。
