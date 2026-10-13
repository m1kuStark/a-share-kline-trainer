# MIG-ONECLICK-01 验证记录：迁移工具一键化（同一文件两侧运行）

- 分支：`mig-oneclick`（worktree D:\tmp\mig1click01，base=cf87c40）
- 日期：2026-10-13
- oracle：用户原话（2026-10-13 第五轮任务 3，全文见任务卡与矩阵三行 MIG-ONECLICK-*）

## 0. 事故披露（置顶，先于一切结论）

变异抽检收尾时误用 `git checkout -- tools/migrate-v127/src/export-tool.cjs` 还原变异，
**连同一并丢失了该文件的全部未提交改动**（随后 dist 重建放大了损失面）。处置：按上下文
完整重做八处编辑→重建→复验（migration 域 4 文件 44 用例全绿＋desktop mig 域 2 文件
34 用例全绿＋`--help` 冒烟；dist 字节数 156.6 KB 与事故前一致）。最终全量 server 套件
在恢复后重跑（见 §4 收据）。教训（供后续轮次）：未提交工作面上的变异还原必须用
正向补丁或先 commit 快照，禁用 VCS 整文件还原。

## 1. 方案选型论证

### 1.1 同一入口两侧运行（MIG-ONECLICK-EXPORT-SIDE / IMPORT-SIDE）

- **入口**：`一键迁移.cmd`（ASCII-only，沿用既有 cmd 先例防中文解析损坏）。它只做一件事：
  找一个能跑 JS 的运行时——优先 `..\runtime\node.exe`（v1.2.7 便携包标记）；否则取父目录
  `K*.exe`（NSIS productName=K线训练器→安装后 exe 名 `K线训练器.exe`，自然避开
  `Uninstall *.exe`；通配未命中时字面量路径过不了 `if exist` 守卫，回落 any-exe 兜底），
  置 `ELECTRON_RUN_AS_NODE=1` 用该 Electron exe 当 node 运行 `oneclick.cjs`
  （ELECTRON_RUN_AS_NODE 可行性＝3060 技能库既有实证）。
- **权威模式判定在 `oneclick.cjs::detectOneClickMode`**（不猜）：父目录有
  `runtime\node.exe`→export；否则非 Uninstall 的 .exe（K 前缀优先）→import；都没有→
  人话报错 exit 2（实测：在仓库 dist 内直接运行正确报错退出 2）。
- v1.2.7 侧零 node 依赖问题：export 分支完全复用既有 export-v127.cjs（其在真实 v1.2.7
  包内已实证可跑，journey run-7155e58c）。

### 1.2 导出侧：一键产包到工具文件夹（复用既有导出引擎，不重写）

- `export-tool.cjs` 参数化重构：`main()`→`runExportTool(args, overrides)`，手动模式
  （既有「导出训练录像.cmd」与 e2e 绑定链）行为零变化；一键模式新增
  `prepareOneClickHistory`（=buildHistoryPackage 落 outputDir=工具文件夹，`训练历史迁移-<ts>/`）
  ＋`/upload-bundle` 端点（`saveUploadedBundle` 校验 REC-BULK format 后落
  `训练录像库-<ts>.trainer-recordings.json` 同样在工具文件夹）。
- 页面自动模式：`info.mode==='oneclick'` 注入后 export-page 自动扫描→自动组包→
  POST 上传→人话结果→`/shutdown` 自动收尾；多库发现（>1）回落现有人工单选后继续自动
  （MIG-NAMESPACE-DISCOVERY 语义保留）；无录像＝skip 语义成功（不产文件，历史包不受影响）。
- 选型理由：历史/录像的全部校验、转换、打包代码 100% 复用 MIG-01/MIG-EXT-01 既有已测
  逻辑，新增面只做「落点改到工具文件夹＋自动上传」两件事。

### 1.3 导入侧：历史走既有管线，录像走注入通道（核心难点论证）

- **历史**：工具**不自己碰训练库**。暂存到 `<dataDir>/migrate-v127-import/` 后，由桌面主进程
  boot 消费（`consumeOneClickHistoryStaging`→复用已测 `stageHistoryImport` 产
  `.v127-history-pending`→紧随其后的既有 `applyPendingHistoryAtBoot` 合并归位）。
  备份/单事务/幂等/ns 保留全部继承 MIG-MERGE-01，零新语义。工具侧因此无需打包
  server migrateDatabase（避免 schema 逻辑第二份拷贝漂移）。
