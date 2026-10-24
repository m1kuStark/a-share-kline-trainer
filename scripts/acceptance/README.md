# BUILDER-ACCEPT-01 本地验收脚本

`history-v127.mjs` 接收经 SHA256 校验的 v1.2.7 包根与冻结 TDX 样本，所有写入限于新建的 `.runs/history-v127-*`。通过真实旧启动器/API 产生历史，调用交付导出工具和桌面生产导入函数验证合并、字段保留和幂等；结果写入任务证据目录。此脚本不替代 Electron 包内验证。

`Start-Acceptance.cmd` 与 `.ps1` 随独立验收 ZIP 放在根目录。运行对象是 `app/` 内桌面程序；训练数据、浏览器录像存储和应用缓存位于 `.acceptance-data/`，固定端口记录在其中。行情只读 `sample-market/`。这份包装只供本地验收，正式 NSIS 分发形态不变。

`packaged.mjs` 对交付目录运行真实 Electron，核对 userData/appData、买入结算、双主题报告、旧历史合并、重复导入和正常退出。`old-ui-to-electron.mjs` 进一步通过真实 v1.2.7 UI 生成录像，在同浏览器 origin 导出，再经交付的一键暂存函数由实际桌面启动消费历史与录像。原生工具文件选择和 NSIS 安装界面不在脚本覆盖内。

`zip-smoke.ps1 -ExtractedPackage <path>` 只允许 `.runs/` 下的全新解压目录。经真实 `Start-Acceptance.cmd` 启动，核对可见窗口、进程/health 身份、数据库与 Chromium profile 路径，再原生关窗验证进程退出，写独立收据。它不覆盖已有验收数据。

验收详情见[任务证据](../../docs/verification/2026-10/BUILDER-ACCEPT-01/README.md)。
