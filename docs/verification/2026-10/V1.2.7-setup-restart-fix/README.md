# V1.2.7 首次配置受控重启修复验证

候选工作树：主检出 main（基于 f6eeaab）。本记录描述工程自验，不代表用户验收。

## 用户反馈（2026-10-03）

从 GitHub 下载 v1.2.6 release 包到全新目录（D:\MySoftWares\kline-trainer-v1.2.6-windows-x64），从零模拟真实用户首配通达信目录，出现"配置超时"。

修复后的 v1.2.7 包在 `D:\MySoftWares\kline-trainer-v1.2.7-windows-x64` 中复现了第二层故障：监管重启已将状态推进到 `phase=ready`、`done=true`，但 Edge 轮询 `/api/setup/restart-status` 连续收到 401，页面仍显示"重启确认超时"。现场服务 PID 为 27872，`data/server.log` 保留了该请求证据。

## 根因（现场证据 + 本地复现双重确认）

- 现场（用户包 data/setup-restart-status.json）：重启尝试 14:31:58 创建后 phase 永远停在 `preflight`，`updatedAt` 与创建时刻相同——监管进程从未推进任何阶段；前端 120×700ms 轮询耗尽后报"重启确认超时：服务可能仍在切换"。
- 手动运行 `node launcher.cjs --setup-restart-attempt <path>` 捕获崩溃：`The "paths[0]" argument must be of type string. Received undefined`。
- 断链点：`main()` 把 parseArgs 的 `restartAttemptPath` 键透传给 `runSetupRestartAttempt`，而函数读 `options.attemptPath` → `resolve(undefined)` 启动即崩。
- 为什么测试没拦住：release-launcher 全部 49 例**直调函数**注入 `attemptPath`，从未经 CLI 装配层（main 的参数转换）——真实链路（服务端 spawn → 命令行 → main）自 SETUP-01 交付起就没有测试覆盖。spawn 使用 `stdio:'ignore'`，崩溃输出无处可看，加剧了盲区。
- 第二层根因：Chromium 对同源 GET 可以省略 `Origin`，但会带 `Sec-Fetch-Site: same-origin`。控制守卫旧规则把所有无 `Origin` 请求都按本机助手处理，要求控制令牌；前端轮询没有该令牌，因此服务端已经 ready，浏览器仍只能收到 401。

## 修复

1. `main()` 传参补字段映射：`{ ...parsed, attemptPath: parsed.restartAttemptPath, env }`。
2. main 外层 catch 对 supervisor 场景写终态兜底：读 attempt 文件拿 dataDir → 状态写成 `phase:'failed', done:true`，reason 引导"重新打开训练器即可使用新目录"——任何早期崩溃页面都能拿到明确结果而非超时。
3. 测试补盲：新增两条 CLI 装配层用例（`node launcher.cjs --root <fixture> --setup-restart-attempt <path>`）：①完整链 reaches ready（老服务 drain→新服务就绪→状态 ready→state 文件新 runId）；②attempt 校验早期失败→终态兜底写入。makeFixture 补拷 restart-plan.js（CLI 无法像直调那样注入 planModule）。
4. 控制守卫按 `Origin` 或 Fetch Metadata 进入浏览器路径；无 Origin 且 `Sec-Fetch-Site: same-origin` 的同源 GET 可读取重启状态，无 Fetch Metadata 的无 Origin 请求仍要求助手令牌，跨站 Fetch Metadata 仍返回 403。

## 验证

| 检查 | 结果 |
|---|---|
| release-launcher.test.ts（49 存量＋2 新增 CLI 装配层） | 51/51 |
| setup-control-guard.test.ts | 17/17 |
| setup-onboarding.test.ts | 17/17 |
| 真实包端到端：v1.2.6 包＋修复版 launcher，清 data 全新首启 → save-choice 200 → apply 202 → 轮询 `phase=ready done=true`，新服务 runId 更换、`/api/env` tdx.connected=true source=saved-choice stockCount=5908 | PASS |
| 修复前同链路（v1.2.6 原 launcher） | 复现崩溃：preflight 永久卡住（用户现场一致） |

完整 `npm test`（2026-10-03，退出码 1）为 103 个测试文件通过、11 项失败。失败均为本次改动之外的既有基线或运行环境干扰：训练规则迁移旧字段断言 2 项、录制 compact/replay/file 旧兼容断言 6 项、当前人工验收服务占用 8787 导致启动器端口回退测试 2 项、文档 review-profile 临时夹具 1 项。守卫与首配接口定向回归仍全部通过；该结果不作为用户验收结论。

## 修复候选包（已获用户验收）

- 包目录：`D:\MySoftWares\kline-trainer-v1.2.7-windows-x64-fix`
- ZIP：`kline-trainer-v1.2.7-windows-x64.zip`
- 源码提交：`21808875cffd9abba6d398cf252f42516e739885`
- ZIP SHA256：`28d1a0ec7f076d838d80ab694e15510d1673eb196ba833469641776255cb4442`
- `scripts/release/verify.mjs`：7,182 个文件检查通过，manifest 一致。
- 包内运行时探针：Node v24.15.0；独立端口 8799；无 `Origin` + `Sec-Fetch-Site: same-origin` 的 `/api/setup/restart-status` 返回 200，`phase=ready`、`done=true`。

上述候选包已由用户完成从零首配复现并确认通过。由于随后补充了用户文档，公开 Release 会基于最终文档提交重新构建；验收结论见 [v1.2.7 用户验收记录](../V1.2.7-user-acceptance/README.md)。

## bug 回流反思

- 用户发现而非测试覆盖的原因：CLI 装配层（main 参数转换）零覆盖——受控重启测试从函数层写起，恰好绕过了真实入口；且 spawn `stdio:'ignore'` 吞掉崩溃输出，现场也没有 supervisor 日志。教训：进程边界（spawn/CLI）必须有至少一条穿透装配层的端到端测试；后台进程的早期崩溃要落盘可见。
- 兜底语义顺带修复："保存的目录未自动生效，重新打开训练器即可使用"——即使未来再出早期崩溃，用户也有可行动指引而不是超时。

## 历史说明

- 用户已完成 v1.2.7 包验收（重点：从零首配→保存→自动切换到已连接状态）。
- 最终公开包会在文档提交后重新构建，公开提交、资产和 SHA256 以发布记录为准。
- v1.2.6 release 已撤下（该包首配必触发本缺陷）；tag v1.2.6 保留作历史。
