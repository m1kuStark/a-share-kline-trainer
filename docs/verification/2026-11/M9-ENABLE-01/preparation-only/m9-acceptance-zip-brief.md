# M9 同一最终提交的最小验收 ZIP

只读核查日期：2026-11-18。未构建、打包、启动产品或修改仓库。

## 建议产物

在主任务完成集成、文档和门禁之后，冻结一个完整的最终 sourceCommit。以该提交的生产源码、package-lock 和构建配置执行构建；之前候选树的测试与依赖构建只能作为候选证据，不能代替这个 ZIP 的身份。

ZIP 根目录最少包括：
- Start-Acceptance.cmd / Start-Acceptance.ps1（现有隔离包装的逐字副本）
- app/（本次 win-unpacked 的整个目录，不能只取 exe）
- sample-market/（经过挑选的非个人样例行情，带文件指纹）
- ACCEPTANCE-IDENTITY.json、FILES-SHA256.json、简短验收说明

不得纳入个人 DB、AppData、浏览器 profile、录像或旧 .acceptance-data。首次解压后由包装生成 .acceptance-data；port.txt 必须留存以保持 IndexedDB 的同源端口。应将该 ZIP 作为本地验收产物，发布仍由主任务依既有 NSIS 流程另行处理。

## 必须绑定的身份字段

外层 ACCEPTANCE-IDENTITY.json 建议记录：任务 M9、生成时间、完整 sourceCommit 和 gitTree、构建前后 tracked/untracked 状态、package version、Node/npm/Electron/electron-builder 版本；package.json/package-lock/electron-builder.yml/两份包装 SHA256；构建命令、字面退出码和证据位置；app.exe 与 resources/app.asar 的 SHA256；app/ 和 sample-market/ 文件数量、每文件相对路径/bytes/SHA256，整体清单 SHA256。

ZIP 生成后单独记录归档 bytes/SHA256、清单 SHA256。新目录完整解压并验证所有文件 SHA256、无重解析点、无个人测试数据；解压收据绑定该 ZIP SHA256。真实启动后记录 exe 路径和 SHA、health/state 的 runId/pid/port、DB/profile/sample-market 绝对路径、窗口出现和退出结果。这里的字段属于建议的外层身份声明，不能假定现有 exe 已内嵌 gitCommit。

## 可复用行为与限制

- scripts/acceptance/Start-Acceptance.ps1:4,6,16,28-36 已指定 app\K线训练器.exe、.acceptance-data、port.txt；清理继承 TRAINER_*/PORTABLE_EXECUTABLE*/Node/dev/TDX/端口变量，设置隔离 DB、HOME/AppData/temp/profile、TDX_ROOT=sample-market 和 OPEN_BROWSER=0。
- scripts/acceptance/zip-smoke.ps1:12 将证据目录硬编码为 docs/verification/2026-10/BUILDER-ACCEPT-01。本次不可直接让它覆盖历史证据；由主任务使用缓存中的本次副本/适配入口输出到 M9 证据目录，并保存副本哈希与改动说明。无需为此重构产品。
- desktop/scripts/package-desktop.mjs:56 显式调用 portable --publish never；desktop/electron-builder.yml:40 则说明当前正式分发以 NSIS 为准。主任务应明确本次采用的打包命令和用途，不从旧脚本名推断 NSIS 验收已经完成。
- scripts/release/export-source.mjs:47,63 的 SOURCE-MANIFEST.json 可证明干净源码导出的 sourceCommit 和逐文件 SHA，但不是现成的桌面 ZIP 身份证明。
- 2026-10/BUILDER-ACCEPT-01 的 candidate-identity.json 和 delivery-zip.json 是可借鉴字段的历史样例，不能充当本次验收。

## 最小验收边界

首次解压→CMD 包装真实启动→可见窗口、health/DB/profile 身份吻合→主要 M9 用户旅程和关闭→重新启动确认数据与录像同源留存。机器冒烟不能代替用户验收；M9 的最终内容与视觉判定由主任务/用户裁决。