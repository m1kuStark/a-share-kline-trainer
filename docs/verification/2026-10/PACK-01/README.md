# PACK-01 验证记录：桌面 exe 形态选型验证 spike＋Electron 最小原型

任务卡：`docs/work-items/tasks/PACK-01.md`（里程碑 PACK）｜base c298bce｜2026-10-06

## 一、spike 必答五问（决策备忘录）

### Q1 选定版本与 node:sqlite 实测

- **Electron 44.5.1**（2026-10-06 npm registry npmmirror 最新稳定）＋ **electron-builder 26.15.3**。
- **Electron 内置 Node＝24.21.0**（实测 `ELECTRON_RUN_AS_NODE=1 electron -e`，ABI modules=149）。仓库 `engines: node>=24` 语义满足（运行时同为 Node 24 大版本；本机开发链为 24.15.0，Electron 44.5.1 略新）。
- **node:sqlite 实测可用**：ELECTRON_RUN_AS_NODE 下 `DatabaseSync` 内存库建表/插入/查询通过；随后在**完整 Electron 主进程**内进程内启动真实 server（隔离库）冒烟通过（dev 实机：health 200＋currentVersion；打包后：SMOKE_PASS）。仓库无任何原生模块依赖，无 ABI 重编译问题。
- 结论：**进程内嵌路径成立**，无需触发降级。

### Q2 降级决策树走向

- 一级（选定，已验证）：Electron 主进程 `import { startTrainerServer }` 进程内启动（见 `desktop/src/main.ts`）。
- 二级（未触发）：sidecar——打包 node.exe 子进程跑 `server/dist/index.js`，主进程只做窗口与生命周期。触发条件（Node 版本/ABI/API 差异）在本机全部未出现。
- 三级兜底（未触发）：Electron 二进制持续下载失败→回退 Tauri 2 sidecar。镜像 `ELECTRON_MIRROR`（npmmirror）一次成功，未发生下载重试。

### Q3 electron-builder 配置要点（`desktop/electron-builder.yml`）

- `appId: io.github.m1kustark.a-share-kline-trainer`（proposed_default）；`productName: K线训练器`。
- `directories.output: desktop/release`（已 .gitignore）；`buildResources: desktop/build-resources`（icon 复用 assets/trainer.ico）。
- `files`：`desktop/dist/**`＋`server/dist/**`＋`web/dist/**`＋`package.json`；显式 files 清单覆盖默认 `**/*`；**仅排除前端框架本体** vue/pinia/klinecharts/lucide-vue-next（pinia 唯一依赖 vue）。electron-builder 自动收入生产依赖闭包（fastify/@fastify:*/pino/pinyin-pro/glob/@lukeed/ms 等）。
  - 教训（已固化进 yml 注释）：曾尝试手工追加排除 @vue/@babel/postcss 等前端构建链，**两次误杀运行时依赖**（`glob`←@fastify/static v10、`@lukeed/ms`←@fastify/send），压缩后仅省 ~1MB——逐包猜测闭包不可行，精确裁剪留 PACK-02+ 以「运行时可达闭包」清单方式做。
