# ORCH-03 最小执行闭环

2026-09-24，承接ORCH-02已验证工程。目标：已设计或机械任务由GLM主力完成，实现独立验证、范围内修复和升级交接。无需GPT逐轮驱动，先试运行显式allowlist中的任务。当前不实现OS沙盒或自动GPT调用，Scout和需要新设计的任务生成waiting_control；不能声称所有四路已自动执行。

## 控制边界

控制器从候选仓库外运行。每个逻辑task_id绑定contract+policy的已确认SHA256、worktree、基线、runner配置和有限预算；不得因换job/resume清零。控制存储放CODEX_HOME/headroom-cache中，不入Git。复用run_glm.py登记看板与GLM/max配置，禁止worker写主干或改验证策略。

合同只给goal、acceptance、context、invariants、scope、forbidden、tests、risks；首次执行worker自主实现。scope内完成代码、测试、文档和正常git commit。Mimosa拒绝就停止交接，不绕过。返回短结构化事实，完整日志/diff留本机缓存。若退出后仍dirty、越界或缺有效提交，进入waiting_control，不自动git add全部改动。

## 状态与幂等

使用控制层持久状态：registered / running / verifying / verified / waiting_control / waiting_environment。每次attempt持有唯一job_id、执行前后SHA、runner结果、认证收据、路由理由和失败指纹，事件唯一ID。原始事件只追加，消费重复完成事件不会重复验证/计数/派发。

task锁与semantic_scopes所有权由控制层持有；同任务或相同行为不可并行。单进程持锁覆盖执行/验证。崩溃恢复先核对登记进程身份与原job，不自动偷锁，不重派无法确认终止的worker；不把PID复用当仍是同一次任务。

2026-09-25补充：对已有完整outcome且确认进程已清理的阻塞，可由控制者显式resume（allow、核实后的HEAD、处置原因）。重新校验固定输入、任务/attempt身份、干净提交及范围后，追加replan记录并继续同一task；不重置执行次数，不释放未知租约。该入口用于外部条件已改变的接续，不承担GPT自动调用。用户已授权关闭Z code Mimosa，独立verifier及预算规则保持。

2026-09-25（GPT-WAKE-02）：gpt_direct/take_over 在**双旗标 opt-in**下自动派发——pinned policy `gpt_dispatch=true` 且 pinned runner config v2 携带 `gpt` 段（run_codex.py 入口、桥 home、pinned 中枢会话 id、sandbox 固定 workspace-write）。派发复用同一 attempt 机制（execution_started 事件、build_prompt REPORT 协议、jobs 注册表归属、outcome、独立验证）；GPT worker 的 `assessment=continuous_judgment` 合法，不触发 GLM 的自升级，needs_replan/scope 扩张仍升级控制层；会话经 run_codex 续接同一 Codex 对话（写入者锁被 Desktop 持有时报忙降级 waiting_control）。route=glm_direct或gpt_plan_glm_execute且next_action=execute_contract才自动执行GLM。plan_contract、缺oracle、scope扩大、新合同外风险、保护测试变化、旗标缺省的gpt_direct均转waiting_control，保存handoff.json；受控来源和信任边界与ORCH-02一致，不声称抵抗同OS用户恶意进程。

## 验证与修复

run_glm执行结束不等于通过。调用ORCH-02 run_verification后再verify_evidence：passed→verified（只表示机器检查通过，can_promote=false）；failed→记录首次failure或repair_failed。首次失败不算repair；同指纹两次repair仍失败，或total_attempts耗尽，转waiting_control/GPT Direct。环境错误独立预算，有限重试后waiting_environment。一次repair只附失败事实/原日志引用，禁止逐行遥控或放宽验收。

worker新事实需结构化报告或保守交接；不能只在GLM答复里搜索“passed”判绿。stage与状态文件用实际Git、runner结果及认证收据确定。合入、visual分类与发布留给ORCH-04。

## 验收

合成进程及临时Git夹具先覆盖：成功、非零、两轮同因repair跨job累计、环境耗尽、重复处理、锁冲突、输入pin变化、退出dirty/越界、无GPT adapter、篡改收据、旧HEAD和重启后已有终态。再用真实GLM完成一项已确认的机械文案修正并签发验证收据。

本轮不得改已有receipts/verification/routing核心以让测试通过；只新增controller及必要adapter，既有108项必须保留。进度与原件按事件维护，无任务时不产生空轮询。
