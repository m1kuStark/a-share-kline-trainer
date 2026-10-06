# PACK-05 设计：发布流水线与打包冒烟门禁（PACK 收官）

任务卡：`docs/work-items/tasks/PACK-05.md`｜base 65540f4｜2026-10-06

## 一、现状事实（阶段①调研，读透再设计）

### 1.1 既有资产

| 资产 | 现状 | 本任务处置 |
|---|---|---|
| `desktop/electron-builder.yml` | win target=portable＋publish(github) 声明＋extraResources 映射 app-update.yml | **追加 nsis 目标与 nsis 配置块**（portable 保留） |
| `desktop/scripts/package-desktop.mjs` | 镜像 env＋预检＋`--win portable --publish never`＋构建后 app-update.yml fail-closed 核验 | **不动**（build:desktop 行为保持）；release-desktop.mjs 独立编排双目标 |
| `desktop/build-resources/app-update.yml` | extraResources 静态映射（PACK-04 回退方案，§1.3） | NSIS 安装形态复核（§1.3-2） |
| `desktop/scripts/smoke-desktop.mjs` | 阶段 A-H（便携全量） | **追加 `--target nsis` 模式＋`--nsis-child` 子模式**；portable 流程零改动 |
| `scripts/release/build.mjs`（zip 流水线） | SHA256SUMS 生成在 :602-605（zip 专属） | **禁改**（零破坏证明对象） |
| GitHub repo | m1kuStark/a-share-kline-trainer；Releases 上传由用户手动/授权 | 本任务只做本地流水线＋演练，**不发布任何 Release/资产** |

### 1.2 NSIS 安装器语义（node_modules/app-builder-lib v26.15.3 模板实证，2026-10-06）

1. **快捷方式在静默安装下仍创建**：`installSection.nsh` 中 `addStartMenuLink`/`addDesktopLink` **不在** `${IfNot} ${Silent}` 分支内——`/S` 静默安装同样在真实 shell 目录（`$DESKTOP`/`$SMPROGRAMS`，SHGetFolderPath 解析、**不受 env 重定向影响**）创建 `<shortcutName>.lnk`（shortcutName 默认=productName「K线训练器」）。`createDesktopShortcut:false` 为编译期开关（`DO_NOT_CREATE_DESKTOP_SHORTCUT`），是产品级取舍而非测试开关。
2. **卸载段无条件清理**（`uninstaller.nsh:193-254`）：删 `$oldDesktopLink`/`$oldStartMenuLink`＋菜单目录 RMDir＋`DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"`＋INSTALL_REGISTRY_KEY——静默卸载同样执行。⇒ 冒烟策略＝快照→安装→检测新增→卸载→断言全部消失（真实 shell 目录的**瞬态触碰＋自清理＋残留断言**，非用户数据，报告披露）。
3. **静默安装/卸载协议**：安装 `setup.exe /S [/D=<dir>]`（/D 必须末参、不带引号）；卸载 `Uninstall *.exe /S _?=<dir>`（`_?=` 阻止自拷贝副本、可等待退出，但卸载器自身残留→收尾清理）。
4. **卸载注册表键**：`UNINSTALL_APP_KEY = UUID.v5(appId)` → `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<uuid>`（per-user=SHELL_CONTEXT/HKCU）。键名由 appId 派生但冒烟不硬算 UUID：改为枚举卸载键集合快照→差集找新增键→断言其消失。
5. **安装版 exe 名**：`APP_EXECUTABLE_FILENAME` 默认=productName（K线训练器.exe）；冒烟以「扫描安装目录 *.exe、排除 `Uninstall *.exe`」定位，不依赖名字硬编码。

### 1.3 app-update.yml NSIS 形态复核（PACK-04 平台发现② 的收口）

1. portable 形态实证（PACK-04）：`--publish never` 下 electron-builder 不写包内 resources/app-update.yml，extraResources 静态映射是唯一来源。
2. **NSIS 安装形态**：安装器装载 win-unpacked 全部内容到 `<installDir>`，extraResources 的 app-update.yml 随之落在 `<installDir>\resources\app-update.yml`——与 electron-updater `ElectronAppAdapter.appUpdateConfigPath`（`process.resourcesPath/app-update.yml`）的读取位置一致。**NSIS 冒烟阶段 N 显式断言该文件存在**（内容含 provider/updaterCacheDirName）为实证收口；真机端到端（真实 GitHub feed）留验收。

### 1.4 latest.yml 产出条件（双路径兜底）

