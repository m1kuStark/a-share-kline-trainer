# PORT-UPD-01 验证记录：便携版自研 exe 替换式自更新

- 任务卡：`docs/work-items/tasks/PORT-UPD-01.md`（milestone=PACK）
- 分支：`portable-selfupdate`（worktree `D:\tmp\pu`，base=main@263d224）
- oracle：用户拍板方案 A（2026-10-11）＋PORT-UPD-01 派发简报实现规格 1–7

## 1. 设计要点（与简报规格的对应）

| 规格条 | 实现 | 落点 |
|---|---|---|
| 1 便携识别 | `isPortableExecution`（PORTABLE_EXECUTABLE_DIR 非空白）×`app.isPackaged`（main 组合门）；dev/NSIS 零改动走 electron-updater | portable-updater.ts / main.ts setupUpdateChannel |
| 2 检查 | 拉 feed 的 latest.yml（env TRAINER_DESKTOP_UPDATE_FEED > GitHub Releases latest download 常量，复用 UPD-DESKTOP-FEED-INJECTABLE 口径）；版本比较 compareVersions 单一口径（controller mapCheckView 复核，adapter 不另立口径） | parsePortableLatestYml / buildPortableFeedUrls |
| 3 下载校验 | `<dataDir>/update-staging/kline-trainer-desktop-v<版本>-windows-x64.exe`；sha512(base64)+size 对 latest.yml 便携条目；fail-closed：不符即删 staging 文件拒绝应用；下载前清空旧 staging | createPortableUpdaterAdapter.downloadUpdate |
| 4 应用 | 复用既有排空退出管线（requestInstallWithDrain→exit 分支 quitAndInstall）；应用前复验 staging 字节；渲染 cmd 替换脚本（ASCII+CRLF+goto 分支＋路径烘焙不经 argv）写 staging→detached spawn→app.exit；脚本等待旧 pid（tasklist /NH 过滤＋findstr /C: 字面匹配）→旧 exe 改 .old→staging 移入→移入失败回滚 .old→删 .old（不阻塞）→start 新 exe | renderReplaceScript / quitAndInstall / 真实 spawn 冒烟 |
| 5 数据保留 | staging 落数据目录（与 exe 分离）；替换只动 exe 与 .old；启动清理 staging＋.old 残留（非便携 no-op） | cleanupPortableUpdateLeftovers / main.ts bootServerAndOpen |
| 6 失败路径 | 下载中断/校验失败→staging 文件删除＋人话错误；替换失败→旧 exe 可用（脚本退出码 2/3/4＋日志留 staging replace.log）；staging 下次下载前/下次启动清空 | 同上＋冒烟回滚/超时用例 |
| 7 UI 零新交互 | 适配器实现 DesktopUpdaterAdapter 同一面；channel() 仍报 packaged；设置页「检查更新→下载→安装」原样驱动 | main.ts 绑定段（update-ipc/controller 未动） |

发布侧（P3＋自更新前提）：`release-desktop.mjs` 给 latest.yml 追加便携 exe 条目（`extendLatestYmlWithPortable`，幂等；setup/path 原样保留，NSIS 通道零影响——条目形状与 blockmap 附加条目同构）；新增 `migrate-v127.zip`（`collectMigrateZipEntries`＋`buildStoredZip`：纯 Node STORE 型 zip，零新依赖，确定性输出；正确性由 server UPD-01 zip 读取器强制 CRC 独立校验）并纳入 SHA256SUMS-desktop.txt。

## 2. RED→GREEN 证据

- RED（2026-10-11，run 见 §3 表 R0）：三测试文件 `Cannot find module '../src/portable-updater.js'`（3 files failed，exit 1）——产品码未写先有失败测试。
- GREEN 过程中实测修正三处（记录为平台事实，非测试妥协）：
  1. `find` 在 Git Bash PATH 环境解析为 GNU find（`find: '56616': No such file or directory`），且 tasklist 无匹配 rc 亦为 0——脚本探活改 `findstr /C:`（System32 独有），单元断言同步收紧；
  2. vitest(esbuild) 无法 import 带 shebang 的 .mjs（Invalid token）——release-desktop.mjs 移除 shebang（仅经 `node` 调用，非直接执行）；
  3. quitAndInstall 为 fire-and-forget（真实调用方 main 不 await）——测试以轮询收敛而非改产品码同步化。
