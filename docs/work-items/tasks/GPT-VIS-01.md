# GPT-VIS-01 Codex App-Server 桥调研

```json
{
  "id": "GPT-VIS-01",
  "title": "Codex App-Server 桥调研（运行中 Desktop 会话的注入可见性）",
  "owner": "integrator",
  "state": "closed",
  "milestone": "DEV",
  "summary": "调研完成：写入者锁为共享存储层单一写者约束，对 app-server 协议与 CLI 一致生效——'注入 Desktop 正打开的会话且实时可见'不可行；App-Server 的增量价值为流式增量、turn/steer/interrupt、审批回调客户端化，定位为 run_codex 的下一代传输层候选。",
  "next_action": "对账收编（2026-09-29）关闭：调研记录 881d2bd 交付、GUI 注入路径验证 85d6551 收尾，实测均为基线 5bf4484 祖先（探针/evidence/report 已随用户拍板基线在册，探测零模型消耗）；按对账关闭调研卡，用户验收尚未记录。归属去向显式登记：结论 4 的两项后续——接入 App-Server 传输层或 Desktop UI 自动化——均未立项（无后继卡），留待后续里程碑另行拍板，不在本卡继续。",
  "allowed_paths": [
    "docs/work-items/tasks/GPT-VIS-01.md",
    "docs/engineering/codex-cli.md",
    "docs/verification/2026-09/GPT-VIS-01/**",
    "docs/status.md"
  ],
  "depends_on": ["GPT-WAKE-01"],
  "base_commit": "a6047fb",
  "docs_impact": {
    "reason": "用户 2026-09-25 授权调研 App-Server 桥（要求 Desktop 常驻可见＋可人工干预）；仅调研不接线，不重开 ORCH。",
    "update": ["docs/engineering/codex-cli.md"]
  },
  "verification_refs": ["docs/verification/2026-09/GPT-VIS-01/report.md"],
  "integration_ref": "integration/product-integration-20260926@85d65518ceedd2fb2bb96f7ca56cc67d878e3aec",
  "acceptance_ref": null
}
```

## 调研结论（详见验证记录）

1. Desktop 与 CLI/app-server 是各自独立的运行时（Desktop 开着但控制套接字不存在、loaded 集不外显）。
2. 写入者锁对一切写入面一致：协议路径 `thread/resume` 对 Desktop 打开的会话报同一 -32600；写探查零模型消耗。
3. App-Server 真实增量：流式增量通知、turn/steer/interrupt、三类审批回调客户端化、逐轮 sandbox/approval/model/outputSchema 覆写、持久 daemon。
4. 可见性方案二选一：现行排队＋通知协议（已交付）或 Desktop UI 自动化；App-Server 定位为传输层升级候选。

## 调研问题（按优先级）

1. Desktop 与 CLI 是否共享同一个 app-server daemon？（决定锁冲突是否存在）
2. 协议是否支持向打开的线程提交 turn／打断／审批？
3. `remote-control pair` 的配对流程对用户是什么体验？
4. 稳定性与版本耦合风险（实验特性）。

## 对账记录（CAND-06，2026-09-29，git 实测）

- 已提交交付定位：881d2bd（2026-09-25 23:43「docs: record app-server bridge investigation (GPT-VIS-01)」）交付本卡、report.md、probe.py/probe_write.py 与 codex-cli.md 记录；85d6551（2026-09-26 00:16「docs: validate GUI injection path into open Desktop session」）补 cua_probe.py、evidence.jsonl 并修订 report，为本卡最终提交（此后 docs/verification/2026-09/GPT-VIS-01/ 无提交）。两者实测均为基线 5bf4484 祖先且在 integration/product-integration-20260926 上，内容已随用户拍板基线在册。
- 范围划界：6e40c16（computer-use 唤醒协议）、ce1ed5c（gpt.cli 固定要求）、ef3b15d（orch 修复）同窗提交但属 GPT-WAKE/orch 线，不计入本卡；integration_ref 取 85d6551。
- 处置：调研属 DEV 里程碑一次性任务，交付完整（结论 1–4 已记录、零模型消耗），按对账关闭；「接入 App-Server 传输层或 Desktop UI 自动化」未立项（仓内无后继卡），显式留待后续里程碑拍板，不虚构归属。
