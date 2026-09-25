# ORCH-04 离线对照切片验收

2026-09-25，代码提交67034ade60187972846eab067b1f8bc099cccf9b，独立分支task/ORCH-04-metrics，暂未集成GATES分支或复制代码到main。

GLM修复交付后，控制者独立执行 `C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_evaluation_metrics.py -q`，44项通过，退出0、0跳过。真实observed-run输入未变，qualified=1、quality_violations=[]、strong tokens=null、baseline tokens=null、comparison_valid=false；不再混淆逻辑运行ID与验证ID。

根代理补查单一错误token口径（两组都为uncached_input）仍产生数字单位成本，范围偏离时仍汇总时长/介入。新增两项行为回归先失败（120非null、12.5非null），收紧这处聚合后全套46项通过、退出0、0跳过，耗时0.650秒。原始逐运行计数保留，未放宽质量或绑定检查。

CLI再读取同一真实输入，写入新[observed-report.json](observed-report.json)，退出0。两次GLM合计1350162个输入+输出token（缓存已经包括在输入，不重复加），强模型及完整时长未知、缺baseline，因此不能计算节省。该报告是说明性投影，不是认证收据，can_promote=false。

实现和首轮修复由GLM完成，控制者只补上述聚合边界与独立检查。首次失败和反例见[首轮审查](metrics-review.md)。这里验收的是离线对照切片；分类门禁仍在REPAIR1，ORCH-04整批尚未完成。