- **录像**（渲染端 IndexedDB 主进程不可直写＝技术约束）：
  - 方案＝工具自带导入器脚本 `import-recordings.js`（esbuild browser 打包，源码直接
    import 仓库正源 `web/src/recording/{bundle,recordingRepository}`——与新版页面
    「导入录制」**同一条真实消费链**：fetchEnv→configureRecordingNamespace→
    bulkImportRecordingFiles→validateCompactRecording→imports.save，满足 §4.2
    「桩回显拦不住 IO 形态错误」条款）；
  - 主进程窗口 `did-finish-load` 后 `executeJavaScript(buildRecordingImportScript(...))`
    注入执行（bundle 文本以 JSON 字符串字面量内嵌，返回 JSON 摘要；页面内 fixed overlay
    呈现进度）；成功→manifest 标记＋删除暂存文件；失败→暂存保留下次启动重试
    （bulk 导入幂等 first-wins，重试安全）；
  - 否决的替代：主进程直写 IndexedDB 磁盘文件（不可行）；server 端点喂包给渲染端
    （渲染端 boot 期模块不在本任务 allowed_paths，App.vue 不可写）；preload 新通道
    （preload.cts 不在 allowed_paths）。
- **数据目录解析**：`resolveImportTargets` 镜像桌面 `data-home`+`desktop-config` 优先级
  （TRAINER_DATA_DIR/TRAINER_DB > trainer.config.json dataDir 显式 > desktop-data-choice.json
  adopted 且库在 > ~/.a-share-kline-trainer；databasePath 跟随 TRAINER_DB > config 显式 >
  `<dataDir>/trainer.sqlite`），全程零用户输入。
- **停服门禁**（fail-closed）：读 `<dataDir>/trainer-state.json`（复用 readStateIdentity）
  →pid 存活或端口有应答→拒绝写入（exit 2）；训练器未运行才暂存＋拉起。
- **拉起训练器**：spawn exe 时**必须剥掉 ELECTRON_RUN_AS_NODE**（本工具自身以该变量
  运行；不剥会把新进程也变成 node 模式）——已在 launchApp 中处理。
- **暂存原子性**：先清旧暂存→逐文件拷贝→`manifest.json` **最后**落盘＝完成标记；
  消费端只认 manifest（中断＝无 manifest＝整体忽略；重跑工具＝整体替换＝幂等）。
  manifest 内所有路径经 `isSafeRelativePath`（防穿越/防绝对/防盘符）校验后才可被
  读取/注入。

### 1.4 registerMigrationIpc 去留（binding_note 授权论证）

**保留**（渲染端入口按 oracle 退役）。理由：① preload.cts 不在本任务 allowed_paths，
退役主进程 handler 会在 preload 留下 invoke 即报错的孤儿暴露面（渲染端已无调用方，
现状零危害）；② 其路由行为有既有测试锁定（mig-import.test.ts 3 用例），删除＝顺带删测，
违反最小改动；③ 保留为已测试的手动兜底通道（一键工具故障时的运维后路）。登记为
人工判断项，用户可要求后续轮次整体退役（需连 preload 一并改）。

## 2. 两侧运行机制说明（用户视角）

1. 工具文件夹 `migrate-v127` 放进 v1.2.7 包根 → 双击 `一键迁移.cmd` → 控制台人话进度：
   检测旧数据目录/端口/命名空间 → 训练历史迁移包生成在工具文件夹 → 自动开浏览器 →
   页面自动扫描上传录像合并包到工具文件夹 → 「一键导出完成」汇总（历史包路径＋录像包
   路径＋下一步指引）→ 自动退出（历史失败时 exit 2 保留窗口提示）。
2. 整夹拷/移到 v1.3.x 安装目录（与 K线训练器.exe 同级）→ 双击**同一个** `一键迁移.cmd` →
   自动识别新版本环境＋数据目录 →（训练器运行中则人话拒绝）→ 暂存就位 → 自动拉起
   训练器 → boot 自动合并历史（备份先行）＋页面加载后自动导入录像（overlay 进度）→
   成功自动清理暂存。全程零路径输入；重复运行幂等。

## 3. RED→GREEN 收据

RED（全部以正确原因失败，先于产品码）：
- `server/test/migration-oneclick.test.ts`：exit 1，`Cannot find module '.../oneclick.cjs'`（功能未实现）
- `desktop/test/mig-oneclick.test.ts`：exit 1，同上（且新导出未定义）
- `server/test/migration-oneclick-settings.test.ts`：exit 1，断言失败「源仍包含 从 v1.2.7 迁移」（分栏仍在）

GREEN（实现后）：
- `npx vitest run --config server/vitest.config.ts migration-oneclick` → exit 0（15 用例）
- `npx vitest run --config desktop/vitest.config.ts mig-oneclick` → exit 0（9 用例）