`UpdateInfoBuilder.writeUpdateInfoFiles` 在打包流程末尾写 latest.yml（非 publish 动作），但任务队列构造受 publish 配置与目标影响，`--publish never` 下是否落盘**以构建实证为准**。release-desktop.mjs 双路径：electron-builder 产出→**核验后采用**（版本=package.json、文件项=setup exe、sha512=实际字节）；未产出→**显式生成**（同 fixture 已证形状）。两路径都过同一核验函数（fail-closed）。

### 1.5 UPD-01 资产兼容约束（关键发现）

`server/src/update/manifest.ts:136`：zip 更新器按**精确名** `SHA256SUMS` 认校验和资产；`api.ts:86`：SHA256SUMS 未列出 zip 行即**拒绝应用**。⇒ 双形态发布（zip＋desktop 同 Release）时，desktop 校验和文件**绝不能叫 SHA256SUMS**——定名 **`SHA256SUMS-desktop.txt`**（lib 有断言锁死该约束）。desktop exe 资产名（kline-trainer-desktop-*.exe）不匹配 zip 资产正则（`^kline-trainer-v…-windows-x64\.zip$`），零冲突。

## 二、产物集（设计决策 1）

| 产物 | 命名 | 用途 |
|---|---|---|
| NSIS 安装器 | `kline-trainer-desktop-setup-v<ver>-windows-x64.exe`（＋可选 `.blockmap`） | 正式发布形态；electron-updater 下载安装的目标资产 |
| 便携 exe | `kline-trainer-desktop-v<ver>-windows-x64.exe`（现有命名保留） | 免安装形态 |
| latest.yml | `latest.yml` | electron-updater GitHub feed 元数据（**上传 Release 时必须同名**） |
| 校验和 | `SHA256SUMS-desktop.txt` | 覆盖 portable exe＋setup exe（＋blockmap）＋latest.yml |

NSIS 配置（proposed_default，收尾呈报）：

```yaml
nsis:
  oneClick: false                        # 传统向导式
  perMachine: false                      # 允许 per-user 安装（免管理员）
  allowToChangeInstallationDirectory: true
  artifactName: kline-trainer-desktop-setup-v${version}-windows-x64.exe
```

## 三、发布脚本（设计决策 2）

`npm run release:desktop` → `desktop/scripts/release-desktop.mjs`（编排）＋`desktop/scripts/release-desktop-lib.mjs`（纯函数，vitest 可测）：

```
镜像 env（ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR，同 package-desktop）
→ 预检（desktop/dist main.js+preload.cjs＋server/dist/index.js＋web/dist/index.html，缺即退 1）
→ electron-builder --config desktop/electron-builder.yml --win nsis portable --publish never
   （单次构建双目标；--publish never＝绝不触碰 GitHub）
→ fail-closed 核验链（任一失败即退非零）：
   ① win-unpacked/resources/app-update.yml 存在
   ② portable exe＋setup exe 按命名契约存在
   ③ latest.yml：缺失→生成；存在→核验（版本=package.json version、url=setup exe 名、sha512=实际字节、size=实际大小）
   ④ SHA256SUMS-desktop.txt 写入（hex sha256＋两个空格＋文件名＋换行，同 zip 流水线行格式；资产名≠SHA256SUMS）
→ 产物目录打印（名称＋字节数＋sha256 短前缀）
```

## 四、打包冒烟门禁（设计决策 3）

`smoke-desktop.mjs --target portable|nsis`（默认 portable，既有 A-H 流程零改动）。

**阶段 N（--nsis-child，独立 node 宿主——沿用阶段 F/H 宿主结论）**：

```
场景临时目录（mkdtemp）＋全套 profile 沙箱目录预建
→ fail-closed 前置断言：fakeHome/APPDATA/LOCALAPPDATA/TEMP 解析结果全部位于场景目录内（development-principles §五）
→ 快照：真实桌面「K线训练器.lnk」存在性＋开始菜单 lnk＋HKCU 卸载键集合
→ 安装：setup.exe /S /D=<场景>\installed → 等待退出 0
→ 断言：①安装目录找到应用 exe（排除 Uninstall*）②<installed>\resources\app-update.yml 存在（§1.3-2 实证）
       ③HKCU 新增恰一个卸载键（记录键名与 InstallLocation）
→ 启动安装版 exe（全套 profile 沙箱＋TRAINER_DATA_DIR/TRAINER_DB=场景 data＋动态端口＋TDX_ROOT 空＋OPEN_BROWSER=0）
→ 断言：health 200＋currentVersion＋首页 HTML＋窗口标题存在
→ CloseMainWindow → 优雅退出 exit 0 → 端口可重绑＋health 拒连
→ 卸载：Uninstall*.exe /S _?=<installed> → 等待退出
→ 无残留断言：应用 exe/resources 消失＋记录的卸载键消失＋新增快捷方式消失＋窗口标题计数 0
→ 收尾：清理卸载器残骸与场景目录
```

