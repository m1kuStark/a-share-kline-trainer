# Codex CLI 实测经验（GPT 会话中枢桥）

2026-09-25 实测，宿主 Windows + Git Bash；npm `@openai/codex` 升级后 **0.157.0**（从 0.145.0，`codex doctor` 主动提示可升级），Codex Desktop 写入版本 0.155.0-alpha.16.4。凭据在 `~/.codex/config.toml` 的自定义 provider（`requires_openai_auth = false`，无需 `codex login`）；该文件内容不进日志、prompt 或 Git。配套派发工具：[run_codex.py](../../scripts/agent-monitor/run_codex.py)（与 run_glm.py 同目录同构，验证记录见 [GPT-WAKE-01](../verification/2026-09/GPT-WAKE-01/report.md)）。

## 会话模型（与 ZCode CLI 的关键差异）

- 会话以**线程存储**持久化在 `$CODEX_HOME`：`sessions/YYYY/MM/DD/rollout-<时间戳>-<轮次uuid>.jsonl`，首行 `session_meta` 携带 `session_id`（=thread id）、`cwd`、`originator`（`Codex Desktop` / `codex_exec`）、`cli_version`。**文件名里的 uuid 是轮次文件 id，不等于会话 id**；同一会话每轮新建一个 rollout 文件，逐事件实时追加。轻量索引在 `session_index.jsonl`（`id`/`thread_name`/`updated_at`，相对滞后）。
- `~/.codex` 下另有 `archived_sessions/`；被归档的线程 resume 时报 `is archived`，需 `codex unarchive <id>` 恢复。

## headless 调用契约（逐条实测）

- 一次性执行：`codex exec [OPTIONS] [PROMPT|-]`；续接：旗标必须放在 `resume` 子命令**之前**——
  `codex exec -s read-only --skip-git-repo-check resume <thread-id> - --json -o <last.txt>`
  （`-s`/`-c`/`-m` 等 resume 子命令不收，放在后面报 `unexpected argument`）。
- prompt 走 stdin（`-`），避开 Windows ~32K argv 上限；`--json` 输出 JSONL 事件流：`thread.started(thread_id)` → `turn.started` → `item.completed(item.type=agent_message)` → `turn.completed(usage)`。**完成谓词 = `turn.completed`**；usage 含 `input_tokens`/`cached_input_tokens`。
- **stdout 事件流是块缓冲**：重定向到管道时完成事件已落 rollout 却可能长时间不吐 EOF（MSYS `tail` 实测挂起、`timeout 150` 也杀不掉进程树）；必须重定向到文件并由调用方监督进程句柄。
- 无任何内建超时 flag；调用方必须自管（run_codex.py 用 deadline + `taskkill /PID /T /F`，随后枚举整棵进程树逐 PID 验证消亡才记 cleanup_confirmed，无法枚举或清理异常时保守保留会话锁）。
- resume 续接实测成立：CLI 自建会话追问上一轮暗号准确答出；**同轮次缓存命中可观**（续接轮 69096/95841 ≈ 72%，工具链路轮 146512/208328 ≈ 70%，Desktop 大线程轮 ≈95%）。缓存命中是 provider 计数事实；**无计费基线，不构成费用节省证明**，不做节省结论。
- `--output-schema <schema.json>`、`-c key=value` 配置覆盖、`--ephemeral`（不落盘、不可 resume）可用；`--last` 按 cwd 过滤且不区分来源，程序化唤醒应捕获自己的 thread id，不依赖 `--last`。
- 每次调用的沙箱：`-s read-only|workspace-write|danger-full-access`。config.toml 全局默认 danger-full-access，**桥工具默认显式 read-only，执行类派发按需显式提权**。2026-09-26 澄清：`.git` 只读限制是单次环境实测（workspace-write 下），不是普适规则；是否对执行类使用 danger-full-access 由各环境实测决定，与 GLM yolo 对位仅为本机现行选择。

## 写入者锁（并发与 Desktop 共存的硬约束）

