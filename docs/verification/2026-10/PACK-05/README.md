# PACK-05 验证记录：发布流水线与打包冒烟门禁（PACK 收官）

任务卡：`docs/work-items/tasks/PACK-05.md`（里程碑 PACK）｜base 65540f4｜2026-10-06｜设计：`design.md`

## 一、验证收据（机器结果）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| TDD RED（lib 决策层） | `npx vitest run --config desktop/vitest.config.ts desktop/test/release-desktop-lib.test.ts`（实现前） | 1 | 精确失败于缺模块 `../scripts/release-desktop-lib.mjs`（缺功能非语法/环境错） |
| desktop 定向（GREEN＋终态） | `npm run test:desktop` | 0 | **115/115**（新增 13＋既有 102） |
| 全量测试 | `npm test` | 见下 | 4 轮：1524/1524 全绿 1 轮；另 3 轮共 2 例并行负载 flaky 逐名（§二）；两例单跑均绿 |
| 构建 | `npm run build` | 0 | typecheck:web＋build:server＋build:web 全过 |
| 主进程编译 | `npm run build:desktop:main` | 0 | tsc 过 |
| 发布流水线 | `npm run release:desktop` | 0 | **全套产物**（§三）；electron-builder 原生产出 latest.yml 且字节级核验通过 |
| 打包冒烟（portable A-H） | `node desktop/scripts/smoke-desktop.mjs --exe desktop/release/kline-trainer-desktop-v1.2.7-windows-x64.exe` | 0 | **SMOKE_PASS total=119.3s**（终态；首次 117.6s 亦过）A-H 全断言绿 |
| 打包冒烟（NSIS 阶段 N） | `node desktop/scripts/smoke-desktop.mjs --target nsis --installer desktop/release/kline-trainer-desktop-setup-v1.2.7-windows-x64.exe` | 0 | **SMOKE_PASS total=37.9s**（§四；两轮失败迭代后修复，根因见 §五.4） |
| 绑定检查 desktop-app.yaml | `check-binding.mjs --matrix desktop-app.yaml --strict --include-untracked` | 3（设计内） | 32 行：covered=23／open=9／**RED=0**（open＝7 既有 planned 债务＋PACK-05 两行实机编排/仓库级收据行，设计内） |
| 绑定检查 updater.yaml | `check-binding.mjs --matrix updater.yaml --strict --include-untracked` | 0 | 22 行：covered=22／open=0／**RED=0**（既有 16＋desktop 6 行零降级） |
| 零破坏 | `git diff --stat -- scripts/release launcher.cjs server/src web/src` | — | **空**；package.json diff 仅＋`release:desktop` 一行（依赖零变更） |
| 变异 M1（executed） | collectChecksumEntries 必备清单漏 setup exe→定向跑 | 1 | 2 例死，主杀手＝`throws with the missing artifact names when the release set is incomplete (fail-closed)`（次杀＝collects 断言缺 setup 条目）；回退后 13/13 绿 |
| 变异 M2（executed） | renderSha256SumsFile 行分隔双空格→单空格→定向跑 | 1 | 精确 1 例死＝`renders the zip-pipeline line format: lowercase 64-hex + two spaces + name + newline, entries sorted by name`；回退后 13/13 绿 |
| 回退后回归 | `npm run test:desktop` | 0 | 115/115 |
| 真实系统残留复核 | PowerShell Test-Path/reg 计数 | — | 桌面 lnk=False／开始菜单 lnk=False／HKCU 卸载键=13（=冒烟前快照）／训练器进程=0（**含失败迭代轮在内全程零残留**） |

## 二、全量测试 4 轮逐名（存量 flaky 登记口径）

1. 轮 1：2 失败——`server/test/docs-tooling.test.ts > documentation CLI > includes staged changes even when the working tree restores the baseline content`（27.8s 超时类）＋`server/test/train-range-preview.test.ts > 并发创建与事务边界（GPT-WAKE-02 修复） > 旧tier并发创建同样仅一次成功`。
2. 轮 2：1524/1524 全绿。
3. 轮 3：1 失败（train-range 同上例）。
4. 轮 4：2 失败（同轮 1 两例）。
两例单跑均全绿（docs-tooling 30/30、train-range-preview 21/21）；train-range 为 PACK-02/03/04 已登记并行负载 flaky，docs-tooling 属同类（时序敏感、全量并行负载下偶发、单跑稳定、曾有全绿轮），按存量登记不改门禁。

## 三、发布产物清单（release:desktop 实收，desktop/release/）