- GREEN：32/32 passed（exit 0，见 R1）；desktop 全量 147/147（R2）。
- 语义锁定抽检（P4 变异纸面推演，杀手测试逐名）：
  - M1 删 sha 不符分支的 `rm(target)` 只 throw →「sha512 不符 → 删除 staging 产物并拒绝」死于 staging 目录断言（文件残留）；
  - M2 删脚本 `:place_failed` 的回滚 `move /y "%OLD_EXE%" "%EXE%"` → 冒烟「替换失败回滚」死于 exe 字节断言（旧 exe 停在 .old），渲染模板单测同死于 rollback indexOf 断言；
  - M3 删 main.ts 便携分支（恒走 electron-updater）→「主进程粘合源码契约」死于 `updateChannelKind === 'packaged' && isPortableExecution` 正则。

## 3. 机器收据（命令＋退出码）

| # | 命令 | 退出码 |
|---|---|---|
| R0 | `npx vitest run --config desktop/vitest.config.ts desktop/test/portable-updater*.test.ts`（实现前，RED） | 1 |
| R1 | 同上（实现后，3 files/32 tests passed） | 0 |
| R2 | `npm run test:desktop`（15 files/147 tests passed） | 0 |
| R3 | `npx vitest run --config server/vitest.config.ts server/test/updater-{check,verify,swap,apply,ui}.test.ts`（5 files/53 tests passed） | 0 |
| R4 | `npm run build`（typecheck:web＋build:server＋build:web） | 0 |
| R5 | `npm run build:desktop:main`（tsc，noEmitOnError） | 0 |
| R6 | `node .zcode 技能/scripts/check-binding.mjs --repo . --matrix updater.yaml --strict --include-untracked`（22 行 covered=22，open=0，RED=0；测试索引 1822 用例含新文件） | 0 |
| R7 | `npm run build:server`（套件前置，桌面测试依赖 server/dist） | 0 |

## 4. 矩阵行提案（EARS；矩阵在工作区 .zcode 域，本任务不可写，待矩阵域录入）

| # | 行 ID（提案） | EARS | test_ids |
|---|---|---|---|
| P1 | UPD-PORTABLE-CHANNEL-SWITCH | WHEN 便携形态（app.isPackaged 且 PORTABLE_EXECUTABLE_DIR 非空白）下初始化更新链 THE SYSTEM SHALL 适配器切换为自研 PortableUpdater（DesktopUpdaterAdapter 同一面），channel() 仍报 packaged（渲染端零感知）；dev/NSIS 形态保持 electron-updater 路径零改动 | portable-updater.test.ts「便携模式识别」＋「主进程粘合源码契约」＋desktop-updates.test.ts 既有行（回归） |
| P2 | UPD-PORTABLE-CHECK | WHEN 便携形态用户点击检查更新 THE SYSTEM SHALL 拉取 feed latest.yml 并按精确名选便携产物条目（无该条目即人话拒绝不猜 setup 资产），updateAvailable 以 compareVersions 单一口径判定 | 「清单解析/条目选择/网络失败/无便携条目/feed URL 构造」6 例 |
| P3 | UPD-PORTABLE-DOWNLOAD-VERIFY | WHEN 便携形态下载新版 THE SYSTEM SHALL 下载至 <dataDir>/update-staging/<便携产物名>（下载前清空旧 staging）并按条目校验 sha512+size；任一不符 THE SYSTEM SHALL 删除 staging 文件并以人话错误拒绝应用（绝不进入替换） | 「下载落位/清旧/进度」「sha512 不符删文件拒」「size 不符」「中断删部分文件」「守卫」5 例 |
| P4 | UPD-PORTABLE-REPLACE-SCRIPT | WHEN 便携形态排空收敛后应用更新 THE SYSTEM SHALL 应用前复验 staging 字节，渲染替换脚本（等待旧 pid 消失→旧 exe 改 .old→staging 移入原路径→删 .old→启动新 exe；超时/重命名失败零触碰，移入失败回滚）写入 staging 并 detached spawn 后退出主进程 | 「脚本渲染时序」「应用复验→spawn→quit」＋冒烟 3 例（真 spawn 替换 exit 0/回滚 exit 4/超时 exit 2） |
| P5 | UPD-PORTABLE-ROLLBACK | IF 替换任一步失败 THE SYSTEM SHALL 旧 exe 保持可用（.old 回滚或现场保留）且 staging 文件不应用于替换 | 冒烟「回滚 exit 4 原样复位」「超时 exit 2 零触碰」＋「篡改→不 spawn」 |
| P6 | UPD-PORTABLE-DATA-INTACT | WHILE 便携更新全过程 THE SYSTEM SHALL 数据目录内容不被触碰（staging 与 exe 替换仅作用于 exe 路径与数据目录下 update-staging/） | P3/P4 用例的 staging 边界断言（数据保留＝目录分离的结构性保证） |
| P7 | UPD-PORTABLE-BOOT-CLEANUP | WHEN 便携形态启动 THE SYSTEM SHALL 清理 <dataDir>/update-staging 与 exe 旁 .old 残留（失败不阻断启动）；非便携形态 no-op | 「清残留/幂等」「非便携不清理」2 例 |
| P8 | RELEASE-PORTABLE-METADATA | WHEN release:desktop 产出发布资产 THE SYSTEM SHALL latest.yml 携带便携 exe 的 sha512+size 条目（幂等追加、setup/path 原样、追加后回读核验）且产物集含 migrate-v127.zip（纯 Node STORE zip，条目名安全校验，确定性输出）与 SHA256SUMS-desktop.txt 覆盖 | portable-updater-release.test.ts 6 例 |