## 4. 机器结果（命令＋退出码）

| 命令 | 退出码 | 说明 |
|---|---|---|
| `node tools/migrate-v127/build.mjs` | 0 | dist 重建（export-v127.cjs 156.6KB／oneclick.cjs／import-recordings.js 125.6KB／一键迁移.cmd／迁移说明.md） |
| `npx vitest run --config server/vitest.config.ts`（全量，事故恢复后终跑） | 1 | 1712/1714 绿；2 失败均为超时抖动且两轮全量**轮换出现**（首轮：random-training-mode「exposes the random caliber…」＋release-launcher「launch adopts the saved choice…」；终跑：random-training-mode「keeps every running hideTime…」＋review-profile「classifies committed plain markdown…」，5000/15000ms 超时）；**涉事文件单独重跑全部绿**（首轮两文件 85/85 exit 0；终跑两文件 49/49 exit 0）＝全量并发负载抖动，与本轮改动域（迁移工具/desktop/web 设置页）无交集 |
| `npx vitest run --config desktop/vitest.config.ts`（全量） | 0 | 27 文件／267 用例全绿 |
| `npm run typecheck:web`（vue-tsc） | 0 | TrainingSettings 分栏删除类型自洽 |
| `npm run build:desktop:main`（tsc） | 0 | mig-import.ts/main.ts 编译通过 |
| `node …/export-v127.cjs --help` | 0 | 旧手动入口 CLI 兼容（usage 原文不变） |
| `node …/oneclick.cjs`（非安装目录） | 2 | fail-closed 人话报错（unknown 分支实测） |
| check-binding --strict --include-untracked | 3 | 基线 12 covered 未破坏（16 行｜covered=12 open=4 RED=0）；4 open＝本轮 3 行 planned（等 orchestrator 回填 test_ids 升 covered）＋存量 MIG-CONSOLE-FALLBACK planned（非本任务范围）；测试索引 2036→2060（+24＝本轮新增用例全部被索引） |

（恢复事故后的最终全量 server 收据见收尾报告；如与 §4 首行全量并列呈现，两轮均如实登记。）

## 5. 变异抽检

1. **真实变异（executed）**：删除 `saveUploadedBundle` 的 format 校验三行 → 首轮
   **变异存活**（`{hello}` 载荷被 items 校验兜住，format 语义未被独立锁死）→ 强化测试
   （新增「带 items 但 format 错」载荷断言）→ 复跑 exit 1＝**击杀**。杀手测试：
   `server/test/migration-oneclick.test.ts::saveUploadedBundle 拒绝非合并包载荷且不落任何文件`。
   该轮暴露并修复了一处测试 oracle 盲区（变异抽检的直接收益）。
2. **纸面推演**：删除 `consumeOneClickHistoryStaging` 的 manifest consumedAt 写回 →
   每次启动重复 staging（apply 幂等不至重复数据，但完成标记语义丢失）。死于
   `desktop/test/mig-oneclick.test.ts::工具真实暂存经 consumeOneClickHistoryStaging 产出 pending 并由 applyPendingHistoryAtBoot 合并归位`
   的 `typeof manifest.history.consumedAt === 'string'` 断言。
3. 附加：设置分栏删除若被回退（分栏恢复），`migration-oneclick-settings.test.ts` 源锁立即红。

## 6. 矩阵 test_ids 提案（orchestrator 回填；ref 格式 file::it名）

**MIG-ONECLICK-EXPORT-SIDE**（planned→covered）：
- `server/test/migration-oneclick.test.ts::父目录含 runtime node exe 判为 v1.2.7 导出侧`
- `server/test/migration-oneclick.test.ts::prepareOneClickHistory 把训练历史迁移包生成于工具文件夹内并回读清单计数`
- `server/test/migration-oneclick.test.ts::saveUploadedBundle 把合法录像合并包写入工具文件夹且命名带时间戳`
- `server/test/migration-oneclick.test.ts::saveUploadedBundle 拒绝非合并包载荷且不落任何文件`
- `server/test/migration-oneclick.test.ts::saveUploadedBundle 空录像列表按 skip 完成不产文件`