- 线程存储级**每线程单写入者**：并发两个 `exec resume` 同一线程，第二个在初始化即失败 `thread-store conflict: already has an active writer`（code -32600，模型调用前，零 token 消耗）。
- **Desktop 打开着的会话持续持有写入者锁**（空闲 30 秒稳定窗口后仍冲突）；用户在 Desktop 关闭该会话后锁即释放，外部 resume 可继续同一会话。
- 结论：唤醒前先做 rollout 稳定窗口检测，冲突时要么等待释放重试（`--wait-writer-minutes`），要么报告忙交回调用方；不可强抢。
- 版本偏斜：Desktop 0.155+ 写入的线程事件（如 `subagent-completed`）在 npm CLI 0.145 反序列化失败（`thread/resume failed`，-32603）；升级到 0.157.0 后可读。**桥工具要求 npm CLI ≥ Desktop 写入版本**，版本差异先查 `session_meta.cli_version`。

## 与 run_glm（ZCode CLI）的对照

| 维度 | ZCode CLI (GLM) | Codex CLI (GPT) |
|---|---|---|
| 入口 | 桌面自带 `zcode.cjs`（Node） | npm 全局原生 `codex.exe` |
| 模型指定 | 环境变量注入 provider 配置（唯一正路） | config.toml 默认＋`-m`/`-c` 覆盖 |
| 完成信号 | stream-json 末尾摘要（sessionId+response） | `turn.completed` 事件＋`-o` 落最后消息 |
| 判活 | sqlite/telemetry 在途请求 | rollout 轮次文件实时追加 |
| 超时 | 调用方自管（同） | 调用方自管（同） |
| 并发约束 | 账号额度 2~3 路 | **每线程单写入者**；跨线程可并行 |
| 凭据 | ZCode 登录存储 | config.toml bearer token（不进日志/Git） |

## Desktop 常驻工作协议（用户 2026-09-25 拍板）

用户要求：ZCode 推进任务期间 Codex Desktop **正常在桌面运行**，全程可见、可随时人工干预。与写入者锁的调和方式：

- Desktop 常驻运行（看任何其他会话/窗口均可）；**唯一约束是唤醒进行中，目标会话不能是 Desktop 当前打开的那个**（写入者锁）。
- GLM 侧唤醒一律带 `--wait-writer-minutes <N> --notify`：锁被持有时不报错退出，而是排队等待并弹 Windows 通知"切离该会话后自动继续"；用户切离目标会话（点到别的会话即可）后自动续接；完成/失败再弹通知，用户切回即见完整对话记录。
- 人工干预入口天然存在：用户在会话里的手动输入进入同一上下文（下次唤醒 GPT 可见）；控制器侧任何异常都 waiting_control 交还人工，不自动重试。
- 看板兜底：每次 wake 的 prompt/答复/用量登记在桥 home 的 `jobs/<batch>.json`（机器可读），可作为第二观察窗。

**真正的"实时看着 GPT 在 Desktop 里打字"需要驱动 Desktop 本身**，两条候选路径（均需专项验证后再立项）：①官方实验接口——`codex app-server daemon/proxy`（连接运行中 app-server 的控制套接字）＋`remote-control pair`（配对码），且可用 `generate-json-schema` 导出协议，正对"往打开的会话注入任务"这一需求；②Desktop UI 自动化（tdx_quick_draw 先例）。在验证之前，上表的排队＋通知协议是既定工作方式。

## Computer Use 切换协议（用户 2026-09-25 提议，GUI 注入已实测打通）

用户需求：不需要看打字，要**及时观察会话进展**并保留人工干预。**实测结论（本日晚）：GUI 注入全链路打通，且比预想更简——目标会话在 Desktop 打开时无需任何切换**，因为注入走 Desktop 自己的输入框，Desktop 就是写者，写入者锁彻底不适用：