受影响的既有行（语义未变，建议 binding_note 增补）：UPD-DESKTOP-CHANNEL-PACKAGED（packaged 现二分为 portable→自研/NSIS→electron-updater，行语义对 NSIS 仍成立）、UPD-DESKTOP-INSTALL-DRAINS-FIRST（exit 分支 quitAndInstall 在便携下由自研适配器承接，排空前置守卫不变）、UPD-DESKTOP-FEED-INJECTABLE（便携通道复用同一 env feed）、UPD-DESKTOP-PROGRESS-EVENTS（便携下载进度走同一事件面）。

## 5. 偏差与相邻问题登记

1. **`desktop/resources/update-replace.cmd` 未创建**（allowed_paths 列有该路径）：静态 .cmd 资源需经 electron-builder extraResources/files 入包才能随包分发，而 electron-builder.yml 不在本任务 allowed_paths；且 asar 内 .cmd 无法被 cmd.exe spawn。按简报「或等价」落为运行时渲染（renderReplaceScript 纯函数＋写 staging），单一事实源、可单测。若后续希望资源文件化，需另一任务改 electron-builder.yml。
2. **latest.yml 便携条目是便携自更新的前提**：既有 Release 的 latest.yml 不含该条目（旧版即使带上自更新代码也检查不到便携资产）——首个携带本代码的 Release 起自更新链路才闭环（自举边界，与 UPD-01 zip 更新器相同性质）。
3. **electron-updater NSIS 通道对多 files 条目的资产选择**：条目形状对齐 electron-builder 原生产出的 setup+blockmap 双条目形态，预期无影响；真实 NSIS 在线更新端到端属 PACK-05 已登记的真机验收项，本任务未重复覆盖。
4. **e2e/update-settings.spec.ts 未复跑**：需 journey 隔离运行时（TRAINER_RUN_MANIFEST）；该 spec 驱动 HTTP 通道（渲染端），本任务对 web/src 与 HTTP 通道零改动（desktop 146/146 内含 updateFlow 相关源码契约回归）。集成阶段 journey 复跑时一并覆盖。
5. **脚本探活的平台实测事实**：`find` 在装了 Git 的机器可能被 PATH 解析为 GNU find；tasklist 无匹配 rc=0（不可判）。已改 findstr（System32 独有）。此事实对仓库内其他 bat/cmd 脚本同样成立（登记，不越界修）。
6. **quitAndInstall 失败路径的呈现**：应用失败（复验不过/spawn 失败）时主进程已排空，仅日志＋（main 注入的）onApplyFailure 事件后退出；渲染端在退出窗口内可能看不到错误，下次启动重新检查即恢复。真机验收时观察此项。

## 6. proposed_default 待拍板清单

- 替换脚本等待旧进程上限 30 次×约 1s（REPLACE_WAIT_MAX_TRIES=30）。
- 脚本启动新 exe 用 `start "" /B`（无新窗口）；删除 .old 失败不阻塞。
- staging 目录名 `update-staging`、脚本名 `update-replace.cmd`、日志名 `replace.log`（均在数据目录 staging 下，随启动清理）。
- latest.yml 便携条目追加在 files 末尾（不改动既有条目顺序）。
- migrate-v127.zip 为 STORE（无压缩）zip、名字不带版本号（内容稳定，跨版本复用）。
- 应用失败仍 app.exit(0)（退出码 0；错误经日志/事件呈现，不用非零退出码区分——桌面应用用户不看退出码）。

## 7. 收尾自检

- `git log --oneline -1`：分支 HEAD ≠ 263d224（见提交）。
- `git status --short`：干净（提交后复核）。
