# M9 录制正常 drain 收尾修复：独立只读审查

裁决：**本次 drain 修复可合入（限定下述文件及字节身份）**。Critical 0 / Important 0 / Minor 0，未发现需要修改的代码问题。此裁决不代表 M9 全范围验收、发布或用户验收。

## 审查范围与身份

- 仓库：`C:/Users/Stark_Du666/.codex/worktrees/m9-enable-01/a-share-kline-trainer`
- HEAD：`f9454fec92017eba74de2904abf9982deb685ab4`；审查对象是其工作树中固定的两文件差异。
- 产品：`web/src/recording/recordingFile.ts`，仅新增两行注释与一行有条件的 `await draining`。
- 测试：`server/test/recording-file.test.ts`，新增 `vi` import 与一个回归用例。
- 产品 SHA256：`1536368e2ba6e080c96d4d18c05ab40aa43cf4f38278c0e826bd0b0c10716180`
- 测试 SHA256：`c6db633a296533d80d0923900f1d6beab7c6b8bcab594318b55ef1e1dfa29da4`
- 固定 diff SHA256：`ba356f535f0a50dab546d623de2c6a289cc2b9812cbb6e914f42a8d368a6e029`
- 已读取根、web、server 的适用 AGENTS 与工作区代码审查规范；快照前后及报告生成时两文件哈希一致。

## 五维审查

| 维度 | 判断与证据 |
| --- | --- |
| 计划对齐 | 变更只修复正常收尾时 readable 尾块可能尚未消费就被 cancel 的问题；没有更改预算、格式、schema 或录制业务数据。产品改动位于 `recordingFile.ts:166-168`。 |
| 代码质量 | 写端 close 成功不表示读端排队数据已被消费；无错误路径先等待 draining，避免 `outReader.cancel()` 丢尾块。条件检查包含 budgetHit、decompressError、inputError，范围明确。 |
| 集成与错误处理 | `recordingFile.ts:87-117` 的三端 interrupt、fatal 唤醒与 `write/close` race 保持原样。已知错误路径跳过新增等待；新增等待期间出现预算或解压错误，draining 仍先置标志并 interrupt，随后 `:179-181` 按原优先级抛错。catch 只消费拒绝，不会把错误变成成功。清理仍逐项触发且不 await，不重新引入 close/abort 悬挂依赖。 |
| 测试真实性 | 新用例 `recording-file.test.ts:480-510` 使用独立生成的 262267 字节原文及真实原生 gzip/decompression；只延迟输出 reader.read 的任务调度，保留真实 write/close/cancel 与解压算法。断言原文长度和全字节相等，并在 finally 还原全局对象。既有预算、损坏、源错误、残余缓冲、粒度与 deadline 断言未删改。 |
| Harness 与收据 | 审查者未运行 App、测试或 build，未改 repo、control、矩阵或 gate 台账。独立读取并核对已存在的 RED、GREEN、调度 probe 和真实长录制 Journey 收据及日志；具体边界见下。主控负责最终 gate-report 与归档。 |

## 错误与取消路径复核

- 预算越界：`budgetHit` 先置位，interrupt 同时触发输出取消、源取消、写端 abort，并使 fatal 拒绝；新增等待不改变预算值，也不推迟发生在读取期间的 interrupt。既有超预算用例仍检查源取消次数与少读。
- 解压损坏或截断：draining 记录 decompressError 并 interrupt；即使发生于新增等待期间，后续仍抛出 gzip 错误。
- 源流或写入/close 错误：inputError 非 null 时不走新增正常路径等待，原清理与错误分类保留。
- 正常关闭：等待输出完成后才 cancel，符合本次问题的必要顺序。未发现标准原生流在 close 已成功且无读端错误时因该等待新增合理挂死条件。

## 核验过的执行证据

1. **真实 RED**：`evidence/test-red/` 的 nativeExitCode=1；新增断言期望 262267，实际 262144，确实缺最后 123 字节。RED 收据对应旧产品 SHA `9ead6891f7b7dd6dd1d0ff85734f94994397228cbdb14ab7024a7b707953c4df`，日志哈希已核对。
2. **file + bundle GREEN**：`evidence/test-green/receipt.json` 原生命令为 `npx.cmd --no-install vitest run --config server/vitest.config.ts server/test/recording-file.test.ts server/test/recording-bundle.test.ts`；nativeExitCode=0，日志明确 2 files / 44 tests passed。收据中的产品与测试 SHA 均与本次固定快照和当前文件一致。
3. **真实两年录制 Journey GREEN**：`run-b8cb3f18-211d-4fd1-a4d3-0dd36ced0af1`，wrapper nativeExitCode=0，wrapper log SHA 一致。`browser-results.json` 为 1 expected / 0 unexpected / 0 flaky / 0 skipped，journey log 明确测试通过。metrics 为 483 steps、974 events、975 checkpoints、restoredCheckpoints=975、unexpectedPageErrors=[]；导出 636120 字节、解压 JSON 4218652 字节，export 462ms、import 374ms、advance p95 104ms。该 run 的 commit 与受审 HEAD 一致。
4. **机制证据**：controlled drain schedule 保留原生解压，只向 read 注入 0/1/5ms 调度等待；旧实现 9/9 短读，候选 9/9 完整且 SHA 匹配。deterministic close queue 仅作辅助机制佐证。

## 证据边界与未执行项

- 原始失败 Journey 的中间解压数组未保留，JSON error offset 不能当实际解压字节数。解码器在 f701 与 f945 的提交文本相同，不能称 pane layout patch 引入了解码回归。
- 无注入 Edge 对照中旧、新实现各组均 20/20 成功；已证实清理顺序存在尾块短读机制并有可重复 RED/GREEN，但没有无注入精确复现原始 Journey 时序。
- 长录制 wrapper 与 run manifest 没有逐源文件 SHA 字段。其直接身份是 commit/run；逐文件字节身份由本审查固定快照、当次 file+bundle 收据和报告生成时的当前哈希核对补充。不能仅凭 commit 声称含工作树修改的运行具有逐文件身份收据。
- 未重新执行任何测试、App 或 build，未审查其他工作树改动，未宣称全套 Journey/打包安装/真实设备/用户验收完成，也未写入 gate 台账或修改矩阵。

没有代码层面的阻断项。若后续两受审文件的字节身份变化，本裁决不自动覆盖新版本。