1. computer use 绑定 Desktop（进程名 **ChatGPT**，`OpenAI.Codex` 包）→ `getAXState` 返回文本含 `[n]` 元素索引（注意：返回值就是字符串本身，用 `{emit:false}`；元素树由运行时自动展示，不要读 `.text` 属性）；
2. 定位 `[73] textfield 随心输入`（AXSetValue 可设）与 `[61] button 发送`——索引跨观察稳定，且可按名称重定位；
3. `setValue(73, prompt)` → 重新观察校验落框（防"已接受未生效"）→ `click(61)` 发送；
4. 轮次在 Desktop 内运行（发送键变"停止"按钮＝进行中，用户实时可见），答复从 a11y 树读回（搜内容而非"ChatGPT 说："标记——树顺序与视觉顺序不一致，内容可能在标记之前）。

全程后台操作不抢焦点；转轮中用户随时可打断/插话（人工干预零成本）。局限：长 prompt 依赖 setValue 对超大文本的行为（待压测）；控制器 gpt_direct 的 worker 派发仍走 CLI 无头路径（结构化报告＋合同绑定），GUI 注入用于交互式决策请求。

理念对齐（model-delegation.md）：**Codex Desktop/GPT 用于重要选择与判断（拆分、接口不变量、集成判断、升级裁决），不替 GLM 做常规开发**。

实测备注（2026-09-25）：本会话 Computer Use 运行时需 zcode-cua 生产者可用，`setupComputerUseRuntime` 返回 `{getState,getApp,listApps,computer,requestAccess,stop}`，App 方法面为 `{getAXState,getScreenshot,paste,click,drag,pressKey,scroll,selectText,setValue,typeText,performSecondaryAction}`；每次 node_repl 调用需完整重新 bootstrap（Worker 不保状态，UI 状态保留）。`codex app <workspace>` 从沙箱会话发打开请求但窗口未出现在交互桌面（Desktop 托盘态时无顶层窗口）。

## App-Server 协议调研结论（GPT-VIS-01，2026-09-25）

调研已完成（见 [GPT-VIS-01 记录](../verification/2026-09/GPT-VIS-01/report.md)）：**写入者锁在共享线程存储层，对所有写入面一致生效**——app-server 协议 `thread/resume` 对 Desktop 打开的会话报同一个 `already has an active writer`（-32600）。"注入正打开的会话且 Desktop 实时可见"不可行；可见性二选一：现行排队＋通知协议，或 Desktop UI 自动化。App-Server 的真实价值在别处：流式增量通知可被客户端实时消费、`turn/steer`/`turn/interrupt` 转轮中途干预、三类审批回调客户端化（worker 可免 yolo）、持久 daemon——适合作为 run_codex 的下一代传输层，接入与否另行拍板。

## 桥工具用法（交互协议）

```powershell
py -3.9 -B scripts/agent-monitor/run_codex.py pin --cwd D:\Superlinear_Academy\Stock_WorkSpace   # 发现并 pin 中枢会话
py -3.9 -B scripts/agent-monitor/run_codex.py list --cwd D:\Superlinear_Academy\Stock_WorkSpace  # 列候选会话
py -3.9 -B scripts/agent-monitor/run_codex.py wake --prompt-file <决策请求.txt> --timeout-minutes 15
```

- wake 输出机器可读 JSON（`answer`/`usage`/`state`），登记 `jobs/<batch>.json`（与 controller_runner 归属校验兼容）；冲突/超时分别退出 3/4。`--log <path>`（控制器固定事件日志路径）与 `--add-dir <dir>`（沙箱附加可写目录，供 GPT worker 写控制区报告）为控制器派发设计。
- prompt 只含任务事实（结论请求、反例、精确代码位置），凭据与无关个人文件不进 prompt；唤醒成功以"首次续接事实"为准（答案与 rollout 追加可核验），进程退出 0 不算数。
- 控制器侧 gpt_direct 自动派发已接线（GPT-WAKE-02）：policy `gpt_dispatch=true`＋runner config v2 `gpt` 段双旗标齐备时，controller 经 run_gpt_job 派发到 pinned 中枢会话；旗标缺省或写入者锁忙仍 waiting_control。
