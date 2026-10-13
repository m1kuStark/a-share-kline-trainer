# INSTALLER-UPGRADE-01 验证记录：NSIS 安装包升级检测与数据继承

- 任务卡：`docs/work-items/tasks/INSTALLER-UPGRADE-01.md`（状态 queued→本轮完成确定性部分）
- worktree：`D:\tmp\instupg01`（分支 installer-upgrade，base=cf87c40）
- 矩阵行：`INSTALLER-UPGRADE-DETECT`（desktop-app.yaml，**planned，禁写该文件——本记录不编辑矩阵，绑定测试 ID 由收尾报告回传 orchestrator**）
- 日期：2026-10-13

---

## §1 阶段①侦察报告

### 1.1 NSIS 现状（desktop/electron-builder.yml，electron-builder v26.15.3）

| 配置 | 值 | 与升级的关系 |
|---|---|---|
| oneClick | false | assisted 向导式（有安装模式页/目录页——升级信息的呈现面） |
| perMachine | false | 默认 per-user（HKCU），安装模式页可选 all users（HKLM） |
| allowToChangeInstallationDirectory | true | 目录页可改；**默认值＝旧安装位置**（见 1.2-①） |
| installerLanguages | [zh_CN] | 升级文案为简中 |
| deleteAppDataOnUninstall | 未配置 | 卸载不删数据（升级链另有 --updated 双保险，见 1.2-④） |

### 1.2 electron-builder 对重复安装的默认行为（node_modules/app-builder-lib 模板源码实证）