| 产物 | 字节数 | sha256（前 12） |
|---|---|---|
| kline-trainer-desktop-setup-v1.2.7-windows-x64.exe（NSIS 安装器，one-click=false／per-user） | 117,272,803（111.8 MB） | 3f76575cf724… |
| kline-trainer-desktop-setup-v1.2.7-windows-x64.exe.blockmap | 122,120 | e049b4bb72e8… |
| kline-trainer-desktop-v1.2.7-windows-x64.exe（便携，命名沿用） | 117,064,932（111.6 MB） | 892f4831bb03… |
| latest.yml（electron-builder 原生产出；version 1.2.7＋setup url＋sha512/size 实字节核验通过） | 397 | aeca3a0f7bc7… |
| SHA256SUMS-desktop.txt（覆盖上列四件；行格式同 zip 流水线；异名避 UPD-01 精确名资产） | 431 | — |

**平台实证：`--publish never`＋publish 配置下，electron-builder 26.15.3 在输出目录原生产出 latest.yml**（与包内 resources/app-update.yml 不产出的行为不同——后者仍走 PACK-04 extraResources 回退且本轮构建后核验 embedded）；发布脚本双路径兜底（产出→核验采用／未产出→显式生成）中**核验路径本轮被真实走到**。

## 四、NSIS 冒烟阶段 N 断言（SMOKE_PASS 37.9s 收据）

| 断言 | 实测 |
|---|---|
| fail-closed 前置 | 全部 profile 重定向（fakeHome/APPDATA/LOCALAPPDATA/TEMP/dataDir）解析结果位于场景临时目录＋/D= 路径无空格（NSIS 未引号协议），违者即拒 |
| 静默安装 | `setup.exe /S /D=<scene>\installed` 退出 0 |
| 安装目录 | 应用 exe＝K线训练器.exe（唯一非 Uninstall*.exe）＋**resources/app-update.yml 存在**（PACK-04 extraResources 回退在 NSIS 安装形态成立的实证收口） |
| 瞬态真实系统触碰（自清理） | 桌面＋开始菜单各新建 K线训练器.lnk（快照→差集记录）；HKCU 卸载键 13→14（恰一新增，记录键名） |
| 安装版运行 | health 200＋currentVersion=1.2.7＋首页 HTML＋窗口标题 K线训练器 count=1 |
| 优雅退出 | CloseMainWindow（本体＋子进程双通道）→exit 0→端口可重绑＋health 拒连（无孤儿） |
| 静默卸载 | `Uninstall K线训练器.exe /S _?=<installDir>` 退出 0 |
| 无残留 | 应用文件全消（仅卸载器残骸=协议预期，场景内清理）＋HKCU 卸载键回落 13＋2 个快捷方式全消＋窗口计数回落快照值 |

## 五、本轮实证平台事实（阶段①调研＋实现期实测，验收/后续必读）

1. **NSIS 静默安装仍创建快捷方式**（app-builder-lib v26.15.3 `installSection.nsh`：addStartMenuLink/addDesktopLink 不在 `${IfNot} ${Silent}` 分支内）；`$DESKTOP`/`$SMPROGRAMS` 走 shell API，**env 重定向对安装器无效**——冒烟以快照→差集→卸载→断言消失消化该瞬态触碰。卸载段（uninstaller.nsh:193-254）无条件清理快捷方式与两个注册表键（静默同样执行）。
2. **静默协议**：安装 `/S [/D=<dir>]`（/D 末参、不带引号、路径无空格）；卸载 `/S _?=<dir>`（阻止自拷贝副本、可等待退出、卸载器自身残留需收尾清理）。InstallLocation 值写在 INSTALL_REGISTRY_KEY（非卸载键）下——冒烟对该值降级为记录不断言。
3. **latest.yml 产出条件**：publish 配置就位时 `--publish never` 下 electron-builder 仍在输出目录产出 latest.yml（UpdateInfoBuilder 打包路径）；包内 resources/app-update.yml 仍不产出（PACK-04 结论维持，extraResources 回退为唯一来源并经 NSIS 形态复核）。
4. **node spawn `windowsHide:true` 的 STARTUPINFO SW_HIDE 会被直启的 Electron 首窗口继承**：窗口不呈现（`win.show()` 也不显示）但渲染进程正常运行、页面心跳可达——诊断实证（进程树全活＋`POST /api/lifecycle/heartbeat`＋窗口计数 0；改 `windowsHide:false` 后窗口即现 count=1）。便携形态不受影响（窗口属于解压启动器二跳 spawn 的子进程，不携带该旗标——同参数阶段 A 可显示为旁证）。冒烟 nsis-child 安装版 spawn 已固定 `windowsHide:false`＋注释留档。**该坑对任何「直启 Electron exe」的编排（CI/诊断脚本）通用。**
5. **安装版窗口属于 spawn 进程本体**（便携版属于其子进程）——优雅关闭需双通道（本体 CloseMainWindow＋子进程枚举）。

