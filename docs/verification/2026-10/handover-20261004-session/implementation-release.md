# 本会话实现与发布记录

返回[交接入口](README.md)；用户录像现场及下一任务见[接续待办](continuation.md)。本页保留原验证记录的结论，不表示本次文档编辑重新执行产品测试。

## 1. 用户要求与完成情况

用户最初要求从 GitHub 下载包复现首次配置通达信目录卡死，修复后仍以 1.2.7 发布，且**先提供包验收，通过后才发布**。后续又要求录像按本机训练/用户导入两栏独立管理、提供清理入口、清理散落测试目录、改善深色退出白屏，并修复自定义训练范围丢失条件单设置。

用户已确认上述包验收通过，并明确授权 GitHub 发布；随后授权处理 GitHub 失败邮件及改善个人主页。最新要求是整理本会话交接，未要求继续实施新的录像存储方案。

### 首次配置通达信卡死

有两层故障，均已修复并由用户复现确认：

- 启动器 CLI 装配层将 `restartAttemptPath` 原样透传，而 `runSetupRestartAttempt()` 读取 `attemptPath`，导致 `resolve(undefined)` 崩溃，状态停在 `preflight`。现显式映射字段，监管早期异常也写入 `phase=failed, done=true`，并补穿透 CLI 的回归。
- Chromium 同源 GET 可以没有 `Origin`，但带 `Sec-Fetch-Site: same-origin`。旧控制守卫将其当成本机助手请求，重启状态轮询连续 401；现按 Origin/Fetch Metadata 判断浏览器路径，保留跨站拒绝和助手令牌约束。

入口：`launcher.cjs`、`server/src/setup/control-guard.ts`、`server/test/release-launcher.test.ts`、`server/test/setup-control-guard.test.ts`。证据见[首配修复记录](../V1.2.7-setup-restart-fix/README.md)。启动器回归依赖真实编译模块，先 `npm run build:server` 再运行该测试文件。

### 录像来源、清理与首次使用隔离

旧问题来自同一浏览器 origin 共用未隔离的 `trainer-recordings` IndexedDB：换解压目录后仍能读到浏览器旧录像，而新 SQLite 的训练历史为空。**没有证据证明公开 ZIP 携带个人训练库**。

`9514ce2` 与 `04c4dd0` 已实现数据库命名空间、启动加载保护、本机/导入两栏、单条删除及按来源清理。导入生成新的 `imported-*` ID，保留来源 ID，避免覆盖本机录像；本机当前训练及其他标签页写入的录像受删除保护。旧公共库保留，不自动归入新命名空间。

入口：`server/src/db.ts`、`server/src/api.ts`、`web/src/App.vue`、`web/src/components/RecordingLibrary.vue`、`web/src/recording/recordingRepository.ts`、`importedStorage.ts`、`libraryTypes.ts`、`recordingLease.ts`。合同与验收见 [REC-LIBRARY-FIX-01](../../../work-items/tasks/REC-LIBRARY-FIX-01.md)及[录像模块说明](../../../../web/src/recording/README.md)。

### 退出主题与残留页面

`a97f24d`、`7cbc6c4` 已修复退出确认、排空及已退出页的主题；深色已退出页为 `#202020`，相关双主题断言见 `e2e/exit-flow.spec.ts`，用户已验收。

用户后来看到旧浏览器标签仍显示页面，点击退出出现 `Failed to fetch`。已加载的前端可以在服务停止后继续显示；再次点击会因接口不可达报错，因此**页面仍可见不能证明服务仍在运行**。交接时 `netstat -ano -p tcp` 未发现 8787 的 LISTENING 项。本次未启动用户程序；未来判断须同时核对监听端口、进程身份及健康响应，不能仅依据页面或“服务仍在运行”的固定失败文案。该误导性失败文案的后续完善未在本轮交付中实现。

### 自定义训练范围条件单

