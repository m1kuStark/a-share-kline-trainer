# SETUP-RESTART-PLAN-01 受控重启安全计划（GPT Direct 收尾待独立复核）

```json
{
  "id": "SETUP-RESTART-PLAN-01",
  "title": "SETUP-01 第五片：受控重启安全计划纯函数",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "v3 两次同因返修后转 GPT Direct。冻结跨轮身份/来源/运行边界/期限；保存、退出、spawn、health、恢复全部有限等待；spawn 回执以 runId/PID 绑定已认领动作；health 单独阶段；失败与完成终态稳定。纯模块未接 launcher，当前待 GLM 独立复核，非产品发布。",
  "next_action": "GLM 只读独立复核 GPT Direct 提交与反例证据；确认后由控制层冻结 launcher 接线，禁止第三轮原样实现。",
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

## GPT Direct 收尾（2026-09-27，基线 34756e3）

v3 独立定向110项通过，但尚有同因缺口，按 repair attempt 2 预算转 GPT 接管，不再委派同一实现。先新增10项行为回归，全部RED；再补启动回执runId归属与首次退出探测迟到alive两项RED；辅助审查再补未认领保存成功绕过停止门禁一项RED，共13项。原始日志位于全局缓存 `accept-20260927/restart-direct-28/`（red-tests.log、red-receipt.log、red-save-claim.log；旧v1/v2/v3日志不覆盖）。

- preflight 将旧记录/独立观测、planned、target、timeout复制进state.context；后续不得更换身份/来源/边界/期限，已退出旧服务无需重新live探测。
- 新增saveMs，保存也有有限出口；等待spawn与等待health分别计时，deadline恰好到达时迟到成功不能越过门禁；拒绝时间倒退和算术溢出。
- saving/checking-health分阶段，已绑定PID后仅health更新也可推进。spawn成功回执新增runId，未认领启动或回执不属于目标时不绑定；未知保存/drain/spawn/恢复均保守处理。
- 保存成功必须先认领本次保存动作；原测试后续阶段夹具增加真实保存认领/成功两步，不用默认success跳过保存。
- restore失败/未知/超期进入稳定restore-failed，外部phase=new-start-failed。旧测试要求超期后仍restoring的断言改为稳定失败，并有迟到success不能回rolled-back的更强断言。
- 执行者须先持久化nextState再执行动作；claimed表示认领，不证明OS已完成。完整副作用回执/同一次attempt事件归属与服务drain期间防新训练仍是后续接线责任。

当前代码测试变化仅两文件；任务卡与status同步。执行者不以本片纯逻辑门禁替代未来完整集成/UI门禁；状态保持review，后续独立审查记录另行追加。

GPT Direct 定向6文件123/123（模块39项）与build:server已通过；完整输出与命令/文件SHA256/Git blob见缓存 final-unit、final-build 的log/meta.json。其余文档/范围门禁同目录独立工件记录。

经验：状态名本身不保证正确，必须固定跨轮证据；等待成功分支同样受deadline约束；一次性回执不应每轮重放来让测试过关；未知不能走默认成功分支。控制层早期合同未充分定义证据保存与PID产生时机，需先沿真实事件顺序冻结接口。新切片须把这些点变成行为反例，再由独立复核者确认。
