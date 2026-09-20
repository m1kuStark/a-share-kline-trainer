# M3公开发布合同

2026-09-21用户明确通过M3及本轮录制回放验收，授权打包、快捷入口和GitHub开源。当前按v0.3.0阶段版交付，不将M4/M5业务功能混入打包任务。

## 发布目标

- Windows x64 ZIP，内置官方Node24运行时，解压后不需npm/Python或管理员权限。双击Start.cmd启动，Create Shortcut.cmd创建桌面图标。现有用户使用同7529和原库，公开包默认127.0.0.1:8787。
- GitHub新公开仓库拟定m1kuStark/kline-trainer；原a-share-kline-trainer私有开发历史保留。公开快照由集成人白名单导出，不含真实行情、用户库、会话日志、凭据、私有过程报告。
- MIT原创代码许可，保留来源组件许可证；打包说明和第三方许可由集成人最终核对。tdx数据由使用者本机提供，只读。

## 固定接口与所有权

REL-LAUNCH仅写scripts/release/launcher.cjs、Start.cmd、Create Shortcut.cmd、create-shortcut.ps1、trainer.config.example.json，及server/test/release-launcher.test.ts。launcher.cjs为Node无第三方CJS脚本，releaseRoot由脚本所在目录（打包时置包根）；源码开发可传--root PATH。使用release.json确认appId=a-share-kline-trainer，server/dist/index.js、web/dist、runtime/node.exe固定结构；运行无shell拼接，生产仅127.0.0.1。根负责图标assets/trainer.ico和release.json。

可选--config PATH或根目录trainer.config.json。设置字段tdxRoot（空则查常见TDX目录）、port（默认8787）、dataDir（默认用户目录.a-share-kline-trainer）、databasePath（可选绝对路径），不将用户配置覆盖到示例。日志/ready/state/启动互斥锁在dataDir，不在只读包内。稳定origin保留浏览器录制；端口冲突报清楚不自动换端口、不杀未知进程。重复点击仅复用本app/runId/PID健康服务并打开浏览器，不生第二份写库。no-open参数可验证无浏览器副作用。Node以detached+无IPC运行服务，健康probe验证ready身份，限时等待；失败输出日志可定位，不能静默假成功。只清自己的锁，恢复遗留锁时核验PID。打包脚本将本文件组拷到包根。

REL-PACK仅写scripts/release/build.mjs、server/test/release-package.test.ts、docs/engineering/release-build.md。build.mjs接受--node-archive PATH --node-checksums PATH --out DIR，以当前干净提交独立buildRun production构建，不写原dist/用户库。Node官方node-v24.15.0-win-x64.zip（版本可从包名提取但必须24主版本）、SHASUMS256.txt均由根预下载，本地SHA256精确验证，失败不使用。写新建staging目录，包含runtime/node.exe+NodeLICENSE，server/dist、web/dist、生产node_modules（本地npm ci --omit=dev --ignore-scripts，不复制工作树node_modules）、根package.json版本与type、release.json、启动文件、assets/trainer.ico、LICENSE/THIRD-PARTY-NOTICES、用户README。不包含TDX/DB/env/git/测试/GLM工具。生成.zip、SHA256SUMS、文件清单release-manifest.json。允许新目录原子产物，禁止递归清理out根或其他工作区，重复产物报错。build.mjs单次输出清楚路径，测试覆盖白名单/校验和/clean要求，不生成镜像测试。root负责package.json脚本及真实clean-room验收。

REL-DOC仅写README.md、docs/user/README.md、docs/user/install.md、docs/user/recording.md、docs/user/troubleshooting.md、CONTRIBUTING.md、SECURITY.md。面向普通下载者：明确无需订阅或模型、不含市场数据、Windows版本下载+解压+Start.cmd、Create Shortcut.cmd、配置示例字段、通达信下载日线及复权文件、不自动下载、localhost、浏览器录像与数据库区别及备份、升级保留dataDir/端口/浏览器，不承诺未实现排行/设置。源码npm ci/build/start，Node24/npm10+；正确信息以代码为准。版本v0.3.0 GitHub上述URL，准确明示链接将由root建release。MIT由root提供，文档不替代确认许可证来源。不要拷私人路径或交易截图，README≤建议长度，可分层路由。

REL-01集成人负责所有共享合约、版本、LICENSE/thirdparty、public源码导出、GitHub发布、desktop安装、严格候选+包实测以及状态记录。worker不push、不改共享package/lock，不碰7529个人实例。三路GLM5.3Flash max，用户已确认配置正确，使用更新后的runner；运行者写库隔离，完成后串行合并，不以模型自报替代验证。

## 集成审查补充

2026-09-21：REL-LAUNCH增加`Stop.cmd`和`--stop`，必须验证记录的本机服务身份、与启动互斥，保留数据库/日志；存活但身份不可验证的服务不得清除状态后再创建第二写者。复用核对数据库和构建版本，版本变更先停旧服务。REL-PACK须保留`docs/user`层级、复制CONTRIBUTING/SECURITY及third-party完整声明、增加Stop.cmd，发布禁止并发覆盖，产物标记的SHA必须与实际源码一致。公开ZIP从已提交的公开快照构建，使录制中的构建SHA可在公开仓库定位。

REL-SMOKE独占scripts/release/verify.mjs、server/test/release-integrity.test.ts与自己的任务卡。它只核对实际解压内容的清单、散列、元数据及本地文档链接，不能代替主代理启动/停止/浏览器检查，也不能证明数字签名或来源真实性。
