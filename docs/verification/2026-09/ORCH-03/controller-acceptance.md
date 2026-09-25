# ORCH-03 控制器代码验收

2026-09-25，Windows / Python 3.9。控制器代码提交 `1f4d779291df5e13d03787b35e1b4909fbb2fe02`，状态模块提交3146524。主工作区已通过基线字节比较同步这两部分；未合并主干或推送。真实模型试点正在运行，整批尚未验收完毕。

## 独立验证

`C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_*.py -q`，退出0，203项中200通过、3跳过，耗时314.786秒。原始输出见[controller-tests.txt](controller-tests.txt)。保留既有108项、状态37项，加控制循环36项和runner22项。跳过仍是两项文件symlink权限限制与POSIX 0600平台检查，不是失败掩盖。

覆盖注册批准散列、任务/行为领域占用、真实第二CLI竞争、未决事件/崩溃保守交接、严格范围与代码字节、跨job预算与同因repair、环境预算、完整事实/风险升级、认证收据、终态pin复验、重复run不派发、超时与正常退出后残留子进程回收。机器验证通过不等同用户产品验收。

原联调33项有1项失败，全套202项同一失败：旧夹具把损坏的收据目录当成环境错误。未放宽认证：改用真实不可执行文件验证OS启动失败进入waiting_environment，另保留损坏收据store进入waiting_control的检查，两项通过；随后上述203项完整复跑通过。

## 审查修复

GLM runner交付21项独立通过；日志核对其RED是新增helper缺失导致导入失败，不能表述为21个行为均已逐项RED。完整工具对留在外部orch03-runner-repair-log-review，无Mimosa拒绝。主代理另复现并修复3项检查中的5个失败子例：缺worktree/logPath仍被接受、runner已判orphaned_process或registry_mismatch仍被loop验收，以及终态复核未要求认证报告status=passed。修复后3项通过。

此前租约/pin/报告/预算修复及所有超时不覆盖，见[loop重规划](loop-replan.md)、[状态验收](state-acceptance.md)。文档check/impact退出0，保留7项既有长度提示。没有执行无关产品构建或UI测试：本批是Python内部工程工具；真实试点只改示例配置文案。

## 真实试点预检

ORCH-03-PILOT固定合同及policy已登记。首次预检发现示例配置混合CRLF/LF，Git视为干净而实际字节不同，控制器在execution_started之前交接；模型调用数0。主代理确认只含行尾差异，保存原件，恢复精确Git blob并刷新文件stat，再用原snapshot_repo通过。未改变verifier、合同、policy、task_id或尝试历史；保存原handoff和显式control_resume后重新启动同任务。

当前真实GLM job为job-f7eedb6481ad4e4dba4e75a287812efc，模型GLM-5.3-Flash、max、1M配置目标。待自动验收完成后复核收据，再次run检查events/job/attempt不变；该结果单独记录，不能预写通过。
