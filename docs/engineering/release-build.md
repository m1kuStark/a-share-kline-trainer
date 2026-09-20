# 发布打包脚本 release/build.mjs

从干净提交构建Windows x64便携包。范围见[发布合同](release-m3-contract.md)；公开源码、GitHub发布及实际安装验收由集成人负责。

## 命令

```
node --import tsx scripts/release/build.mjs --node-archive PATH --node-checksums PATH --out DIR
```

也可用 `npm run release:windows`，`--help` 查看参数。

前置条件（由集成人准备）：

- 官方 `node-v24.x.y-win-x64.zip` 与对应 `SHASUMS256.txt` 已本地下载；文件名必须匹配 Node 24 win-x64，其他主版本或平台直接拒绝。
- 仓库根 `npm ci` 已安装依赖（构建用 `node_modules/typescript`、`node_modules/vite`、npm CLI）。
- 工作树干净且 HEAD 为有效 git 提交；REL-LAUNCH 启动文件（含 `Stop.cmd`）、`assets/trainer.ico`、`docs/user/`、`THIRD-PARTY-NOTICES.md`、`CONTRIBUTING.md`、`SECURITY.md`、`third-party/`（完整第三方通告与清单）等输入齐备。缺项一次性列出并中止。

## 执行顺序与验证链

