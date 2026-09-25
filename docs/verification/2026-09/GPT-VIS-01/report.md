# GPT-VIS-01 Codex App-Server 桥调研记录

2026-09-25 深夜。用户授权的只读调研：官方实验接口能否实现"向 Desktop 正打开的会话注入任务且全程可见"。全部探测零模型消耗（写探查被锁拦截，未产生任何调用）。

## 探测事实（codex-cli 0.157.0，协议 schema 由 `app-server generate-json-schema` 导出，39 文件/657 定义）

1. **Desktop 不使用 app-server daemon**：Desktop 运行中但 `app-server-control.sock` 不存在；daemon 是 CLI 侧独立管理面（`daemon start` 在本会话沙箱内因 Job Object 阻止 breakaway 无法驻留，属探查环境限制，非产品结论）。
2. **协议面完整**：自有子进程跑 `codex app-server`（stdio JSON-RPC）握手成功；104 个客户端方法，含 `thread/list`、`thread/loaded/list`、`thread/read`、`thread/resume`、`thread/start`、`thread/fork`、`thread/compact/start`、`thread/inject_items`、`turn/start`、`turn/steer`、`turn/interrupt`、`review/start`、fs/exec/config 全家桶。
3. **逐轮控制**：`turn/start` 参数支持 `sandboxPolicy`（readOnly/workspace/dangerFullAccess）、`approvalPolicy`（never/untrusted/on-request/granular）、cwd、model、outputSchema——即审批权（补丁/命令/权限三类 ServerRequest）可交给客户端裁决。
4. **决定性实验**：对 Desktop 正打开的会话 01a0d79e 走协议 `thread/resume` → **`already has an active writer`（-32600）**，与 CLI `exec resume` 报错一致；未 resume 成功则 `turn/start` 报 thread not found。
5. `thread/loaded/list` 在自有 app-server 进程内为空——**每个 app-server 进程有独立加载集，Desktop 的加载态不外显**。

## 结论

- **写入者锁是共享线程存储层的单一写者约束，对所有写入面（CLI exec、app-server 协议）一致生效**。"向 Desktop 正打开的会话注入任务且在 Desktop 里实时可见"在当前版本不可行——Desktop 是那个会话的写者，外部任何面都是第二写者。
- App-Server 协议相对 `exec resume` 的真实增量：**流式增量通知（agentMessageDelta 等）可被客户端实时消费**（可接到控制台/看板）；**turn/steer 与 turn/interrupt**（转轮中途改指令/打断，人工干预的正规通道）；**审批回调客户端化**（worker 不必 yolo，控制器可当审批权威）；持久 daemon 免每次拉进程。
- 因此可见性的最终形态二选一：①**保持现行"排队＋通知"协议**（Desktop 常驻看别的，唤醒时切离目标会话几十秒，切回看全程——已交付 a6047fb）；②Desktop UI 自动化（唯一"看着打字"路径，脆弱）。App-Server 桥的正确定位不是可见性，而是**作为 run_codex 的下一代传输层**（流式＋可打断＋审批客户端化），作为独立工作项另行拍板。

## 边界

- daemon 未成功常驻（沙箱 breakaway 限制），daemon 模式下的多客户端共享行为未实测；协议字段随版本可能变动（实验特性）；`remote-control pair` 配对流程未走通（需交互）。
- 本次未对用户会话注入任何消息（写探查在锁处被拦），零模型消耗。

## 证据

- `probe.py`（握手＋list/read 只读探测）、`probe_write.py`（resume/turn/start 写探查）；schema 导出在 `%TEMP%\codex-appschema`（不入 Git）。
