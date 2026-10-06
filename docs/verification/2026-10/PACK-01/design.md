# PACK-01 设计文档：Electron 内嵌 Fastify 桌面形态（最小原型）

## 1. 架构与启动序列

```
kline-trainer-desktop-v<版本>-windows-x64.exe (portable, NSIS sfx)
 └─ 解压到 %TEMP%\<rand>\ → 运行 Electron 44.5.1 (内置 Node 24.21.0)
     └─ app.asar/desktop/dist/main.js  （package.json main）
         ├─ app.requestSingleInstanceLock()  未获锁→quit（基础版；second-instance→聚焦）
         ├─ DESKTOP_DEV_URL? → BrowserWindow(该 URL)  【开发窗口模式，不内嵌服务】
         └─ 打包模式：
             ├─ resolveDesktopConfig(env, {exeDir=PORTABLE_EXECUTABLE_DIR, appRoot=app.getAppPath()})
             ├─ Object.assign(process.env, buildServerEnv(config))   ← 注入后才 import
             ├─ await import('../../server/dist/index.js').startTrainerServer()
             │    └─ 进程内：loadConfig→ensureDatabaseDirectory→openDatabase(node:sqlite)
             │       →migrateDatabase→Fastify 组装→listen(127.0.0.1:PORT)→返回{url,port,shutdown}
             ├─ BrowserWindow.loadURL(`http://127.0.0.1:${port}`) 标题「K线训练器」
             └─ window-all-closed / before-quit → serverHandle.shutdown() → app.quit()
```

关键顺序约束：server 的 `loadConfig()` 在**调用时**读 `process.env`，因此 env 注入必须先于动态 import（import 本身经 CLI 守卫无副作用）。

## 2. server 入口双形态（行为保持重构）

- `startTrainerServer(): Promise<StartedTrainerServer>`＝原顶层副作用序列（loadConfig→库→组装→listen）打包为函数；`shutdown()` 幂等（closing 缓存），关 app+库+ready 文件+IPC disconnect。
- `isCliInvocation()`：`import.meta.url === pathToFileURL(resolve(process.argv[1])).href`——`node server/dist/index.js`/`tsx server/src/index.ts`/launcher spawn 均为 true；vitest/Electron import 为 false。
- CLI 块保持原顺序：ready 文件原子写（tmp+rename）→console.log→信号/IPC/disconnect→浏览器打开（OPEN_BROWSER!==0 && !VITEST）。
- 已知微差：信号处理器注册时点从 listen 前移到 listen 后（README 第一节复盘）。
- 行为证据：`server/test/setup-control-process.test.ts`（真实子进程：健康→prepare→shutdown 202→exit 0→端口可重绑→ready 清理→SQLite 完整）；`updater-check.test.ts` 源码契约（currentVersion 接线四断言）。

## 3. 配置与 env 矩阵（desktop-config.ts ↔ config.ts ↔ launcher.cjs 对齐）

| 用途 | env | 缺省（打包形态） | 校验 |
|---|---|---|---|
| 端口 | `PORT` | 8787 | 整数 0..65535（0=动态） |
| 数据目录 | `TRAINER_DATA_DIR` | `<exeDir>/data` | 显式时必须绝对 |
| 数据库 | `TRAINER_DB` | `<dataDir>/trainer.sqlite` | 显式时必须绝对 |
| 静态目录 | `TRAINER_STATIC_DIR` | `<appRoot>/web/dist`（asar 内） | server 隔离模式必填（由 buildServerEnv 给足） |
| ready 文件 | `TRAINER_READY_FILE` | `<dataDir>/ready.json`（仅满足隔离校验契约；进程内启动不等待该文件） | 绝对 |
| 行情根 | `TDX_ROOT` | null（空串/空白→null） | 显式时必须绝对 |
| 控制令牌 | `TRAINER_CONTROL_TOKEN` | 自动 `ctr-<uuid>` | — |
| 运行身份 | `TRAINER_RUN_ID` | `run-<uuid>`（buildServerEnv 生成） | 置位即隔离模式 |
| 浏览器 | `OPEN_BROWSER` | 强制 `0`（桌面形态不开外部浏览器） | — |
| 监听 | `HOST` | 强制 `127.0.0.1` | — |

优先级与 launcher.cjs `resolveConfig` 同序：env 显式值 > 便携默认。冒烟隔离＝全部指向临时目录＋bind 探测空闲端口；绝不触碰 `%USERPROFILE%\.a-share-kline-trainer` 与既有 zip data/。

## 4. 降级决策树（备忘）

1. **进程内嵌（选定，已实证）**：内置 Node 24.21.0 满足 engines>=24；node:sqlite 在完整 Electron 主进程实测通过；无原生模块。
2. **sidecar**：触发条件＝进程内出现 Node 版本/ABI/API 硬阻塞。形态＝打包 node.exe 子进程跑 server/dist/index.js（复用 launcher 语义），主进程只做窗口与生命周期。本轮未触发。
3. **Tauri 2 sidecar（兜底）**：触发条件＝Electron 二进制持续下载失败（重试 60s×3 后仍失败）。备忘：Tauri 下 node.exe 仍需 sidecar 打包（尺寸优势蒸发）＋Rust 工具链负担——除非硬阻塞否则不切换。本轮未触发。

## 5. 打包布局与构建管道

- `build:desktop`＝typecheck:web → build:server(tsc) → build:web(vite) → build:desktop:main(tsc) → `desktop/scripts/package-desktop.mjs`（镜像 env 固化＋preflight 三产物齐备＋`electron-builder --config desktop/electron-builder.yml --win portable --publish never`）。
- asar 内：`desktop/dist/`＋`server/dist/`＋`web/dist/`＋`package.json`＋生产依赖闭包 node_modules（除 vue/pinia/klinecharts/lucide-vue-next）。
- asar 外（exe 旁/win-unpacked resources/）：Electron 运行时、elevate.exe。
- `dev:desktop`＝concurrently(dev:server tsx watch:8787 ＋ dev:web vite:5173 ＋ dev:desktop:window=electron DESKTOP_DEV_URL=http://127.0.0.1:5173)；页面 /api 经 vite 代理→8787（web/vite.config.ts 冻结口径）。窗口模式不内嵌服务，开发体验与现有 npm run dev 一致。

## 6. PACK-01 明确不做（YAGNI，登记给后续）

- 端口回退/冲突弹窗/复用已有服务（PORT-01/02 全语义）→PACK-02 完整生命周期。
- 优雅关闭（保存排空→SETUP-01 语义复用）、ready/状态文件与 zip 形态互认→PACK-02。
- electron-updater 在线更新通道→PACK-04（对齐 UPD 已交付语义）。
- NSIS 安装器（安装/卸载/快捷方式）→PACK-05。
- 依赖闭包精确裁剪、窗口最大化/记住尺寸/托盘、应用图标细节打磨→后续。