隔离铁律沿用：绝不触碰真实 `%USERPROFILE%` 数据（历史库/desktop-data-choice）；真实 shell 目录的快捷方式与 HKCU 卸载键为**瞬态系统触碰**，卸载器自清理＋残留断言兜底＋报告披露（§1.2-2 实证）；绝不触碰 GitHub。

## 五、矩阵行（desktop-app.yaml；PACK-05 占位行 DESKTOP-NSIS-INSTALLER 升实义为六行，派发简报授权）

| 行 ID | EARS 摘要 | 状态 | 绑定 |
|---|---|---|---|
| NSIS-ARTIFACT-PRODUCED | release:desktop 产出 NSIS 安装器（setup 命名契约＋向导式/per-user/可自选目录配置） | covered | lib 命名断言＋electron-builder.yml 源码契约测试；实际产出=命令收据 |
| LATEST-YML-PRODUCED | 产出 latest.yml 且版本/sha512/size 与实际 setup exe 一致（生成或核验 electron-builder 产出） | covered | renderLatestYml/parse/verify L2 |
| CHECKSUMS-PRODUCED | 产出 SHA256SUMS-desktop.txt（hex＋行格式），资产名不与 UPD-01 精确名冲突 | covered | renderSha256Sums＋异名断言 L2 |
| NSIS-SILENT-INSTALL-SMOKE | 静默安装→运行→退出→静默卸载无残留（含 app-update.yml NSIS 形态） | planned（实机编排收据，同 DESKTOP-PORTABLE-EXE-SMOKE 先例） | smoke 收据 |
| RELEASE-SCRIPT-GATE | 发布脚本核验链 fail-closed（缺产物/错版本/错校验和/命名违约即退非零） | covered | manifest/verify L2 |
| ZIP-LEGACY-INTACT | zip 流水线与 UPD 既有语义零改动（diff 收据） | planned（git 收据，同 DESKTOP-ZIP-ZERO-BREAK 先例） | git diff 收据 |

DESKTOP-AUTO-UPDATE 伞行 binding_note 补 NSIS 安装版证据指向（语义不变）。

## 六、TDD 计划（阶段③④，先红后绿）

| 层 | 文件 | 用例群 |
|---|---|---|
| 纯函数 | `desktop/test/release-desktop-lib.test.ts` | ①命名契约（1.2.7 冻结期望手写：setup/portable/blockmap/latest/校验和五名）②校验和行格式（64 hex＋两空格＋名＋换行；排序；多产物）③**资产名≠SHA256SUMS**（UPD-01 精确名兼容）④renderLatestYml 形状（version/path/sha512/files url+sha512+size；releaseDate 引号包裹）⑤parseLatestYml 回读＋拒未知形状 ⑥verifyLatestYml 对真实临时字节：版本错/sha512 错/size 错/缺文件项四拒 ⑦electron-builder.yml 源码契约（nsis 目标＋oneClick false＋perMachine false＋allowToChangeInstallationDirectory true＋setup artifactName 模式）⑧产物清单完整性（缺 portable/setup 任一即 throw） |
| 冒烟 | smoke-desktop.mjs 阶段 N | 实机编排（§四），fail-closed 断言齐全，无 vitest 形态 |

## 七、零破坏与边界

- 禁改：`scripts/release/**`、`launcher.cjs`、`server/src/**`、`web/src/**`；package.json 仅 scripts 增 `release:desktop`（依赖零变更）。
- zip 流水线零改动＝git diff 收据；UPD-01/02 语义靠 §1.5 异名约束保住（有测试锁定）。
- 不发布任何 GitHub Release/资产；push 仅源码。
- 阶段 N 的真实 shell 目录瞬态触碰（快捷方式＋HKCU 卸载键）在收尾报告置顶披露。

## 八、proposed_default 清单（收尾报告呈报）

1. NSIS one-click=false 向导式＋per-user＋允许自选安装目录（桌面/开始菜单快捷方式默认创建）。
2. zip 形态保留为兜底（双形态发布；SHA256SUMS 异名共存）。
3. latest.yml 由发布脚本保底生成/核验（electron-builder 产出优先）。
4. 发布步骤人工环节清单（见发布手册：latest.yml 必须同名上传等）。
