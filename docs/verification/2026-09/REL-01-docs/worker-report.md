# GLM public documentation handoff

Worker self-report; not package acceptance. Root review and lifecycle instructions remain subject to release integration.

[Release contract](../../../engineering/release-m3-contract.md).

## 交付物（本任务全部允许路径）

- `README.md`：公开入口重写。简介＋实际能力清单＋M4/M5未实现与禁用导航的如实说明；Windows ZIP 五步路线（下载→解压→配置 tdxRoot→Start.cmd→Create Shortcut.cmd，与 install.md 顺序一致）；Releases 链接注明由集成人随 v0.3.0 发布后生效；源码 npm ci/build/start 与 TDX_ROOT/PORT/TRAINER_DB 示例（通用示例路径，未泄露私有路径）；683 个 CJK 字符（预算<2000）。
- `docs/user/README.md`：用户指南（训练流程、快捷键、23种画线、数据来源、DB与录像双存储备份、升级与移动、未包含功能）。
- `docs/user/install.md`：一键版下载/解压/trainer.config.json 字段（tdxRoot 反斜杠转义示例、port 8787、dataDir、databasePath）＋TDX 文件清单（vipdoc/{sh,sz}/lday/*.day、T0002/hq_cache/gbbq、名称文件）＋源码运行与环境变量。
- `docs/user/recording.md`：录制默认开/暂停缺口如实标记、导出 .trainer-session.json.gz 与导入限额、自包含分享、按日回放与独立周期切换、录像存浏览器 IndexedDB 按来源地址区分、旧 JSON 可导入。
- `docs/user/troubleshooting.md`：闪退/日志在 dataDir、TDX 根目录与缺文件、端口占用不自动换不杀进程、解压与路径、浏览器录像与数据库分辨、导出导入限制、更新日线只扫描本地、升级恢复、旧画线无基准保留原值。
- `CONTRIBUTING.md`：独立公共指南（环境、硬约束、测试与门禁、e2e 依赖本地合法 TDX 夹具与 Edge 不承诺任意机器可跑、提交流程），不引用私有 work-items。
- `SECURITY.md`：本机信任模型（127.0.0.1 无鉴权，勿对外暴露）、GitHub 私密漏洞报告优先，未编造邮箱。

## 一致性决定

- 公开默认 127.0.0.1:8787；既有用户的 7529 端口与私有 TDX 路径未出现在任何公开文档。
- 未链接私有仓库 a-share-kline-trainer；未附截图（无素材，不放假链接）。
- 不承诺排行/成绩单/设置页；未复制内部测试计数或验收数字到公开文档。

## 待集成人核对（不确定项）

- `trainer.config.example.json`、`Start.cmd`、`Create Shortcut.cmd`、日志位于 dataDir 等均按 release 合同描述；REL-LAUNCH/REL-PACK 实现落地后需对照实际文件名与字段再发布。
- "数据库默认 dataDir/trainer.sqlite"源自源码 config.ts 默认值；launcher 的 databasePath 默认行为需与实现核对。
- 复用判据（appId/runId/PID 健康探测）与"本包"的界定：文档现按合同表述为"仅复用本包启动且健康的服务，否则报错"，具体身份判定需与 launcher 实现核对；跨目录副本是复用还是冲突取决于 runId 语义。
- 便携包内 README 的 `docs/user/**` 相对链接成立的前提是打包白名单包含 docs/user 与 LICENSE/THIRD-PARTY-NOTICES。
- 本工作树无 node_modules，`docs:check`／`docs:status` 未运行；链接已人工核对指向存在的文件，命令级校验由集成人执行。

## 集成人评审修正（2026-09-21 已落实）

- 公开快照将移除 `scripts/docs.ts` 与 `docs:check`/`docs:status` 命令：CONTRIBUTING 不再提及这两个命令，全部指引改为自包含（npm test/build + e2e 前提如实），不依赖私有规格/模块。
- README 快速开始顺序改为与 install.md 一致：下载→解压→配置 tdxRoot→启动→建快捷方式。
- 导出录像内容更正：分享包**包含**历史训练状态与画线（源码 `RecordingCheckpoint.training`/drawings 版本链证实）；但导入只进录像库、只读回放，**不会**恢复成可继续操作的训练、不写训练数据库。原"导出录像不含成绩和画线"的说法已删除。
- 启动/升级须先停止旧服务；关闭浏览器≠停止服务。launcher 以 detached 方式运行 Node（release 合同），故"关窗口即停"也不写入文档。**确切停止命令为集成依赖项**（根评审 launcher 后或提供 Stop.cmd）：文档三处（install.md 升级、troubleshooting 备份、用户指南备份/升级）现表述为"具体停止方式以发布包内随附的说明为准"，落地后须替换为确切步骤。
- 复用语义收紧：重复 Start.cmd 仅复用**本包** app/runId/PID 健康服务；端口上是他包/源码实例时按冲突报错，指导用户沿用原配置而非结束进程，绝不建议杀未知进程。
- 来源地址：默认 origin 恰为 `http://127.0.0.1:8787`；troubleshooting 明确 `localhost:8787` 是不同来源、录像分开存放，不得互换。
- SECURITY 兜底改为"开无细节 Issue 请维护者启用私密漏洞报告"，删除"私信跟进""已通过其他渠道联系"等虚构说法。
- 回放控制与训练快捷键按源码补齐：回放 空格/PageUp/PageDown/`[`/`]`/播放（0.2–10 秒/日可调）；训练 Delete（删选中画线）、Esc（退出画线/多选）、Ctrl+Z/Ctrl+Shift+Z（撤销/重做，Ctrl+Y 同重做）。
- 录像限额按 `recordingFile.ts` 精确化：v2 压缩 25MiB、解压 128MiB；旧 JSON 迁移上限 256MiB。新手流程不放容量警告。
- 修正标题错字"有关闭训练器再备份"→"备份前先停止训练器"。
