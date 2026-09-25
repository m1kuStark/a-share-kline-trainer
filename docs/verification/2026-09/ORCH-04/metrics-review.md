# ORCH-04 对照工具首轮审查

2026-09-25，METRICS批次正常交付，独立运行 `C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_evaluation_metrics.py -q`：退出0，38项通过，0跳过，耗时0.716秒。交付只包含evaluation_metrics.py、对应测试和说明，未提交。

真实observed-run输入未经修改，CLI读取后退出0，但将已验收的ORCH-03-PILOT记为stale_binding：logical run_id与verification.run_id属于不同命名空间，收据ID不应等于逻辑运行ID；candidate/oracle匹配、独立验证与非空收据ID才是本合同所需绑定。该错误导致qualified=0、quality_violations=1，已确认是指标工具误判。

控制层补查还复现：

- 缺强模型计量时两组总体comparison_valid仍为true，虽然差值为null；无任何运行的策略被显示为零token/零时长。
- 同策略混用total_input与uncached_input，或provider与estimated来源，仍得到数字总量240和单位交付成本120；不同口径不能相加成有效成本。
- 两组全失败、adaptive零调用，结果为有效的-100%用量。此处补充明确合同：两组各至少有一项合格交付才能计算总体“合格交付节省”；失败成本原值保留，不以零交付推导节省。原计划只写不降低交付率，0→0边界需本次澄清。
- 原合同允许任意非空有效model_roles映射，实现额外强制两种角色都配置，属于不必要的限制；标识/来源还应拒绝纯空白字符串。

未调整真实输入或原证据来制造通过。首轮保留changes_requested，GLM修复批次ORCH-04-METRICS-REPAIR1-20260925保持三文件范围、API和实际模型配置，要求先补失败回归。修复前快照、反例脚本和全部观测JSON在控制层ORCH-04-metrics-before-repair1及ORCH-04-metrics-counterexamples.*，不传递推理文本。

分类门禁GATES仍在独立工作树运行，尚未评为通过；本记录仅覆盖已交付的METRICS首轮。

| 文件 | 首轮SHA256 |
|---|---|
| evaluation_metrics.md | 5b953cd9a372a16a6fb7da43c806494cf232c0906fde9a0c4eb0ab3418eb7d09 |
| evaluation_metrics.py | 43507b104185783b92d3db542891d9c168f64756108b71624a47d21cfa45f0be |
| test_evaluation_metrics.py | 2a455ca7a283d34d417947c45dab7767eae7a4935be5069473e1dd781988eefd |