v26.15.3 的 NSIS 模板（`D:\tmp\instupg01\node_modules\app-builder-lib\templates\nsis\`）逐文件读出以下机制——**零配置即满足矩阵行 SHALL 的主体**：

1. **检测已装位置并同位置安装**（installer.nsi `.onInit` → assistedInstaller.nsh `initMultiUser`，行 107-152）：
   读 `HKLM/HKCU\Software\{APP_GUID}` 的 `InstallLocation`（注释原文「checks registry for previous installation path (both for upgrading, reinstall, or uninstall)」）→ 按已有安装形态继承安装模式 → multiUser.nsh `setInstallModePerUser/PerAllUsers`（行 26-28/75-77）**把 $INSTDIR 预填为旧安装位置**——目录页默认值即旧位置，安装到同一路径。
2. **向导呈现升级信息**（multiUserUi.nsh `InstModeChange`，行 200-219）：检测到已有安装时安装模式页动态文案 `$(perUserInstallExists)($perUserInstallationFolder)$\r$\n$(reinstallUpgrade)`，zh_CN 词条＝「已经存在一个安装到当前用户的安装.(位置)／即将重新安装/升级.」。**位置已呈现；版本号未呈现**（模板不读 DisplayVersion）——这是唯一确定性缺口。
3. **升级路径执行**（installSection.nsh 行 52-58 → installUtil.nsh `uninstallOldVersion` 行 142-243）：读卸载键 `UninstallString`＋`InstallLocation`，把旧卸载器拷到 `$PLUGINSDIR` 后 `ExecWait '"...old-uninstaller.exe" /S /KEEP_APP_DATA --updated _?=$installationDir'` 静默卸旧 → 新文件装入同一 $INSTDIR → `registryAddInstallInfo` 刷新注册表（DisplayVersion 更新为新版本）。
4. **数据继承内建**：installUtil.nsh 行 202-207——非 isDeleteAppData 时**总是传 --updated**，注释原文「always pass --updated flag - to ensure that if DELETE_APP_DATA_ON_UNINSTALL is defined, user data will be not removed」；本产品未配置 deleteAppDataOnUninstall，且数据目录根本不在安装目录（见 1.3）。
5. **isUpdated 的真实语义**（nsisScriptGenerator.js `flags()` 行 29-38）：`${isUpdated}` 是编译期生成的**运行时命令行旗标检测宏**（`StdUtils.TestParameter "updated"`）——仅 electron-updater 自动更新链启动安装器时带 `--updated`。**用户手动双击 GitHub 下载的安装包不带该旗标**→走完整向导（skipPageIfUpdated 不触发，许可/目录页正常显示），但上述 1-4 机制全部照常执行。
6. **customInit 钩子**（installer.nsi 行 79-81）：`.onInit` 内 `initMultiUser` 之后插入；此时安装模式继承与位置记忆已完成。自定义 `buildResources/installer.nsh` 由 NsisTarget `computeCommonInstallerScriptHeader`（NsisTarget.js 行 600-605：`packager.getResource(options.include, "installer.nsh")`）**默认捡拾，无需在 yml 配 include**；内容拼在主脚本最前（只定义宏），宏体在展开点求值（`${UNINSTALL_REGISTRY_KEY}` 等 define 展开时已生效）。
7. **注册表键名**（本产品）：appId `io.github.m1kustark.a-share-kline-trainer`，package.json 无显式 guid → `APP_GUID = 01d71247-e302-5487-bcb6-a485f2fe0f31`（UUIDv5 派生，node:crypto 独立复算）。`INSTALL_REGISTRY_KEY=Software\{GUID}`（HKCU per-user / HKLM per-machine），`UNINSTALL_REGISTRY_KEY=Software\Microsoft\Windows\CurrentVersion\Uninstall\{GUID}`（DisplayVersion 在此）。

### 1.3 本机实证侦察（只读；ps1 载荷文件，观测面活性计数先行）

- **派发简报前提被证伪**（按 supervised-delivery「简报前提亦是待验证假设」如实报告）：简报称「本机已装 v1.3.3（NSIS per-machine）」，实测——三大卸载根（HKLM×2＋HKCU，合计 **404 条**卸载条目，计数证明观测面活着）无一条 DisplayName 匹配 KLine/trainer/训练器；`%LOCALAPPDATA%\Programs`、`Program Files`、`Program Files (x86)` 三个安装根均无训练器目录；开始菜单＋桌面 .lnk 全量扫描（4 目录，SHORTCUT-HITS=0）。**本机当前不存在已安装的训练器**。v1.3.3 setup exe 仅存在于验收物料目录 `D:\KLineTrainer-acceptance\`（另有 `D:\KLineTrainer-backup-20261013\` 数据备份目录，均非安装位置）。
- **数据目录独立存活的直接实证**：`%USERPROFILE%\.a-share-kline-trainer` 存在且完整（trainer.sqlite 1.4MB、history-versions/、saved-tdx-choice.json、window-state.json、迁移备份 .bak）——应用曾安装又卸载，数据目录毫发无损。**「数据不在安装目录＝卸载/升级天然继承」不是推断，是本机已发生过的事实**。
- 数据目录唯一默认由 `desktop/src/data-home.ts`（LEGACY_HOME_DIR_NAME）＋矩阵行 INSTALL-NSIS-ASSISTED（covered）锁定，测试 `desktop/test/data-home.test.ts`。

### 1.4 缺口分析：解读 A/B 论证

用户原话「触发本体的 update 功能」两种解读：

- **解读 A（NSIS 原地升级即满足）——侦察结论支撑 A**：
  1. 用户场景是「从 GitHub 下载了新安装包并运行」——此刻 NSIS 安装器**本身就是**更新动作（检测→同位置→静默卸旧装新→数据完整继承，见 1.2）。「update 功能」＝这次原地升级，语义自洽。
  2. electron-updater 的差分下载（blockmap）只服务于**应用内**自动更新链；对手动下载场景再引导应用内差分下载等于把已下载的 ~117MB 安装包扔掉再下一遍，纯负收益。
  3. 应用内更新已是完整并列能力（矩阵 updater.yaml 19+ 行 covered：boot 自动检查 UPD-NOTIFY-01、下载安装管线 UPD-UI-APPLY-FLOW；PACK-05 已随 Release 发布 latest.yml＋blockmap）。安装包检测到旧版后再去「触发」应用内更新属重复建设且流程别扭（装完新版→新版再检查→发现无更新，因为已经是最新）。
  4. electron-builder 官方语义即如此：重复运行安装器＝reinstall/upgrade（multiUserUi 文案原文），无「引导走应用内更新」的机制位。
- **解读 B（安装包引导走应用内更新流程）**：唯一未被 A 覆盖的变体是「安装包检测到旧版后不安装、只提示用户去应用内更新」——这会让用户下载的安装包变成废动作，与用户「完成版本更新」的意图相悖。
- **裁定：属 needs_user_decision，呈报不实现**。本轮按 A 的保守语义实现确定性部分（检测＋呈现＋同位置＋数据继承），B 形态若用户拍板需要则后续加行。

### 1.5 确定性缺口清单（SHALL 逐项对照）

| SHALL 子句 | 默认现状 | 本轮处置 |
|---|---|---|
| 检测本地已安装的**版本** | 检测能力有（卸载键可读）但不呈现 | **补**：installer.nsh customInit 读 DisplayVersion 并呈现（唯一确定性缺口） |
| 检测本地已安装的**位置** | 默认满足（initMultiUser＋安装模式页呈现） | 锁定（零写断言防越位破坏） |
| 默认按升级路径执行（同位置安装） | 默认满足（$INSTDIR 预填旧位置＋uninstallOldVersion） | 锁定（yml 前提由存量 NSIS-ARTIFACT-PRODUCED 测试锁；include 防呆新增） |
| 数据目录完整继承 | 结构性满足（数据不在安装目录＋KEEP_APPData＋--updated 双保险） | 锁定（零写断言＋deleteAppDataOnUninstall 防呆＋data-home.test.ts 存量锁定） |
| 触发本体 update 流程 | needs_user_decision（解读 A/B，见 1.4） | **不实现，呈报** |

## §2 阶段②实现（TDD 收据）

### 2.1 测试形态选型（纪律要求显式说明）

installer.nsh 是 NSIS 语法，无法在 vitest 中直接执行。选型＝**源形状契约测试**（读文件断言关键指令＋防破坏约束），仓库先例：`desktop/test/release-desktop-lib.test.ts` 的 NSIS-ARTIFACT-PRODUCED describe（读 electron-builder.yml 断言配置）与 `desktop/test/portable-updater-release.test.ts` 的 INSTALL-01 源码契约（读 release-desktop.mjs 断言构建参数）。行为级验证（真机重复安装升级）按任务纪律 6 留集成阶段。

### 2.2 RED → GREEN

- 新增测试：`desktop/test/installer-upgrade.test.ts`（6 用例；oracle＝用户原话＋electron-builder v26.15.3 模板冻结契约＋UUIDv5 独立复算的 APP_GUID，不从实现反推）
- RED：`npx vitest run --config desktop/vitest.config.ts desktop/test/installer-upgrade.test.ts` → **5 failed（全部 ENOENT：installer.nsh 不存在——缺产物的正确失败原因）＋1 passed（yml 防呆锁定既有行为）**
- 实现：新建 `desktop/build-resources/installer.nsh`（customInit 宏：HKCU→HKLM 读 DisplayVersion＋InstallLocation，检测到已装版本时 MessageBox 呈现「vX.Y.Z＋位置＋同位置升级＋数据完整保留」；全新安装不弹；零写指令）
- GREEN：同命令 → **6 passed**（vitest 真实退出码经输出重定向收取＝0）

### 2.3 NSIS 语法可信度说明（人工判断项）

宏体指令全部为 electron-builder 模板同款语法（ReadRegStr/${If}/${EndIf}/MessageBox/StrCpy 在 assistedInstaller.nsh、multiUser.nsh、multiUserUi.nsh 中逐字同构）；`${UNINSTALL_REGISTRY_KEY}/${INSTALL_REGISTRY_KEY}/${PRODUCT_NAME}` define 在展开点已生效（NsisTarget.js 行 661：customInclude 拼在主脚本前只定义宏，宏在 installer.nsi .onInit 展开点求值）。makensis 真实编译（-WX 严格模式）按纪律 6 留集成阶段打包核验链（release-desktop.mjs 不动，其输入新增 build-resources/installer.nsh 由 electron-builder 默认捡拾，fail-closed 核验链各门与该文件无冲突——app-update.yml/latest.yml/陈旧便携产物门均不受影响）。

## §3 门禁结果

| 门禁 | 命令 | 退出码 | 结论 |
|---|---|---|---|
| 新测试 GREEN | `npx vitest run --config desktop/vitest.config.ts desktop/test/installer-upgrade.test.ts`（cwd=D:\tmp\instupg01） | 0 | 6/6 |
| desktop 全量 | `npm run test:desktop`（cwd=D:\tmp\instupg01） | 0 | 27 文件 264 用例全绿，存量 covered 行未破坏 |
| check-binding 基线（改动前） | `node .../check-binding.mjs --repo D:/tmp/instupg01 --matrix .../desktop-app.yaml --strict --include-untracked` | 3 | 存量 10 planned open（含本行），covered=24——**与改动后对照不得恶化**（见收尾报告改后复跑值） |
| 变异推演（P4） | 纸面（§2.2 杀手映射＋收尾报告） | — | 8 个变异全部有杀手用例 |

## §4 遗留与待拍板

1. **needs_user_decision：「触发本体的 update 功能」的具体形态**（解读 A=NSIS 原地升级即满足／B=引导应用内更新）——侦察结论支撑 A（§1.4），呈报待拍板。拍板 A 则本行可升 covered（四个确定性子语义已有绑定测试）；拍板 B 需新矩阵行＋新实现。
2. **proposed_default（呈现类，提验）**：升级信息以 customInit 阶段 MessageBox MB_OK 弹窗呈现（页面显示前、需点确认）。理由：安装模式页文案由 electron-builder 模板生成不可注入（覆盖 multiUserUi 宏侵入性大）；customInit 处 ShowInstDetails=nevershow 使 DetailPrint 不可见。文案「检测到已安装 K线训练器 v$R8（安装位置：$R9）。本次安装将按升级路径执行：安装到同一位置，用户数据目录完整保留，无需迁移。」——真机验收时可按用户反馈调整。
3. 集成阶段待办：真机重复安装验收（v1.3.3 已装机器上运行 v1.3.4 安装包：验证弹窗内容、同位置、数据目录无变化、卸载键 DisplayVersion 更新）；makensis 真实编译过 -WX。
4. 简报前提勘误归档：本机无已安装训练器（§1.3）——后续波次简报不应再引用「本机已装 v1.3.3」。
