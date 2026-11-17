# PR #54 CI 与合并证据归档

2026-11-18，将已核验的 CI 缓存完整复制到 [ci-capture](ci-capture/README.md)，共 77 个文件、789176 字节。每个源文件与归档文件均按字节比较并复算 SHA256，结果见 [copy-receipt.json](copy-receipt.json)；原内容和历史路径字段保持不变，本入口提供仓库内的相对路径。

## CI 对象与结果

[Source checks run 44152821795](https://github.com/m1kuStark/a-share-kline-trainer/actions/runs/44152821795) 的 attempt 1、`pull_request` 运行已 completed / success；required `docs`、`verify`、`pr-policy` 全部 SUCCESS。单次 CI `npm test` 的 server 为 188 文件、2664/2664，desktop 为 34 文件、369/369，共 3033 项。未发现失败套件、Actions error 标记或测试重试。

- PR head：`a7df3f800a838746a2d4509cc3ca96e005bec121`。
- CI 实际 checkout：`893b1aa437a42a04d865311f0410f3647f64da13`，由上述 head 与 base `df6cedd82fa3fe591615724259f83d16f6bb70fa` 生成的 GitHub 临时 PR 合并提交。
- 9 组原始 CLI stdout/stderr/收据、7 份原字节 JSON 别名和 32 个日志条目见 [原核验结果](ci-capture/result.json) 与 [原清单](ci-capture/evidence-inventory.json)。初始 required 快照中 verify 仍 pending；成功结论依据 final 快照。
- [GitHub 原始日志 ZIP](ci-capture/run-logs.zip) 为 103033 字节，SHA256 `e1db95d32f43ec992ca74cc8bb330844629c2064b66e4889407532ca29e507ef`；与原始下载 stdout 字节一致，32 个条目的 CRC 通过。

下载中断、SHA 不匹配、假更新源 404、不可用收藏库等通过用例的故障注入 stderr 与堆栈完整保留。历史 Headroom `--stats` 的 `KeyError: 'files_represented'` 属本地压缩辅助错误，只在原会话中留存，无独立原生收据；本归档不补造该收据，也不把它计入 CI 失败。

## 实际合入

[PR #54](https://github.com/m1kuStark/a-share-kline-trainer/pull/54) 的新只读查询确认状态 MERGED，合入时间 `2026-11-17T19:01:39Z`，即北京时间 2026-11-18 03:01:39。实际 main 提交为 `58ba0ffc13458fb136c7d885b62ee0c898d4bab8`，tree 为 `20d02c33e84ec9a5f945053051f97e3b84c69088`，单一父提交为上述 base。该 main 提交与 CI 临时合并提交分别记录，未把测试对象改写为归档后的提交。

原始查询及其命令、时间、原生退出码、字节数与哈希见 [PR 查询收据](merge-evidence/pr-merged.receipt.json)、[合并提交查询收据](merge-evidence/merge-commit.receipt.json)。缓存内旧 PR JSON 的 OPEN 是合入前快照，保留原值。

## 归档边界

归档开始时本地 HEAD 为 `3ec3d730a477ca305566eda28a6b1ddc190e2262`。只新增本目录并追加上级验证入口；未运行产品测试、浏览器、Windows 包、录像回放或用户验收。M9 统一候选的后续门禁仍由 `M9-ENABLE-01` 接续。归档校验与文档门禁的原始输出和即时退出码保存在本目录 `checks/`，最终范围与文件哈希见 [archive-result.json](archive-result.json)。

## 原字节存储转换

提交 hook 拒绝原日志的尾空格后，13 个文本文件改存为原路径追加 `.raw.b64` 的 Base64 文件，共保留 386539 个原始字节，未修剪空白。[storage-conversion.json](storage-conversion.json)逐项记录原路径、实际存储路径、编码、原始/存储 SHA256 与验证依据；[copy-receipt.json](copy-receipt.json)保留转换前复制事实。[转换前 ZIP](storage-conversion-preimage.zip)保留这 13 项原字节、旧清单及旧校验脚本。12 项 CI 日志同时核对原缓存，检查生成的 stdout 则核对旧清单和转换前 ZIP；全部解码同哈希、ZIP CRC 通过后才删除原文本副本。GitHub 原始日志 ZIP 未变，校验脚本按映射解码后继续检查原字节。
