# ORCH-03 显式恢复验证

2026-09-25，提交3e2b2141752fdbaeb65902de6ab3454d9b7d79d0，承接控制器1f4d779及状态模块3146524。

独立完整命令：`C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_*.py -q`，退出0，206项中203通过、3平台/权限跳过，耗时327.795秒。[原始结果](resume-tests.txt)。新增3项先失败再通过，覆盖同任务接续保留执行次数、缺显式批准/活跃租约/脏候选拒绝、错误job/未知清理/旧HEAD拒绝；处置事实进入下一worker提示亦先失败再通过。没有放宽原独立验证器。

用户授权关闭Mimosa后，首轮未提交候选已按worker事实散列核对，仅_readme变化。原字节和完整diff保存在控制层，恢复精确基线后通过resume继续同一ORCH-03-PILOT。原execution_started保留，追加replan事件resume-5487d43fe0494d03b533aef816791106；合同、policy和预算不变。

第2次尝试job-f38247d5f65a4c569c7fc88bf9f5b463运行中，真实会话sess_8e7b02cb-8ca1-4246-804a-a368dd1821dd。新CLI启动日志已有其他插件hook事件而Mimosa为0，确认关闭配置在新进程生效；尚未据此宣称试点通过。最终收据、正常提交与重复run幂等仍待核验。更多处置见[Mimosa授权关闭](mimosa-resolution.md)。

上述已验证代码经基线字节比较同步主工作区，保留其他改动；未合并主干或推送。原Mimosa配置及拒绝证据留存，没有删除项目memory或其他插件。当前真实试点不需要用户再次授权。
