# M9 C2 验证证据副本

本目录只收录必要的 Markdown/JSON 索引与小证据副本。被测试源码为 35729e4ac28696fc174a12e6cef6d1e9b0944f2b，tree 为 b669e42987324fe527b2b48677ac66a78ad8c252；完整候选 run 为 run-f3c3ca72-e6e3-424d-bc0f-3665c11ff253。

主代理另行报告的 GitHub 集成提交为 2e3704f2b3ddae6c5774b27ab085aea7467fe1b2。这里保留对 C2 的证明，不表示完整测试过集成提交或后继文档提交。result.json 中的集成、证据与用户验收字段值保持归档时的内容。

为便于 Git 收录，9 个 JSON 副本只将 CRLF 换行规范为 LF，没有重排或重新序列化 JSON；另外 4 个已有 LF 的文件保持原字节，包括 proof、verification、manifest 和 root-binding。[复制来源记录](copy-provenance.json)逐件列出源路径、原始及本目录字节数与 SHA、转换方式，并记录实际 JSON.parse 后的深比较结果。13 个副本的解析值均与源文件一致，仓外源文件未改。

本目录 file-manifest、result、preflight 和 binding 内嵌的源 SHA 指向历史原始文件或归档字节，不代表经过 LF 规范的 Git 副本；核对本目录副本请用 copy-provenance.json 的 published 字段。需要原始字节时，使用该记录的 sourcePath 或仓外正式归档。

| 入口 | 内容 |
|---|---|
| [原候选证明](tested-candidate-proof.json) | 原字节副本，保留 schema、提交、run 及原路径，不重新生成结论 |
| [原 run manifest](tested-candidate-manifest.json) / [原 verification](tested-candidate-verification.json) | 保持原字节的同轮运行身份及验证记录 |
| [UI 记录](manual-ui.json) / [root-binding](root-binding-check.json) | UI JSON 已规范 LF；root-binding 保持原字节；20 张原截图保存在仓外证据 ZIP 中 |
| [调用参数](candidate-invocation.json) / [隔离回执](candidate-isolation.receipt.json) / [native 退出回执](candidate-native-exit.receipt.json) | 完整候选运行的外层观测副本，已规范 LF |
| [归档结果](retained-archive/result.json) / [源文件清单](retained-archive/file-manifest.json) | 已规范 LF；记录原始来源、源 SHA、失败及复跑角色、外部引用与适用范围 |
| [归档 native 回执](archive-execution/archive-v3.native.receipt.json) / [Preflight native 回执](archive-execution/preflight-v3.native.receipt.json) / [Preflight 输出](archive-execution/preflight-v3.stdout.json) | 已规范 LF 的真实执行观测副本；stdout/stderr 日志留在原执行目录 |

原 proof 的 SHA256 为 a8c1e40aceb993926e988fabfc3624797e3fd41c69ad48132701d88ce9f25090。

正式 retained archive 保留于仓外：

    C:/Users/Stark_Du666/.codex/headroom-cache/M9-35729e4-retained-archive/

其中 evidence.zip 为 10,749,387 字节，SHA256 为 de777837c746e80cecfd8a55d3c5a7b9e595ba9aa27e33d7a7d4aa331948395f；518 个原小证据条目已按仓外原 file-manifest.json 逐条读取并核对 SHA。该目录的 ZIP、SHA sidecar、README、result 和 file-manifest 原件保持完整。大包和 trace 仍按原清单引用外部原件。原执行 stdout/stderr 保留于同级 M9-c2-archive-execution/，root-binding stderr 保留于 M9-final-run-35729e4/。

最初的仓内 ZIP/log/sha256/原 README 副本已按主代理要求移出提交范围，仅删除本轮新建且经核对的副本，正式源文件未删除或修改。旧复制回执与后继范围调整回执均保存在仓外。

本次只复制和规范历史证据的文本换行，没有重跑产品或改变原结果。原绝对路径属于运行时环境；读者应从本页的小证据入口、复制来源记录和源文件清单追溯。个人 DB、浏览器 profile 与原始 TDX 字节未收录。工程验证、归档完整性、用户验收和发布分别成立；本页不新增用户验收或发布许可。
