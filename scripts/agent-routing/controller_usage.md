# ORCH-03 控制器使用

当前为试验闭环。核心状态、runner、控制循环和显式恢复已通过回归，真实试点经人工接管后已认证verified并验证重复run幂等；具体干预与能力边界见[ORCH-03任务](../../docs/work-items/tasks/ORCH-03.md)。不要将工作批次的completed或退出0当成独立验收通过。

## 登记与执行

控制工具、store、合同、policy和runner配置都放在候选Git仓库外。先确认合同和验收policy内容，固定其SHA256；register必须显式提供三个批准散列与allow。合同带task_id、基线、允许路径、行为领域及尝试预算。同task不可改pin或清零历史。

~~~powershell
py -3.9 -B <控制目录>/controller.py --store <控制store> register --task-id TASK-1 --repo <候选工作树> --contract <合同.json> --contract-sha256 <已批准散列> --policy <策略.json> --policy-sha256 <已批准散列> --runner-config <runner.json> --runner-config-sha256 <已批准散列> --allow
py -3.9 -B <控制目录>/controller.py --store <控制store> run --task-id TASK-1
py -3.9 -B <控制目录>/controller.py --store <控制store> status --task-id TASK-1
~~~

runner配置schema_version=1或2：python_executable、runner_entry、cli、provider、home为绝对路径，node/db可选。permission_mode选择已批准的模式；timeout_minutes为正数，idle_minutes非负，max_output_tokens为正整数。runner_entry指向已有run_glm.py；GLM型号及max配置由它检查。provider内容不进入prompt或可分享报告。控制器额外固定runner、解释器、CLI、provider及已存在monitor/telemetry支持文件的字节散列。v2可选`gpt`段（GPT-WAKE-02）：runner_entry指向run_codex.py、home为桥目录、session_id为pinned中枢会话，sandbox限workspace-write或danger-full-access（2026-09-26实测本机环境workspace-write下.git只读，worker无法提交；执行类在本机用danger-full-access与GLM yolo对位，其他环境以实测为准）。`cli`为必填显式路径：注册时纳入runner_file_hashes哈希固定，杜绝运行时从APPDATA/PATH动态解析逃逸pin。run_codex超时杀树后枚举整棵进程树逐PID验证消亡才记cleanup_confirmed，无法枚举或清理异常时保守保留会话锁。

仅已批准的glm_direct或gpt_plan_glm_execute/execute_contract自动执行；gpt_direct/take_over在policy `gpt_dispatch=true`与runner config gpt段**双旗标齐备**时经run_codex自动派发到同一Codex会话（Desktop打开会话持写入者锁时报忙降级waiting_control）。plan_contract、缺oracle、scope扩大、新合同外风险、保护测试变化及旗标缺省的gpt_direct仍留waiting_control交接。Scout的OS只读沙盒未实现。

## 状态与恢复边界

执行历史保存在TaskStore；每次attempt在启动前登记唯一execution_started。锁覆盖worker和独立验证；另一进程不能读取磁盘token冒充原owner。重启遇遗留租约、未决attempt或无法确认子进程清理时保守交接，不重派，不凭PID抢锁。CLI没有自动recover；不能删store或换task_id来洗掉预算。

外部问题已由控制者解决时，可使用 `resume --task-id TASK-1 --allow --expected-commit <已核实HEAD> --reason <处置事实>`。它要求无遗留租约、上一轮outcome的job/attempt身份匹配且cleanup_confirmed=true，并重新检查全部pin、干净工作区、提交字节与范围。只解除这次已核实的阻塞，追加replan事件并向下一worker传达处置事实；既有尝试和预算保留。随后显式run继续。未知进程状态不能通过resume放行。当上一attempt已把工作提交到expected_commit而仅缺独立验证时（如升级或外部中断发生在提交之后），加 `--verify-only` 跳过重派：对最后一份报告直接跑独立验证（报告必须绑定expected_commit），尝试与预算同样不清零。

2026-09-25用户明确授权关闭Z code中的Mimosa。当前使用其用户配置enabledPlugins开关，原配置留在控制层备份；不修改验证策略或绕过独立验收。若未来重新启用后遇到拒绝，worker仍应停止并交接。

worker自行正常提交，结束时必须干净并满足原范围。完整报告、当前Git字节、风险路由和独立收据共同决定结果。收据签发后还要verify_evidence复核；verified只表示固定机器门禁通过，can_promote始终false。重复run不再执行worker或测试；会重新检查证据、代码与配置pin，变动时退回waiting_control。

日志、prompt、worker_report、交接及验证原件留在控制store/runner看板。首次机器失败记failure，后续失败记repair_failed；同因连续两次repair或总尝试耗尽则交接。环境问题有独立预算。签名/绑定/范围异常不归类为普通环境重试。

## 验证

新增测试用临时Git仓库、SQLite及短Python假runner；不调用模型，不读个人训练库。开发验证入口为test_controller*.py，整体验证还需保留既有test_*.py。真实机械试点与当前状态见[ORCH-03任务](../../docs/work-items/tasks/ORCH-03.md)。