1. 解析参数；拒绝重复、未知形态与缺值。
2. `git status --porcelain` 必须为空、`git rev-parse HEAD` 必须是 40–64 位十六进制，否则拒绝（构建结束前会按同一标准复验，见第 11 步）。
3. 从压缩包**文件名**解析版本并校验 Node 24 win-x64。
4. 按**精确文件名**在 SHASUMS256.txt 中查 SHA256 并对压缩包流式计算比对；任何不匹配在此中止，**尚未发生任何解压**。
5. 输出查重与独占预留：`kline-trainer-v<version>-windows-x64.zip` 或 `SHA256SUMS` 已存在则拒绝；随后以 `'wx'` 独占创建 `--out` 下的 `.<artifact>.build.lock` 预留本 artifact 名——已被人持有时立即失败（**不等待、不抢占、不改写他人锁**），锁内容记录属主便于诊断，构建结束 `finally` 只释放自己那把（内容被改写则原样保留）。
6. 经 `createRun`（`scripts/runtime/run.ts`，经 tsx 导入）建立独立 `.runs/run-<uuid>` 构建运行，`buildRun(run, 'production')` 编译 server/web 到运行目录——工作树的 `web/dist`、`server/dist` 与任何用户数据库不被触碰。
7. 生产 `node_modules` 在 `prod-deps/` 隔离安装：复制 package.json + package-lock.json 后 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`；不复制工作树 `node_modules`。
8. `Expand-Archive`（结构化 argv 调用临时 ps1，无 shell 拼接）解压已校验的官方包；只取 `node.exe` 与 `LICENSE` 两项。防穿越只覆盖这两个由脚本自建、写死的路径字符串（`safeArchiveEntryName`）——**它不是逐条 ZIP 条目的解析器，不做 ZipSlip 校验**；实际的信任边界是第 4 步"解压前先对官方压缩包整体验 SHA256"。
9. 组装 staging 并对 `web/dist` 全量扫描 `__trainerChart` 等 journey 标记；命中即中止（production 模式 vite 构建应已剥离）。
10. 文档链接门禁：对包内文档面（`README.md`、`CONTRIBUTING.md`、`SECURITY.md`、`THIRD-PARTY-NOTICES.md`、`docs/user/**/*.md`）逐个解析相对链接，目标必须存在于包内且解析结果不逃出包根——`docs/user` 保持原层级、根级 CONTRIBUTING/SECURITY 与完整 `third-party/**` 缺一即在此失败并列出断链。
11. 来源复验：压缩与发布前重新执行 `git status --porcelain` 与 `git rev-parse HEAD`，要求与起始相同的 HEAD 且工作树仍干净，否则拒绝发布（防止长构建期间 checkout/reset/编辑混入两个来源）。
12. 对最终 ZIP 载荷逐文件过白名单分类器，生成 `release-manifest.json`（逐文件 SHA256 + 元数据），再 `Compress-Archive` 压缩、计算 ZIP SHA256。压缩/解压 ps1 一律 `-LiteralPath`（路径中的通配符按字面处理）且 `$ErrorActionPreference='Stop'`（cmdlet 失败即终止，杜绝静默 exit 0）。
13. 独占无覆盖发布：ZIP 与 SHA256SUMS 先写入同目录唯一命名的 `.partial` 文件，再以硬链接独占创建最终名（已存在即 `EEXIST` 拒绝）。绝不替换或删除既有发布物，绝不递归清理 `--out`；失败或拒登时本 run 的 `.partial` 原样留存作为证据。

失败时保留 `.runs/run-<uuid>` 证据并在错误信息中给出路径；脚本自身不清理任何目录。

## 包结构（ZIP 根目录 `kline-trainer-v<version>-windows-x64/`）

| 路径 | 来源 |
|---|---|
| `runtime/node.exe`、`runtime/LICENSE` | 已校验官方压缩包（仅此两项） |
| `server/dist/**/*.js` | 隔离 tsc 产物；不含 .d.ts/.map |
| `web/dist/**` | 隔离 vite production 产物 |
| `node_modules/**` | 隔离 `npm ci` 生产依赖，含第三方 LICENSE |
| `package.json` | 裁剪版：保留 name/version/type/engines/dependencies/license，去掉 scripts 与 devDependencies |
| `release.json` | `{appId:'a-share-kline-trainer', version, gitCommit, nodeVersion, platform:'win32', arch:'x64', publicURL}` |
| `launcher.cjs`、`Start.cmd`、`Stop.cmd`、`Create Shortcut.cmd`、`create-shortcut.ps1`、`trainer.config.example.json` | scripts/release/（REL-LAUNCH） |
| `assets/trainer.ico` | root |
| `LICENSE`、`THIRD-PARTY-NOTICES.md`、`README.md` | 仓库根（第三方全文由 root 核对，缺失即中止） |
| `CONTRIBUTING.md`、`SECURITY.md` | 仓库根（README 在包根链接两者，缺失即中止） |
| `docs/user/**` | docs/user/**，**保持原层级**——README 链接 `docs/user/...`，install.md 链接 `../../CONTRIBUTING.md`；拍平成 `docs/` 会断链，链接门禁（第 10 步）会拒绝 |
| `third-party/**` | 仓库根 `third-party/` 完整第三方通告与清单（THIRD-PARTY-NOTICES.md 链接该目录） |
| `release-manifest.json` | 构建生成（不列入自身 files） |

排除（白名单之外一律不进包）：真实 `trainer.config.json`、用户数据、`.git`/`.env`/`.runs`、GLM 工具、TDX、samples、screenshots、测试与源码树。分类器（`classifyStagedPath`）对 `.git`/`.env*`/`.runs`/`trainer.sqlite*`/`trainer.config.json` 无论出现在哪个层级都直接抛错。

## 产物

- `--out` 下：`kline-trainer-v<version>-windows-x64.zip` 与 `SHA256SUMS`（单行 `<zip sha256>  <zip 名>`），外加构建期间的 `.<artifact>.build.lock`（正常结束后释放）。两者均以独占硬链接发布：同名并行构建只有一方成功，既有发布物永不被覆盖或删除；失败残留唯一命名的 `.partial` 可直接定位归属。
- 包内 `release-manifest.json`：`schemaVersion`、appId、version、gitCommit、nodeVersion、platform/arch、createdAt 与逐文件 `{path, sha256, bytes}`，可用于解包后完整性审计。
- 每次构建在 `.runs/run-<uuid>` 留存运行证据（构建日志、staging、node-archive）；验证通过后可手工删除。`.runs/` 已被 gitignore，不污染工作树。

## 单元测试

`server/test/release-package.test.ts`（23 项）覆盖纯函数失败条件与副作用：包名/主版本白名单、参数校验、SHASUMS 精确文件名与篡改拒绝（校验先于解压）、脏树与非法 sha 拒绝、既有输出不破坏、压缩包条目两固定路径校验、staging 白名单/排除/私路径抛错、journey 标记检测；以及本轮回归——合成树上 required inputs 全量清单（含 Stop.cmd/third-party）、docs/user 层级保持与许可证面完整、包内相对链接解析/断链/逃出包根、独占锁预留与外部锁不抢占、并行发布单赢家且哨兵内容保留、结束前 HEAD+干净复验、PowerShell `-LiteralPath` 通配路径往返与失败即终止。完整打包（真实压缩包 + npm ci + Compress-Archive + 启动器联测）由集成人在合并后做 clean-room 验收，不属于本单测范围。

## v0.3.1 验收补充

并发Start/Stop的状态读取、清理和复用都在同一生命周期锁内；不得将正常停止过程误判为无法识别的活进程。Linux配置夹具使用本机绝对路径。补丁保留v0.3.0标签与产物，新ZIP从公开补丁提交构建，并重跑双平台CI及完整候选门禁。
