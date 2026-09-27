# SETUP-RESTART-PLAN-01 受控重启安全计划（v3 限定返修，repair attempt 2）

```json
{
  "id": "SETUP-RESTART-PLAN-01",
  "title": "SETUP-01 第五片：受控重启安全计划纯函数（v3 状态机版）",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "restart-plan.ts：planRestartStep 显式状态机步进纯函数——输入上一轮持久化状态（stage/claimed 五动作认领/boundNewPid/stageStartedAtMs/terminalReason）与本轮观测（nowMs 显式有限、六项 pending/success/failure/unknown 四态、五项正有限 timeout），返回 nextState＋本轮唯一允许动作；执行者执行动作前持久化 nextState，模块不提供 OS exactly-once。终态（blocked-*/drain-timeout/old-exit-unconfirmed/rolled-back/ready）在同一次 attempt 内稳定，迟到观测不回退不重发；save/sigterm/sigkill/start/restore 首次派发与进行中分离，pending 只等待不重复副作用；unknown 先于一切信号建议→old-exit-unconfirmed；SIGKILL 派发后未明确 exited→old-exit-unconfirmed 不循环杀；新 PID spawn 前未分配（目标只含 runId/port/origin），成功回执绑定，健康必须匹配绑定，迟到回执不覆盖；等待全部由显式有限 nowMs/timeout 驱动（恰好 deadline 视为超期），非法时间输入保守阻断绝不 ready。测试 26 例：GPT review-26 四反例命名回归＋双序列（成功/fallback/失败→恢复）nextState 串联＋时间边界＋PID 生命周期。纯函数零时钟/环境/文件/进程/网络读取。",
  "next_action": "GPT 按 control-handoff-20260927-26 复核；本片不接 launcher（未来另片冻结接线）。同因第二次失败将 needs_replan 回 GPT Direct。",
  "allowed_paths": [
    "server/src/setup/restart-plan.ts",
    "server/test/setup-restart-plan.test.ts",
    "docs/work-items/tasks/SETUP-RESTART-PLAN-01.md",
    "docs/status.md"
  ],
  "depends_on": ["SETUP-SAVE-01"],
  "base_commit": "afae53581d41bb22738c9a0ec46d8c822bd056af",
  "repair_of": "control-handoff-20260927-26（repair attempt 2；attempt 1=@afae535 未验收）",
  "docs_impact": {
    "reason": "返修合同授权的四文件切片；纯计划模块重构，不接 launcher/Fastify/UI/数据库/既有 SETUP 模块。",
    "update": ["docs/work-items/tasks/SETUP-RESTART-PLAN-01.md", "docs/status.md"]
  },
  "verification_refs": ["server/test/setup-restart-plan.test.ts"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## v3 对 v2（@afae535）的修正（对应 GPT review-26 四反例）

1. **P1 回滚后迟到 health 回 ready**：v2 无上一状态输入，纯观测重算导致终态可回退。v3 显式状态机：终态阶段直接短路返回稳定输出（state.terminalReason 固定理由），rolled-back 后任何迟到观测（含匹配 health）保持 rolled-back。
2. **P1 unknown 在 SIGTERM 未发时仍建议信号**：v3 exiting 阶段 oldExit unknown 先于一切信号建议→old-exit-unconfirmed（nextState.claimed.sigterm/sigkill 保持 false）；pending 且未确认 alive 也不建议信号。
3. **P1 SIGKILL 后 pending 无限等待**：v3 SIGKILL 派发后旧服务未明确 exited（pending/alive/unknown 一律）→old-exit-unconfirmed 终态，不被 pending/deadline 分支遮蔽，不循环杀进程。
4. **P1 启动 pending 混同未请求/进行中→重复 spawn**：v3 claimed.start 首次派发后 nextState 进入 starting；再次 pending 只输出 await-spawn-receipt，动作不重复。save/restore 同规则（save-new-source→wait-save；restore-old-config→await-restore）。
5. **接线澄清 PID 生命周期**：v3 目标身份只含 runId/port/origin（spawn 前 PID 未分配，不预填假 PID）；spawn 成功回执提供正安全整数 PID 并绑定（boundNewPid）；健康观测必须匹配绑定与目标 runId，迟到回执不得覆盖绑定，非法回执 PID/未绑定时的健康成功不放行。
6. **P2 有限时间**：等待阶段全部由显式 nowMs/stageStartedAtMs＋正有限 timeout 驱动，恰好 deadline 视为超期；drain 超期→drain-timeout、spawn/health 超期→new-start-failed、restore 超期保持 new-start-failed（非 rolled-back）、SIGTERM 超期探测无结论→old-exit-unconfirmed；NaN/Infinity/负 timeout 或非有限 nowMs→blocked-runtime-mismatch 保守阻断，绝不延长等待或获得 ready。

## 旧 v1/v2 测试断言修改理由（不弱化保护）

- v2 的"单次调用纯观测重算"测试全部重写为 nextState 串联序列（合同要求：不靠重新 baseInput 清空历史）；每个副作用动作都有"首次派发"与"进行中重复"两断言。
- v2 rolled-back/new-start-failed 相位断言升级为三步序列（失败→恢复建议→确认→迟到事件稳定性），保护从单点扩展到生命周期。
- v2 探针五反例回归保留（v3 接口版），新增 review-26 四反例与时间/ PID 反例；失败证据永不删除。

## 失败证据与日志卫生（FM-007/008）

- v1 首次并行全量 1023/1024：失败测试名未保存，原因=unknown（不补造）；两次全量绿当时未留日志，记"未保存"。
- v2 轮 green-restart-plan.meta(exit=1) 与同名 log(passed) 矛盾原件保留：系同轮先 RED 后 GREEN 复跑覆盖 log 未更新 meta 所致，未绑定同一次运行；本轮起每次运行独立唯一文件名并绑定源码 SHA256。
- v3 RED 证据：`restart-repair-27/red26-probe.log/.meta`（836a1e4→afae535 上复跑 review-26 探针 exit=1，4 反例，附模块 SHA256）。
- 本轮门禁日志前缀 `green27-*`／`gate27-*`（每命令 .meta：cmd/cwd/HEAD/源码 hash/起止时间/exit）。

## 门禁

- 定向 6 文件（restart-plan/saved-choice/process-clues/tdx-inspect/setup-api/control-guard）；build:server；docs:check；docs:impact --base b0b5608 --task SETUP-RESTART-PLAN-01；docs:status --check；git diff --check。
- 不重跑全仓/Journey 刷数字（合同豁免：纯未接线模块）。