## 六、改动清单（相对 base 65540f4）

**desktop/**（新增 3＋修改 2）：
- `scripts/release-desktop-lib.mjs`（新）：发布纯函数层——desktopArtifactNames 命名契约（三段号 fail-closed）／assertChecksumsAssetName 异名门（UPD-01 精确名资产兼容）／renderSha256SumsFile 行格式（同 zip 流水线 `<64hex>  <name>\n`、排序）／renderLatestYml＋parseLatestYml（最小 fail-closed 解析器）／verifyLatestYml（版本/文件项/sha512/size 四拒）／collectChecksumEntries（必备完整性＋注入 fs）。
- `scripts/release-desktop.mjs`（新）：发布编排——镜像 env→预检→electron-builder `--win nsis portable --publish never`（单次双目标）→fail-closed 核验链（app-update.yml 入包/双 exe/latest.yml 双路径同一核验/校验和）→产物目录打印。
- `scripts/smoke-desktop.mjs`：`--target portable|nsis`＋`--installer`＋`--nsis-child` 子模式（阶段 N 全流程，§四）；新增 closeMainWindowOf（本体窗口）；portable A-H 流程零改动。
- `electron-builder.yml`：win target 追加 nsis；新增 nsis 块（oneClick:false／perMachine:false／allowToChangeInstallationDirectory:true／setup artifactName）。
- `test/release-desktop-lib.test.ts`（新，13 例，§一 TDD）。

**package.json**：scripts＋`release:desktop` 一行（依赖零变更）。

**docs/**：`verification/2026-10/PACK-05/`（design＋本 README）；`docs/release/desktop-release-manual.md`（维护者发布手册，新）；`docs/release/desktop-upgrade-guide.md`（用户升级指引，新）；任务卡 PACK-05。

**skill 侧**：desktop-app.yaml PACK-05 占位行升实义六行（派发简报授权；NSIS-SILENT-INSTALL-SMOKE/ZIP-LEGACY-INTACT 保持 planned＝实机编排/仓库级收据行，同 DESKTOP-PORTABLE-EXE-SMOKE/DESKTOP-ZIP-ZERO-BREAK 先例）＋DESKTOP-AUTO-UPDATE 伞行 note 补 NSIS 证据指向＋模块 note 更新；镜像同步 diff 空为证。

**禁改区零改动**：scripts/release/**、launcher.cjs、server/src/**、web/src/**（git diff 空）。

## 七、行为矩阵状态

- **desktop-app.yaml 32 行：covered=23／open=9／RED=0**（strict --include-untracked exit 3＝设计内债务：7 既有 planned（PACK-01 手册/粘合/冒烟收据行、PACK-03 saved-choice 粘合、PACK-04 伞行）＋PACK-05 两行收据行）。本轮新增：NSIS-ARTIFACT-PRODUCED／LATEST-YML-PRODUCED／CHECKSUMS-PRODUCED／RELEASE-SCRIPT-GATE 四行 covered（13 例新测试 L2 绑定，变异 M1/M2 executed 击杀）；NSIS-SILENT-INSTALL-SMOKE／ZIP-LEGACY-INTACT planned（收据形态）。
- **updater.yaml 22 行：covered=22／open=0／RED=0**（strict exit 0；零降级）。

## 八、遗留与移交

1. **真实更新端到端（真机验收）**：NSIS 安装版→检查更新→下载→排空→quitAndInstall→新版自启→历史数据仍在——通道/编排/资产全就绪，待用户上传首个双形态 Release 后真机走通（UPD-DESKTOP-INSTALL-DRAINS-FIRST 行的最后一环）。
2. GitHub Release 上传＝人工环节（发布手册步骤化）；latest.yml 必须按原名上传。
3. NSIS 向导/许可页面文案与快捷方式行为＝呈现类 proposed_default（§九），待用户安装验收。
4. e2e/浏览器级渲染端 desktop 分支呈现仍留真机验收（PACK-04 遗留同款）。

## 九、proposed_default 清单（待用户拍板）

1. NSIS one-click=false 传统向导式＋per-user 安装（免管理员，默认装 `%LOCALAPPDATA%\Programs\K线训练器`）＋允许自选安装目录＋桌面/开始菜单快捷方式默认创建。
2. zip 形态保留为兜底（双形态同 Release 共存；desktop 校验和资产异名 SHA256SUMS-desktop.txt 不与 zip 的 SHA256SUMS 冲突）。
3. latest.yml 由 electron-builder 原生产出（本轮实证）＋发布脚本核验；未产出时按同形状显式生成（双路径兜底）。
4. 发布人工环节清单见 `docs/release/desktop-release-manual.md`（含 latest.yml 同名上传、双校验和资产并存、zip 兜底策略）。