**MIG-ONECLICK-IMPORT-SIDE**（planned→covered）：
- `server/test/migration-oneclick.test.ts::父目录含 K 系 Electron exe 判为 v1.3.x 导入侧并给出 exe 路径`
- `server/test/migration-oneclick.test.ts::resolveImportTargets 按 env 显式、trainer.config.json、采用记录、默认主目录优先级解析（无需用户输入）`
- `server/test/migration-oneclick.test.ts::pickOneClickArtifacts 取工具文件夹内最新的历史迁移文件夹与录像合并包`
- `server/test/migration-oneclick.test.ts::decideImportGate 训练器运行中（pid 存活或端口有应答）一律拒绝暂存`
- `server/test/migration-oneclick.test.ts::stageOneClickImport 把录像包、导入器脚本与历史包暂存到数据目录并最后写 manifest`
- `server/test/migration-oneclick.test.ts::stageOneClickImport 中途失败不写 manifest（fail-closed 完成标记）`
- `server/test/migration-oneclick.test.ts::stageOneClickImport 重复运行替换旧暂存（幂等且无残渣）`
- `desktop/test/mig-oneclick.test.ts::工具真实暂存经 consumeOneClickHistoryStaging 产出 pending 并由 applyPendingHistoryAtBoot 合并归位`
- `desktop/test/mig-oneclick.test.ts::历史包被篡改时 consume 返回结构化失败、暂存保留可重试且目标库零损伤`
- `desktop/test/mig-oneclick.test.ts::buildRecordingImportScript 组装的脚本可在 vm 中执行并原样送达合并包载荷`
- `desktop/test/mig-oneclick.test.ts::runOneClickRecordingImport 成功后清理录像暂存并在 manifest 标记已消费`
- `desktop/test/mig-oneclick.test.ts::runOneClickRecordingImport 页面失败时保留暂存供下次启动重试`

**MIG-ONECLICK-SETTINGS-PANEL-REMOVED**（planned→covered）：
- `server/test/migration-oneclick-settings.test.ts::设置页源不再包含从 v1.2.7 迁移分栏、desktopMigration 通道与 migration 分栏值`

覆盖度自评（诚实分层）：EXPORT-SIDE 的「页面自动上传」半边与 IMPORT-SIDE 的
「executeJavaScript 真机注入」半边为 L1+（机制在 vm/单测层锁定，浏览器/Electron 真链
留集成阶段）；其余（模式判定/落点/优先级/门禁/暂存原子性/幂等/历史归位全链/清单契约）
为 L2（独立夹具＋真实工具产物＋真实消费链断言）。

## 7. 偏差登记

1. **真机两侧端到端未跑**（派发简报明确留集成阶段）：v1.2.7 真实包内一键导出（浏览器
   自动上传链）、v1.3.x 安装目录内一键导入（ELECTRON_RUN_AS_NODE＋拉起＋注入链）。
   已登记缺口；e2e（migration-v127.spec.ts，MIG_V127_PACKAGE 门控）本轮未动、不受影响。
2. `npm run workflow:state` 未执行：worktree 内未发现 workflow 控制根（state 文件），
   状态对账经任务卡更新＋收尾报告完成（orchestrator 域）。
3. 全量 server 首轮 2 例超时抖动（§4）；恢复事故后已重跑全量复核。
4. e2e/journey 按派发约束未跑（端口约束）。
5. 大合并包（数十 MB 级）经 executeJavaScript 注入的体积上限未压测（CDP evaluate 常规
   可承载；真机验收项）。

## 8. proposed_default 清单（呈现类自定项，提验）

1. 入口文件名 `一键迁移.cmd`；工具文件夹名沿用 `migrate-v127`。
2. 产物命名沿用既有：`训练历史迁移-<时间戳>/`（内 trainer.sqlite＋迁移清单.json）与
   `训练录像库-<时间戳>.trainer-recordings.json`，均生成于工具文件夹根。
3. 暂存目录名 `migrate-v127-import/`＋`manifest.json`（契约 format=
   `trainer-oneclick-import` version=1；内含 installDir 诊断字段）。
4. 页内导入进度 overlay 文案（"v1.2.7 迁移：正在…"／"录像迁移完成：成功 N / 跳过 M"）。
5. 控制台全部人话文案（含「一键导出完成」汇总与下一步指引措辞）。
6. 一键导出完成自动退出（1.5s 延时）；.cmd 成功也 pause（供读结果）。
7. 导入侧完成后自动拉起训练器（spawn 剥 ELECTRON_RUN_AS_NODE）。
8. 旧入口保留为兜底：`导出训练录像.cmd`（手动导出页）、控制台兜底 txt、
   「训练录像」页手动导入；迁移说明.md 已按新交互重写（旧入口列为兜底）。
9. 无录像＝skip 成功（exit 0，不产空包）；一键模式历史导出失败＝exit 2（录像仍完成）。
10. 导入侧暂存重跑＝整体替换（不清数据目录其他文件）。

## 9. 人工判断项 / 待拍板项

- 人工判断（已按论证执行，可复议）：registerMigrationIpc 保留（§1.4）。
- needs_user_decision：无（oracle 三行语义明确，无行为歧义阻断）。
