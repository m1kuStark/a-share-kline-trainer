# V1.2.7 首次配置受控重启修复验证

候选工作树：主检出 main（基于 f6eeaab）。本记录描述工程自验，不代表用户验收。

## 用户反馈（2026-10-03）

从 GitHub 下载 v1.2.6 release 包到全新目录（D:\MySoftWares\kline-trainer-v1.2.6-windows-x64），从零模拟真实用户首配通达信目录，出现"配置超时"。

## 根因（现场证据 + 本地复现双重确认）

- 现场（用户包 data/setup-restart-status.json）：重启尝试 14:31:58 创建后 phase 永远停在 `preflight`，`updatedAt` 与创建时刻相同——监管进程从未推进任何阶段；前端 120×700ms 轮询耗尽后报"重启确认超时：服务可能仍在切换"。
- 手动运行 `node launcher.cjs --setup-restart-attempt <path>` 捕获崩溃：`The "paths[0]" argument must be of type string. Received undefined`。
- 断链点：`main()` 把 parseArgs 的 `restartAttemptPath` 键透传给 `runSetupRestartAttempt`，而函数读 `options.attemptPath` → `resolve(undefined)` 启动即崩。
- 为什么测试没拦住：release-launcher 全部 49 例**直调函数**注入 `attemptPath`，从未经 CLI 装配层（main 的参数转换）——真实链路（服务端 spawn → 命令行 → main）自 SETUP-01 交付起就没有测试覆盖。spawn 使用 `stdio:'ignore'`，崩溃输出无处可看，加剧了盲区。

## 修复

1. `main()` 传参补字段映射：`{ ...parsed, attemptPath: parsed.restartAttemptPath, env }`。
2. main 外层 catch 对 supervisor 场景写终态兜底：读 attempt 文件拿 dataDir → 状态写成 `phase:'failed', done:true`，reason 引导"重新打开训练器即可使用新目录"——任何早期崩溃页面都能拿到明确结果而非超时。
3. 测试补盲：新增两条 CLI 装配层用例（`node launcher.cjs --root <fixture> --setup-restart-attempt <path>`）：①完整链 reaches ready（老服务 drain→新服务就绪→状态 ready→state 文件新 runId）；②attempt 校验早期失败→终态兜底写入。makeFixture 补拷 restart-plan.js（CLI 无法像直调那样注入 planModule）。

## 验证

| 检查 | 结果 |
|---|---|
| release-launcher.test.ts（49 存量＋2 新增 CLI 装配层） | 51/51 |
| 真实包端到端：v1.2.6 包＋修复版 launcher，清 data 全新首启 → save-choice 200 → apply 202 → 轮询 `phase=ready done=true`，新服务 runId 更换、`/api/env` tdx.connected=true source=saved-choice stockCount=5908 | PASS |
| 修复前同链路（v1.2.6 原 launcher） | 复现崩溃：preflight 永久卡住（用户现场一致） |

## bug 回流反思

- 用户发现而非测试覆盖的原因：CLI 装配层（main 参数转换）零覆盖——受控重启测试从函数层写起，恰好绕过了真实入口；且 spawn `stdio:'ignore'` 吞掉崩溃输出，现场也没有 supervisor 日志。教训：进程边界（spawn/CLI）必须有至少一条穿透装配层的端到端测试；后台进程的早期崩溃要落盘可见。
- 兜底语义顺带修复："保存的目录未自动生效，重新打开训练器即可使用"——即使未来再出早期崩溃，用户也有可行动指引而不是超时。

## 未决事项

- 用户对 v1.2.7 包的验收（重点：从零首配→保存→自动切换到已连接状态）。
- v1.2.6 release 已撤下（该包首配必触发本缺陷）；tag v1.2.6 保留作历史。