`createRangeTraining()` 曾硬编码 `clock_mode=close_only`、`orders_enabled=false`，覆盖开始训练前的选择。`6493a67` 现校验并保留输入，`open_close` 从首根开盘阶段开始；`3199674` 补充创建响应及真实浏览器流程回归。定向单测 21/21、相关引擎单测 57/57、范围 Journey 7/7 和构建通过，用户验收通过。入口为 [server/src/train/engine.ts](../../../../server/src/train/engine.ts#L705) 的 `createRangeTraining()`，具体证据见[条件单修复](../V1.2.7-condition-orders/README.md)。

## 2. 验收包与正式发布

- 用户验收对象：提交 `3199674a80ec00d881534c1c49a32319ac3ef3d8`，ZIP SHA256 `e3bdec879b042362aba72240d2798f7e41c9c9f36d2648430385e215da43c597`；原验收路径在[用户记录](../V1.2.7-user-acceptance/README.md)中保留。
- 已于 2026-10-04 替换现有 [v1.2.7 Release](https://github.com/m1kuStark/a-share-kline-trainer/releases/tag/v1.2.7)，Release ID `402384887`；正文按旧公开提交 `81be8ef` 到最终包来源的代码差异编写，README 与用户指南已更新。
- 正式包提交 `bbd368b09a463183364861678db83a9ae86b1472`，ZIP asset `608131607`，54,709,594 字节；SHA256 `704cfa03f2a13bdcab70e7e32ffd475760ab92f4a3b6eb46fbcccc63fd8d05a5`。
- `SHA256SUMS` asset `608141422`。资产上传状态、摘要与标签已核对；最终包和验收包应用文件完全一致，差异为文档、配置示例说明和发布元数据，见[发布验证](../V1.2.7-published/README.md)。

发布后的 `1a79853`、`b783633`、`0715a0a`、`4e52763` 不属于正式包来源。GitHub 修复轮没有移动标签或替换下载资产；依赖审计为零也不能套用于未重新构建的包。

发布时 `D:\MySoftWares` 曾仅保留 fix 验收目录，旧 final 包移到仓库 `.runs/package-archive-20261004/`。**本次现场复查该目录下已没有 K 线训练器文件夹**，原因未在当前证据中记录；以用户桌面安装路径为准，不复建旧目录、不覆盖用户 data。后续临时包放 `.runs`，提交验收时遵守用户“只留一个 fix 目录”的要求。

## 3. GitHub 邮件、检查和展示

[GITHUB-HEALTH-01](../../../work-items/tasks/GITHUB-HEALTH-01.md) 已关闭，详见[报告](../GITHUB-HEALTH-01/report.md)及 [result.json](../GITHUB-HEALTH-01/result.json)。

`b783633` 修复干净 CI 先测试后编译、旧数据库/录像/页面契约断言、Windows 路径夹具及生产线索解析（显式 `path.win32`）；补足启动器分离进程清理，更新 Fastify、fast-uri、brace-expansion、Vitest 等依赖，并整理公开展示。`0715a0a` 修复 POSIX 符号链接忽略及完整性测试的共享时间预算，仅改测试与证据。`4e52763` 为文档收尾。

| 检查 | 最新已记录结果与边界 |
|---|---|
| 远端 Source checks | [Actions 37143145799](https://github.com/m1kuStark/a-share-kline-trainer/actions/runs/37143145799)，tested commit `0715a0a5e5e5f1bf754e9e947c4de30dbcfaaf5d`，双平台 success |
| Windows 单测 | 110 个文件，1423/1423 通过 |
| Ubuntu 单测 | 109 个文件，1417 通过；既有平台专用文件的 6 项跳过，本轮未新增跳过 |
| 构建 / M2 冻结样本 | 构建通过；M2 24/24 |
| npm 完整依赖审计 | 当前源码快照 0 漏洞 |
| 全量 Journey | 两轮均为 125 项：93 通过、29 失败、3 未运行；逐项状态与错误一致 |
| 主代理 UI | 独立数据生产预览、1280×720、录像双来源空态及深浅主题；无控制台 error/warn，测试服务已结束 |

已创建 [m1kuStark 个人主页](https://github.com/m1kuStark)，展示真实训练界面及两个公开作品；更新训练器 README、CI 徽章、Issue/PR 模板、仓库 URL。两个原有公开仓库的说明、topics、依赖告警、安全更新、密钥扫描、推送保护及私密漏洞报告已配置；开放 Dependabot 告警 API 当时均为零，仅代表查询快照。主页与图片等入口已实际核验可访问。

账号 `name/bio/blog` 的 API 写入返回 404，字段未修改；私有仓库未改。不要将旧失败邮件理解为当前 CI 仍红，也不要把 Source checks 成功写成全套产品回归通过。
