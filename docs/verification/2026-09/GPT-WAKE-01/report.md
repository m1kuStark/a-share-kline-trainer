# GPT-WAKE-01 会话中枢桥验证记录

2026-09-25。目标：验证"程序化唤醒 Codex 续接同一会话"的完整链路，并交付 `scripts/agent-monitor/run_codex.py`。真实调用共 6 次（1 次自建会话首询、2 次续接验证、2 次工具端到端、1 次并发竞态的胜者），另有 3 次零消耗失败路径（版本偏斜、写入者冲突、报忙路径）。全部调用 read-only 沙箱，测试消息均自标识为桥路测试。

## 实测事实

1. **CLI 自建会话续接成立**：临时目录首询"记住暗号：青龙"→ 回答"收到"；`exec resume <thread-id>` 追问暗号 → 回答"青龙"。同一 rollout 文件由 14 行追加到 23 行，会话内上下文继承成立。
2. **缓存命中实测**：续接轮 usage `input_tokens=95841, cached_input_tokens=69096`（≈72%）；工具链路轮 `208328/146512`（≈70%）。单会话续接的共享前缀缓存论点成立。
3. **stdout 块缓冲与无超时**：`codex exec --json | tail` 在 task_complete 落盘后仍不吐 EOF，MSYS `timeout 150` 杀不掉进程树 → 工具改为文件重定向 + 进程句柄监督 + deadline/taskkill。
4. **写入者锁（关键约束）**：并发两个 resume 同一线程，第二个初始化即失败 `already has an active writer`（-32600，模型调用前零消耗）；**Desktop 打开的会话持续持锁**（空闲 30s 稳定窗口后仍冲突）。工具以退出码 3 报忙，`--wait-writer-minutes` 可等待释放。
5. **版本偏斜**：Desktop 写入 0.155.0-alpha.16.4 的线程在 npm CLI 0.145.0 下 resume 报反序列化失败；`npm i -g @openai/codex@latest` 升 0.157.0 后可读。桥工具要求 CLI ≥ Desktop 写入版本。
6. **归档线程**：`is archived` 显式报错，`codex unarchive` 可恢复（未执行，保留用户现场）。

## 工具验收

- 单测 `scripts/agent-monitor/test_run_codex.py` 9/9（假 codex.cmd 夹具，不调模型）：argv 契约（旗标在 resume 之前、stdin 传 prompt）、注册表（id/worktree/logPath/sessionId）、锁冲突退出 2、超时杀树退出 4、writer 忙退出 3、pin 发现、无 pin 干净失败、事件解析。
- 套件回归：agent-monitor 87/87（78 存量＋9 新增），agent-routing 252 项（3 平台跳过），目标 TS 47/47，`docs:check`/`docs:status -- --check` 0 错误。
- 真实端到端：`pin` 发现临时会话 → `wake --batch TOOL-E2E` 22.11s 完成，回答"工具正常"，注册表 `~/.codex/headroom-cache/codex-bridge/jobs/TOOL-E2E.json` 落盘。
- 报忙路径：对 Desktop 打开中的会话 `wake --batch TOOL-BUSY` → `writerBusy:true`，12.06s 失败退出码 3，零模型消耗。

## 边界（未验证/未实现）

- ~~Desktop 等待释放后的自动唤醒~~ **已验证（2026-09-25 晚，用户关闭 Desktop 后）**：`wake --session-id 01a0d79e… --batch DESKTOP-WAKE-01 --wait-writer-minutes 3` 直接成功——锁随 Desktop 关闭释放，GPT 在同一会话回答"桥路正常"，50.22s，退出码 0；该轮 usage `cached_input_tokens=259145319 / input_tokens=272610592`（≈95% 缓存命中，大线程续接的成本优势进一步证实）。
- `--output-schema` 结构化决策回复未实测（首版 wake 未启用，决策契约在 GPT-WAKE-02 接控制器时一并验证）。
- 控制器 gpt_direct 自动派发未接线（GPT-WAKE-02）；当前控制器遇强模型升级仍 waiting_control。
- fork 迁移路径（Desktop 持锁时的替代）仅核对 `codex fork --help` 存在，未实测。
- GPT 用量计费无基线，本记录只报告 provider 返回的 token 计数，不做成本换算。

真实命令与输出摘录存于本目录 `evidence.jsonl`；临时会话 rollout（01a0d88b）与注册表原件在 `~/.codex` 本机留存，不入 Git。
