# SETUP-RESTART-PLAN-01 受控重启安全计划（v2 限定返修）

```json
{
  "id": "SETUP-RESTART-PLAN-01",
  "title": "SETUP-01 第五片：受控重启安全计划纯函数（v2 返修版）",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "restart-plan.ts：planControlledRestart 纯函数 v2——输入区分 oldRecorded（委托方记录身份）与 oldObserved（独立观测身份，null 按 unknown 阻断），观测全部改为 pending/success/failure/unknown 四态判别联合（saveNewSource/drain/oldExit/start.process/health/rollback.restore），SIGTERM/SIGKILL 派发为显式布尔（true 后永不再建议，不循环杀进程）。动作只描述接下来允许做什么（send-sigterm/send-sigkill-once/start-new-server/restore-old-config 等），不凭 deadline 或 pending 断言副作用已完成；终态只能由相应确认导出（ready 需健康身份逐字匹配目标，rolled-back 需 restore success 观测）。新目标身份合法性+与 planned 边界逐字比对（端口/origin 漂移即 blocked-runtime-mismatch），新 runId 必须不同于旧 runId。除 ready 外 retainOldState=true。测试 26 例：GPT 探针 5 反例逐一命名复现 + 守卫/停止阶段/启动回滚/连续序列/tdx 继承。零 OS 操作、零时钟/环境/文件读取。",
  "next_action": "GPT 按 control-handoff-20260927-24 复核；通过后另片冻结 launcher 接线（本片不接保存/重启桥、不做人工恢复功能）。",
  "allowed_paths": [
    "server/src/setup/restart-plan.ts",
    "server/test/setup-restart-plan.test.ts",
    "docs/work-items/tasks/SETUP-RESTART-PLAN-01.md",
    "docs/status.md"
  ],
  "depends_on": ["SETUP-SAVE-01"],
  "base_commit": "836a1e470cacb89cc4458cf12770ef1e7b4d62db",
  "repair_of": "control-handoff-20260927-24（返修基线 836a1e4，reply_to 同号）",
  "docs_impact": {
    "reason": "返修合同授权的三文件切片；纯计划模块重构，不接 launcher/Fastify/UI/数据库/既有 SETUP 模块。",
    "update": ["docs/work-items/tasks/SETUP-RESTART-PLAN-01.md", "docs/status.md"]
  },
  "verification_refs": ["server/test/setup-restart-plan.test.ts"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 返修点（对 v1 @836a1e4 的修正，对应 GPT 探针五反例）

1. **P1 身份/运行边界**：v1 只校验旧记录形状且无独立观测输入；v2 增加 `oldObserved`（null=观测缺失即阻断），观测与记录逐字比对；新增目标身份校验（非空 runId/正 pid/合法端口/origin 一致/runId 异于旧值）与目标端口/origin 对 planned 的边界比对——探针 new-runtime-drift（漂移端口）与 invalid-new-identity（空 runId/0 PID）不再 ready。
2. **P1 阶段证据**：v1 用独立布尔压缩生命周期且无阶段观测；v2 观测四态 + 显式 `sigtermSent/sigkillSent`；drain 超期有终态 `drain-timeout`；SIGTERM 未发只输出建议 `send-sigterm`；deadline 到期且确认存活才建议一次 `send-sigkill-once`（reason 不含"已执行"）；探测 unknown 或 fallback 后未确认 → `old-exit-unconfirmed` 终态。
3. **P1 回滚语义**：v1 未启动即自称 rolled-back；v2 启动 pending 输出 `new-start` 等待；确认失败才 `new-start-failed`+恢复建议（明确"尚未确认恢复完成"）；仅 `restore success` 观测后才 `rolled-back`。
4. **P2 retainOldState**：v1 drain 阶段即 false；v2 除 ready 外恒 true。
5. **P2 交付缺件**：本任务卡入库，state=review（不称 accepted/closed）。

## 旧 v1 测试断言修改理由（不弱化保护）

- 「drain…retainOldState=false」删除：违反"未验证成功前保留旧状态"，v2 断言 drain pending/超期/未完成全部 retain=true（保护增强）。
- 「rolled-back/new-start-failed 以 oldExitConfirmed 三目区分」删除：v1 两断言同输入不可能同真（同输入异期望），且 rolled-back 无观测凭据；v2 以 restore 观测区分并分别钉住。
- 「SIGKILL fallback…oldExitConfirmed: true」输入修正：v1 输入自相矛盾（退出已确认却期望计划 SIGKILL）；v2 以 alive+未派发表达，并新增"派发后仍存活→old-exit-unconfirmed"反例。
- v1 的 14 例全部重写为 v2 接口 26 例：守卫 9、停止阶段 9、启动/回滚 4、序列与继承 4，反例只增不减。

## 门禁

- 定向 6 文件（restart-plan/saved-choice/process-clues/tdx-inspect/setup-api/control-guard）；build:server；docs:check；docs:impact --base b0b5608；docs:status --check；git diff --check。
- 日志：`C:/Users/Stark_Du666/.codex/headroom-cache/accept-20260927/restart-repair-25/`（red-probe.log 为 836a1e4 上 GPT 探针复跑 exit=1 的 RED 证据；green-*.log 为逐命令完整 stdout+stderr）。
- 首次并行全量 1023/1024 失败（v1 轮）：测试名与完整 stderr 未保存，原因=unknown（如实保留，不补造）；两次全量复跑（串行 429s/并行 306s）当时未留日志路径，按合同记"未保存"。
