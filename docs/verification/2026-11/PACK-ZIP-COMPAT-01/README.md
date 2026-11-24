# PACK-ZIP-COMPAT-01 Windows ZIP 解压

主线原提交 fe09897 的新 [对照 run](https://github.com/m1kuStark/a-share-kline-trainer/actions/runs/45356744413) 与 [#53 run](https://github.com/m1kuStark/a-share-kline-trainer/actions/runs/45064742523)、[#57 run](https://github.com/m1kuStark/a-share-kline-trainer/actions/runs/45064696398) 均报 `Expand-Archive : Cannot find an overload for "ExtractToDirectory" and the argument count: "3".` 主线无需改 npm 依赖即可触发。#57 的设置用例 5000ms 超时是另一现象，本任务不放宽设置断言。

本机 Windows PowerShell 5.1.26100.9818 / Archive 1.0.1.0：只有 String/String 与 String/String/Encoding 两个解压方法；未修改主线的两个套件 32/32 通过。已有模块版本及远端错误与本机是否通过分开记录。新测试用不兼容 cmdlet 替身重现红灯，真实 powershell.exe 和真实 ZIP 验证解压路径、文件内容和禁止覆盖。在写任何目标文件之前按方法签名取兼容路径，不 catch 重试部分解压，不关闭条目名称/输入 ZIP 身份校验，不增加依赖、不改上游压缩工具及原有断言。

候选 `3073281` 以 JSON reporter 独立复跑：2 文件，33 passed / 0 failed / 0 pending，原生退出 0；新增 Windows 解压/拒绝覆盖用例 status=passed。命令、被测提交与本地原始报告 SHA256 见 [收据](green-receipt.json)。
