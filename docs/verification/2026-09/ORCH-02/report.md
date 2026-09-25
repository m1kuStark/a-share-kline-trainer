# ORCH-02 独立验证与收据验收

2026-09-24，Windows / Python 3.9.13。本机工具实现与独立候选验证完成，未修改产品交易流程，未自动派发或合入主干。

## 版本和证据

- 起始提交af0efaf；隔离的ORCH-01工具基线b72df51。
- 实际验证工程提交：0e4bd3e1bdb5c9f565337877222b9b5ec9de22f3；验证树042373b25c59b5be3161a888027322acbad12f9b。
- [控制层报告副本](controller-report.json)包含contract/policy/profile、代码字节与验证器散列及检查结果；它是审计副本，不是可在其他store重放的收据。
- 控制目录外启动verify.py检查干净候选，run退出0；inspect再次认证与核验代码/日志退出0；route消费收据退出0，结果review_by_risk、can_promote=false。
- 唯一运行ID为verify-3887db2029e74f23969a7eb648735e98。签名原件、固定输入和key保留本机外部缓存，key不入仓库。
- 实际命令：py -3.9 -B -m unittest discover -s scripts/agent-routing -p test_*.py -q。108项完成，105通过、3跳过，见[完整输出](routing-full.txt)。两项文件symlink用例因Windows权限跳过，POSIX 0600用例因平台跳过；目录junction的三项回归实机执行通过。

## 已核验行为

固定命令配置、同因失败指纹、非法/伪造/过期收据、篡改或缺失日志、旧提交、脏候选、受保护测试修改/删除、追加回归、执行中源码变化、超时和残留子进程、同run重复签发及目录逃逸。既有ORCH-01的28项测试保留。

候选源码必须与提交blob一致，拒绝assume-unchanged/skip-worktree隐藏状态，仅允许普通LF/CRLF检出转换。Windows派生进程在启动前加入Job Object，正常退出同样核验/回收后代；POSIX分支尚未实机执行。签发前复查全部日志和来源清单，run对passed结果再完整inspect。

## 失败与修复记录

1. 新模块/CLI不存在时先运行失败回归；路由未提供receipt参数时两项真实集成回归失败。
2. 首次15项验证器回归有3个异常类型错误，统一收据/缺工件边界为明确的调用错误后修复。
3. 独立审查复现4项失败：assume-unchanged隐藏弱化测试、skip-worktree隐藏源码、后续检查篡改旧日志、退出父进程遗留后台写入。均补回归后修复。
4. Windows Job Object计数在根进程结束后仍短暂为1，20ms后为0；原判断误报3项成功场景。增加有界排空阶段，仍回收真实残留，19项验证器回归通过。
5. GLM初版收据模块51项，2项symlink跳过；定向修复补junction、0600及写入错误回归后56项，3项平台/权限跳过。版本散列在工程提交中可追溯。

## 协作和范围

GLM-5.3-Flash/max完成receipts模块及一次定向修复，独占两个文件；主代理完成控制层执行、路由接线、反例与跨模块验证。两个任务均在原GLM看板登记，[provider用量](worker-usage.json)按job原样记录，包含缓存读取与重复上下文；不是现金账单，也不证明比GPT单跑节省。强模型用量无可靠计量，本轮不编造收益。

隔离分支的docs:check、docs:status检查及docs:impact --base b72df51 --task ORCH-02通过。当前主工作空间仍有此前产品/文档改动，回写时只同步本批工具和协议，不覆盖它们；原主干验收闸门不变。

独立验证不证明业务语义完整，也不抵抗可任意读取控制key的同OS用户恶意进程。控制器持久重试、看板自动联动和模型接管在ORCH-03；分类visual/集成在ORCH-04。用户功能验收未记录。

