# M9 Windows ZIP用户验收入口

当前为v1.3.8验收候选，被测提交C2为`35729e4ac28696fc174a12e6cef6d1e9b0944f2b`，PR55集成I为`2e3704f2b3ddae6c5774b27ab085aea7467fe1b2`。完整候选、同提交ZIP/CMD/实包与主代理UI检查通过；工程证据、历史失败和限制见[工程交接](../verification/2026-11/M9-ENABLE-01/engineering-handoff.md)。用户验收和发布仍未发生。

交付目录：

```text
D:/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer/output/acceptance/M9-ENABLE-01-20261118-35729e4
```

包名`kline-trainer-M9-ENABLE-01-v1.3.8-35729e4a-windows-x64.zip`，177,793,959字节；SHA256：

```text
a4858eab49ef603aa3e636c0790d591b29e1dc7f8ca40e7ff66c2a66b538c5a0
```

按同目录`用户验收指南.md`核对哈希，完整解压到可写目录，双击`Start-Acceptance.cmd`。训练、公式、录像位于该解压目录的独立`.acceptance-data`，保留整个目录后可由同入口重开。请重点体验公式启停保存、密集主副图、导出导入回放及重启持久化，并确认指南列明的回放限制。NSIS安装/覆盖升级尚未验证，本轮使用ZIP。

用户决定另记acceptance_ref；本次报告E仅补证据/任务元信息并继承C2工程结果，最终SHA/PR另记仓外交付回执。本页不授予tag、Release、上传或更新feed许可。
