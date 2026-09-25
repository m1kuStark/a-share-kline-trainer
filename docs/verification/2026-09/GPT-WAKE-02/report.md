# GPT-WAKE-02 控制器 gpt_direct 自动派发验证记录

2026-09-25 晚。目标：真实端到端演练"控制器自动派发 gpt_direct → pinned Codex 会话完成提交 → 独立验证收据 → verified"。

## 实现范围（全部合成测试先行 RED→GREEN）

- runner config schema v2：可选 `gpt` 段（runner_entry/home/session_id/sandbox/timeout_minutes），v1 兼容；sandbox 允许 workspace-write 与 danger-full-access。
- `run_gpt_job`＋`build_gpt_argv`：镜像 run_job 契约（argv 数组、owned 进程、ORCH_* env、jobs 注册表归属 id/worktree/logPath）；run_codex 新增 `--log`（固定事件日志路径）与 `--add-dir`（沙箱附加可写目录）。
- controller_loop 门：`_gpt_takeover` 在 route=gpt_direct＋next_action=take_over＋policy `gpt_dispatch=true`＋runner config gpt 段**四条件齐备**时自动派发；GPT worker 的 `assessment=continuous_judgment` 合法（其本身就是该路由执行者），不触发 GLM 的 worker_escalation 自升级。
- **新增 `resume --verify-only`**：工作已提交到 expected_commit 而验证未跑（升级/外部中断后）时，操作者显式授权后跳过重派、直接对最后一份报告跑 run_verification＋verify_evidence。全部身份/cleanup/pin/scope 校验与普通 resume 相同。

## 真实演练（合成任务 DRILL-GPT-01，真实 Codex 会话 01a0d79e）

临时 git 仓库：app.py 值为 0、check.py 断言为 1；合同 task_shape=continuous_judgment（路由直选 gpt_direct/take_over）；policy gpt_dispatch=true；runner v2 gpt 段指向真实 run_codex.py 与用户 Desktop 中枢会话。

1. **首轮（workspace-write）**：GPT 被唤醒（355s），改对 app.py、check 通过、按 REPORT 协议写报告——但 **codex 沙箱把 `.git` 保护为只读，git add 无法建 index.lock**；GPT 诚实报告 status=partial＋needs_replan，控制器正确落 waiting_control（no_commit→fault 路径）。结论：执行类派发必须 danger-full-access（与 GLM worker 的 yolo 对位）。
2. **二轮（danger-full-access）attempt 1**：GPT 完成编辑＋**真实提交 fbed6e1**＋check.log 留证；报告完整（facts 带 sha256、observed=fbed6e1），仅因 unexpected_findings 含一条环境备注触发保守升级 → waiting_control。
3. **attempt 2（resume 后同会话续接）**：GPT 确认"已提交、无需重复提交"，未产生新提交 → 控制器 no_commit fault——暴露"工作已提交但验证未跑"时无补验证入口的结构缺口（该缺口先于 GPT 存在，对 GLM 修复同样适用）。
4. **verify-only 补完**：`resume --verify-only --expected-commit fbed6e1b…` → 独立验证通过 → **stage=verified**，收据 verify-2983099a…，tested_commit=fbed6e1b，can_promote=false（语义正确），租约释放。

三轮真实 GPT 调用全部续接同一会话（resumedFrom=01a0d79e…），usage 显示大线程缓存命中 ≈94%（cached 261,212,828 / input 277,159,559 为其中一轮）；GPT 用量无计费基线，只记 provider 计数。

## 测试与门禁

- agent-routing 262 项（252 存量＋10 新增：GPT 配置/argv 契约/派发成功/双旗标缺失等待/verify-only 补验证）、agent-monitor 90 项、docs 0 错误。
- 已验证：派发链路、同会话续接、worker 报告协议、双旗标缺省回退 waiting_control、verify-only 补验证、失败降级（锁忙/超时/注册表不一致走原 fault 路径）。
- 边界：Desktop 持锁时的等待释放（--wait-writer-minutes）在控制器路径未单测；`--output-schema` 结构化决策仍未启用；fork 迁移未实测；成本节省不做宣称。

## 证据

- 演练脚本：`drill.py`（本目录）；控制存储/收据/rollout 原件在仓库外本机留存（`%TEMP%\gpt-wake-drill-*`、`~/.codex/headroom-cache/codex-bridge/`），不入 Git。
- 命令与结果摘录：`evidence.jsonl`（本目录）。
