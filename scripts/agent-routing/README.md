# 四路影子路由

Python 3.9+ 标准库工具。route生成影子建议；verify独立执行固定验收配置并认证报告。二者均不调用模型或合入。后续见[ORCH阶段](../../docs/work-items/milestones/ORCH.md)。

## 使用

从控制目录运行，指定任务Git根，输出必须是仓库外的新文件：

~~~powershell
py -3.9 scripts/agent-routing/route.py --repo . --contract scripts/agent-routing/examples/contract.json --out <仓库外新decision.json>
~~~

可选--report、--history、重复--active-contract。示例base_commit是本轮起始提交；换基线时更新合同。路径含空格须加引号。格式见[Worker Contract](../../docs/engineering/worker-contract.md)。

route是glm_direct/glm_scout/gpt_plan_glm_execute/gpt_direct；next_action区分首次规划和执行已设计合同。退出0仅表示建议生成成功。非法输入退出1，已有输出不覆盖。

CLI核对工作树、暂存区及未跟踪文件并集；事实引用核对文件SHA256和行号。行为重叠来自活跃合同semantic_scopes。未提供收据时verification_status=not_evaluated；附加--receipt、--receipt-store、--policy和contract/policy散列后，先核验控制层报告。can_dispatch/can_promote始终为false。

独立验证器命令与配置见[使用说明](../../docs/engineering/verifier-usage.md)。普通worker测试声明不会变成verified；控制key、策略与合同须由控制层持有且位于候选仓库外。

ORCH-03 的持久登记、事件及所有权接口见 [TaskStore](controller_state.md)；试验执行闭环见[控制器CLI](controller_usage.md)。控制器与真实试点已完成本地验收；试点含人工接管，未自动合入或发布。

## 验证

离线策略对照使用[evaluation_metrics.py](evaluation_metrics.md)：完整运行成本、成对质量及测量缺失均显式报告。它不认证输入、不生成候选证明，也不估计价格；没有匹配的强模型计量时不输出节省结论。

~~~powershell
py -3.9 -B -m unittest discover -s scripts/agent-routing -p "test_*.py" -q
~~~

测试使用临时Git仓库和合成事件，不读取个人训练库或调用模型。规则、真实Git观察和CLI副作用分别验证。

## 当前边界

输入history尚非受保护的控制器数据库；未提供历史会标history_supplied=false。风险路径映射不是完整语义检测器。首版拒绝使用脏工作树的Scout报告降级；代码事实散列不能证明解释正确。

工具只生成外部新文件，不提供OS沙盒。现有run_glm与看板未自动接入。缓存和原始日志放工程外；examples是固定复用示例，不是实际运行结果。