- `asar: true`（server 代码＋node_modules 均在 asar 内，@fastify/static 读 asar 内 web/dist 实测正常；node:sqlite 的库文件在 asar 外的 dataDir）。
- 便携目标：`win.target=portable, arch=x64`；**NSIS 安装器留 PACK-05**（portable 目标本身也下载 nsis 工具链，来自 electron-builder-binaries 镜像）。
- 产物命名：`kline-trainer-desktop-v${version}-windows-x64.exe`——与 zip 惯例 `kline-trainer-v<version>-windows-x64.zip` 可区分（desktop 中缀）。
- 镜像固化：`desktop/scripts/package-desktop.mjs` 内置 `ELECTRON_MIRROR`/`ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror），不依赖临时环境。

### Q4 打包体积实测

- 便携 exe（`kline-trainer-desktop-v1.2.7-windows-x64.exe`）：**99.0 MB**（首次含前端构建链完整闭包的版本 97.9MB，恢复 glob 后 99.0MB）。
- 解压态（win-unpacked）：约 400 MB 磁盘占用（Electron 运行时为主）；便携 exe 每次启动先解压到 %TEMP%（首启实测 12.5s 含解压+建库）。
- 对照：现有 zip 形态 ≈ node.exe(~90MB zip 解压后)+应用，量级相当。

### Q5 隔离数据机制（打包形态）

- 服务端配置读取＝`server/src/config.ts`：`TRAINER_RUN_ID` 置位即「隔离运行」模式，强制 `TRAINER_DB`/`TRAINER_STATIC_DIR`/`TRAINER_READY_FILE` 三绝对路径；dataDir 经 `TRAINER_DATA_DIR`；端口 `PORT`；`TDX_ROOT`；令牌 `TRAINER_CONTROL_TOKEN`。
- 桌面主进程 `desktop/src/desktop-config.ts`：launcher 同序优先级（env > 便携默认）；**默认 dataDir＝`PORTABLE_EXECUTABLE_DIR`（便携 exe 所在目录，electron-builder 注入）下 data/**——与 zip「包根 data」语义（V1.2.6 冻结）对齐（proposed_default 待拍板）；`buildServerEnv` 组装 launcher-parity env 后注入 `process.env` 再动态 import 服务入口。
- **冒烟/测试绝不触碰真实用户数据**：`%USERPROFILE%\.a-share-kline-trainer` 与既有 zip data/ 一律不读不写；所有冒烟以临时 `TRAINER_DATA_DIR`/`TRAINER_DB`＋空闲端口隔离（SMOKE 日志可见 dataDir 指向 pack01-smoke-* 临时目录）。开发实测期间曾探测到 8787 被用户真实 dev server 占用（PID 55792）——全程未触碰，冒烟端口由 bind 探测分配。

## 二、验证收据（机器结果）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 安装 | `ELECTRON_MIRROR=… npm install --no-audit --no-fund` | 0 | added 248 packages；electron 二进制经镜像手动 `install.js` 补齐（npm postinstall 未自动跑，如实记录） |
| desktop 定向单测 | `npm run test:desktop` | 0 | 6/6（DESKTOP-CONFIG-RESOLVE×3／ENV-ASSEMBLY×2／APP-URL×1） |
| server 定向单测 | `npx vitest run --config server/vitest.config.ts server/test/server-entry-programmatic.test.ts server/test/setup-control-process.test.ts` | 0 | 3/3（新进程内 2＋既有 CLI 子进程闭环 1） |
| 全量测试 | `npm test`（server 120 文件＋desktop 1 文件） | 0 | **1521/1521 全绿，零存量失败**（server 1515＋desktop 6） |
| 构建 | `npm run build` | 0 | typecheck:web＋build:server＋build:web 全过 |
| 桌面打包 | `npm run build:desktop` | 0 | 便携 exe 产出（99.0 MB） |
| 打包冒烟 | `node desktop/scripts/smoke-desktop.mjs --exe …` | 0 | **SMOKE_PASS**：临时目录副本→health 200（boot 12.5s）→currentVersion=1.2.7→首页 HTML 200→窗口「K线训练器」count=1→强杀退出（总 17.4s） |
| 绑定检查 | `check-binding.mjs --matrix desktop-app.yaml --strict --include-untracked` | 3（设计内） | 14 行：covered=4／open=10／RED=0；open＝PACK-01 手册/冒烟行＋PACK-02..05 占位（派发简报要求的预期占位），本任务可闭合行（config/env/url/server-entry）已全闭合 |
| 回归：updater | `check-binding.mjs --matrix updater.yaml --strict` | 0 | 11/11 covered 不受 index.ts 重构影响 |
| 回归：launcher-lifecycle | `check-binding.mjs --matrix launcher-lifecycle.yaml --strict` | 0 | 8/8 covered |
| 零破坏 | `git diff --stat HEAD -- scripts/release/ web/ launcher.cjs` | 0 | **空**（zip 形态/PORT-02/UPD 语义零改动） |

### 冒烟失败复盘（如实记录）

首次冒烟（首版 exe，无 stderr 捕获）health 120s 不可达、原因未确诊（当时无 stderr 通道）；第二次起冒烟脚本已捕获 exe stderr 到日志并在失败时尾部输出。后续两次失败原因确诊为瘦身清单误杀 `glob`/`@lukeed/ms`（运行时依赖），修正配置后 unpacked＋portable 双通道确定性通过。首失败的候选归因：未签名 ~98MB 新 exe 的 Defender 首扫超时（不可复现验证）；PACK-02 应把 health 等待上限提高或在慢机上预热重试。

## 三、行为矩阵状态（desktop-app.yaml，14 行）

- **covered=4**：DESKTOP-CONFIG-RESOLVE／DESKTOP-SERVER-ENV-ASSEMBLY／DESKTOP-APP-URL（desktop/test/desktop-config.test.ts 6 例）＋DESKTOP-SERVER-ENTRY-PROGRAMMATIC（server/test/server-entry-programmatic.test.ts 2 例＋既有 setup-control-process 1 例）。全部 L2（期望值手写自 launcher 冻结口径/包根 package.json，独立 oracle）。
- **open=10（planned）**：PACK-01 的 Electron 粘合层四行（EMBED/WINDOW/SINGLE-INSTANCE-BASIC/DEV-SCRIPTS）＋打包两行（PORTABLE-EXE-SMOKE／ZIP-ZERO-BREAK）——本轮以脚本/实机收据验证（本 README 第二节），自动化绑定留 PACK-02；PACK-02..05 占位四行（LIFECYCLE-FULL/PACK03-RESERVED/AUTO-UPDATE/NSIS-INSTALLER）。
- **变异抽检（executed）**：M1 删除相对路径拒绝→杀手 `DESKTOP-CONFIG-RESOLVE: relative TRAINER_DB / TRAINER_DATA_DIR are rejected`（1 failed 精确命中，回退后 6/6 绿）；M2 `127.0.0.1`→`localhost`→杀手 `DESKTOP-APP-URL: builds the loopback app URL from the listening port`（同法回绿）。收据见会话日志，矩阵 binding_note 已标 executed（2026-10-06）。

## 四、改动清单

- 新增 `desktop/`：`src/main.ts`（Electron 主进程：单实例锁基础版→DESKTOP_DEV_URL 窗口模式或进程内嵌 server→BrowserWindow「K线训练器」）；`src/desktop-config.ts`（纯函数层）；`test/desktop-config.test.ts`；`tsconfig.json`；`vitest.config.ts`；`electron-builder.yml`；`build-resources/icon.ico`（复用 assets/trainer.ico）；`scripts/dev-window.mjs`（dev 窗口）；`scripts/package-desktop.mjs`（镜像固化＋preflight＋builder 编排）；`scripts/smoke-desktop.mjs`（打包冒烟）。
- `server/src/index.ts`：行为保持重构——`startTrainerServer()` 导出（loadConfig→建库→组装→listen→返回句柄），CLI 行为（ready 文件/SIGINT/SIGTERM/trainer:shutdown IPC/disconnect/浏览器打开）收敛到 `isCliInvocation()` 守卫块。已知微差（如实）：信号处理器注册从 listen 前移到 listen 后（启动子秒窗口内到达的 SIGTERM 将走默认终止而非优雅排空）；既有 CLI 子进程闭环测试与 updater 源码契约全绿为证。
- `server/test/`：新增 `server-entry-programmatic.test.ts`（2 例）；`frontend-contract.test.ts` ODO-NO-DEPS 冻结清单基线演进（devDeps +electron+electron-builder，runtime deps 不动——派发简报授权的 devDeps 增补，非"改基线换绿"）。
- `package.json`：`main: desktop/dist/main.js`；scripts 新增 `dev:desktop`/`dev:desktop:window`/`build:desktop`/`build:desktop:main`/`test:desktop`（`test` 串接 test:desktop）；devDeps +electron^44.5.1 +electron-builder^26.15.3。zip 包会原样携带 package.json（main 字段对 zip 运行时无影响，launcher 直接 spawn node server/dist/index.js）。
- `.gitignore`：+`desktop/dist/`、`desktop/release/`。

## 五、待拍板项（needs_user_decision / proposed_default）

1. **默认数据目录（proposed_default）**：便携 exe＝exe 同级 `data/`（PORTABLE_EXECUTABLE_DIR），与 zip「包根 data」语义对齐。备选：`%APPDATA%\a-share-kline-trainer`（安装器形态更常见）。影响：用户把 exe 放桌面时数据落在桌面 data/。
2. **appId/productName（proposed_default）**：`io.github.m1kustark.a-share-kline-trainer`／`K线训练器`（exe 元数据与后续 PACK-04/05 更新通道、安装器复用，尽早冻结）。
3. **窗口标题固定策略（proposed_default）**：页面自带 `<title>A股 K线训练器</title>`，按需求冻结窗口标题「K线训练器」采用 `page-title-updated` preventDefault；若用户想要页面标题自然接管可去掉。
4. **产物命名（proposed_default）**：`kline-trainer-desktop-v<版本>-windows-x64.exe`（与 zip 区分）；NSIS 安装器命名 PACK-05 再定。
5. **依赖闭包裁剪（登记）**：当前 asar 含 @vue/@babel/postcss 等前端构建链死重（压缩后 ~1MB）；精确裁剪需「运行时可达闭包」清单，留 PACK-02+（两次误杀教训已固化在 electron-builder.yml 注释）。
6. **desktop-app 矩阵 open=10（登记）**：PACK-01 手册/冒烟行＋PACK-02..05 占位，strict exit=3 为设计内状态；PACK-02 起逐步闭合。

## 六、设计细节

见同目录 `design.md`（架构图、启动序列、env 矩阵、降级树、打包布局）。
