# PR #54 Source checks 只读核验

结论：Source checks run `44152821795`、attempt 1 已 completed / success。required `docs`、`verify`、`pr-policy` 全部 SUCCESS，3 个 job 无失败步骤。

- PR head：`a7df3f800a838746a2d4509cc3ca96e005bec121`。
- CI 实际 checkout：`893b1aa437a42a04d865311f0410f3647f64da13`，即上述 head 与 base `df6cedd82fa3fe591615724259f83d16f6bb70fa` 的 GitHub PR 合并测试提交。
- 同次 CI npm test：server 188 文件 / 2664 测试，desktop 34 文件 / 369 测试，全过，共 3033。未发现失败套件、Actions error 标记或测试重试。
- 故障注入用例预期 stderr（下载中断、SHA 不匹配、假更新源 404）及堆栈保存在原始日志，没有误判为 CI 失败。

原始 JSON 字节见 `*.raw.json`，原始 GitHub logs ZIP 见 `run-logs.zip`；32 个原始日志条目解码至 `logs/`。9 份 CLI 收据、stdout/stderr 和所有条目哈希见 `result.json` / `evidence-inventory.json`。ZIP 原始 103033 字节，SHA256 `e1db95d32f43ec992ca74cc8bb330844629c2064b66e4889407532ca29e507ef`，CRC 检查通过。

仅执行 gh pr view/checks、gh api GET 与 gh run watch（60 秒间隔）；未 push、merge、重跑 CI 或修改仓库/control/矩阵。
