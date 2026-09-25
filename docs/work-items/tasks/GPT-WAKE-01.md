# GPT-WAKE-01 会话中枢桥（run_codex.py）

```json
{
  "id": "GPT-WAKE-01",
  "title": "会话中枢桥：程序化唤醒 Codex 续接同一会话",
  "owner": "integrator",
  "state": "review",
  "milestone": "DEV",
  "summary": "run_codex.py 交付：pin/list/wake 三命令，read-only 默认沙箱、写入者锁检测与等待、超时杀树、jobs 注册表与 controller 归属契约兼容；真实链路验证续接成立且缓存命中约 70%，Desktop 打开会话的写入者锁为硬约束。",
  "next_action": "User acceptance; GPT-WAKE-02 接控制器 gpt_direct 自动派发。",
  "allowed_paths": [
    "scripts/agent-monitor/run_codex.py",
    "scripts/agent-monitor/test_run_codex.py",
    "docs/engineering/codex-cli.md",
    "docs/engineering/README.md",
    "docs/engineering/model-delegation.md",
    "docs/work-items/tasks/GPT-WAKE-01.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-09/GPT-WAKE-01/**"
  ],
  "depends_on": ["GLM-MONITOR-02"],
  "base_commit": "c0dc93f",
  "docs_impact": {
    "reason": "用户新授权补齐强模型自动唤醒链路（2026-09-25 会话内拍板）；不重开已关闭的 ORCH 阶段，挂 DEV 里程碑循 GLM-MONITOR-02 先例，控制器接线归 GPT-WAKE-02。",
    "update": ["docs/engineering/codex-cli.md", "docs/engineering/README.md", "docs/engineering/model-delegation.md"]
  },
  "verification_refs": ["docs/verification/2026-09/GPT-WAKE-01/report.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 背景与用户拍板

- 2026-09-25 用户明确协作拓扑：**GPT 只保留一个 Codex Desktop 会话**（上下文继承、缓存命中、降强模型成本），GLM 以量取胜多路并行；本任务补上"GLM 唤醒 GPT"缺失的桥。
- ORCH 阶段保持关闭；本任务与后续 GPT-WAKE-02 属于按需的边界内工程，不再扩建编排平台。

## 交付

- `scripts/agent-monitor/run_codex.py`：`pin`（发现/指定中枢会话并稳定窗口校验）、`list`（session_index＋cwd 过滤）、`wake`（stdin 喂 prompt → `codex exec -s read-only … resume <sid> - --json -o` → 解析 `turn.completed`/`agent_message`/usage → 写 `jobs/<batch>.json`）。逐会话 O_EXCL 锁防双唤醒；deadline＋taskkill /T /F 超时杀树；退出码 0/2/3/4/5/6/7 区分完成、锁忙、线程忙、超时、无 pin、执行失败、用法错。
- `docs/engineering/codex-cli.md`：逐条实测的 Codex CLI 契约（会话模型、argv 顺序、块缓冲、写入者锁、版本偏斜、缓存命中、与 run_glm 对照表）。

## 验收

- 已验证：CLI 自建会话续接与上下文继承；工具端到端真实唤醒（22.11s，答案正确）；报忙路径零消耗；9/9 新增单测＋agent-monitor 87/87＋agent-routing 252 项回归；docs 门禁 0 错误。
- 未验证：Desktop 等待释放后的自动唤醒（需用户配合关闭会话，首次真实使用时验证）；`--output-schema` 决策契约（归 GPT-WAKE-02）；fork 迁移路径。
- 成本：仅报 provider token 计数，无计费基线，不做节省结论。

## 注意事项

- 用户 Desktop 中枢会话打开时唤醒会报忙（退出 3）：要么用户关闭该会话让桥续接，要么 `--wait-writer-minutes N` 等待释放。
- 凭据（config.toml bearer token）不进 prompt、日志、报告或 Git；测试消息一律自标识，不向会话发送无关个人文件。
