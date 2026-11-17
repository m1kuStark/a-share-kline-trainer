# 前置取消测试 PR 的 CI 记录

PR51 head `50dde90836d2121ddff84eeed146b94e44198822`，Source checks run `44134386620`。第一次verify原生exit1：server 2653 passed / 1 failed，失败为未改动的 `server/test/settings-app.test.ts:57`，默认5000ms超时，未出现值断言错误。该次取消回归通过；desktop未由该失败后的命令执行。docs和pr-policy通过。

完整 `gh run view --log-failed` 输出以 `first-verify.raw.b64` 可逆保存，解码后的SHA256为 `015636e1ff38894470b9df8b11d81e92a9a5514fd505d85e304b3b357665206d`。PowerShell可用 `[IO.File]::WriteAllBytes($out,[Convert]::FromBase64String([IO.File]::ReadAllText($in)))` 解码。最初取测试JSON artifact返回 `no valid artifacts found to download`，没有以缺失artifact推测结果。

原配置单文件诊断 `npx vitest run --config server/vitest.config.ts server/test/settings-app.test.ts --reporter=verbose` 原生exit0、9/9；原超时例用时38ms，见 `settings-isolated.txt`。没有改该文件、配置或5000ms预算；隔离绿不覆盖第一次CI失败。

对同一个head仅重跑一次失败job，attempt2于2026-11-18 01:27:35 +08完成成功：完整server 188文件/2654项、desktop34文件/369项通过，docs/pr-policy也成功。完整日志以 `attempt2.raw.b64` 保存，摘要/原始与编码指纹见 `attempt2.json`。该结果不改写首轮失败；当前不能确定首次超时的根因。PR51已合入 `f4bbc6af283562c8d567918fb4a59f3f51d71ffe`，不代表M9候选或用户验收。
