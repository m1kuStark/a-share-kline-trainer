# GPT-WAKE-01/02 返修工程验收

北京时间2026-09-26。完成事件：`bridge-tail-legacy-tests-complete-20260926-04`。本轮复核提交：`1fd5c19bc1b7e182994ab11edc0bdde9c7b67959`，父提交`ef3b15d`；工作树复核开始时干净。

## 裁决

本批已列明的桥接返修项通过工程验收，关闭本轮返修，回到DATA-05/TRAIN-02/SETUP-01产品主线。这不是用户最终验收，也不扩大自动派发、文件访问、产品合入或发布权限。

本轮diff仅修改run_codex.py及其测试。旧events.jsonl中的登记在授予发送许可前参与核对；旧日志损坏时保守阻断。O_EXCL新事件认领保留。EventLogTests恢复为可发现的测试类，模块仅保留一个unittest入口；并发测试明确断言一false一true，中断测试构造只有claim而无日志的现场。

## 独立验证

- `python -B -W error::ResourceWarning -m unittest test_run_codex.EventLogTests test_run_codex.EventLogRaceTests -v`：5项通过，exit 0；无ResourceWarning及后台线程异常。范围含旧日志升级重放、新事件放行、损坏日志阻断、并发许可与中断认领。
- discovery核实EventLogTests存在，test_run_codex模块可发现27项。本轮仅执行变更相关5项，不把“发现27项”写成全量通过。
- `git diff --check ef3b15d 1fd5c19`通过；docs:check零错误（11条篇幅建议），docs:status --check通过。
- 上轮ef3b15d已有独立24项桥回归通过且无原生命令解码异常；本次未改进程探测、清理、会话身份、CLI固定和控制器实现，未重复运行与本diff无关的全量套件。GLM报告的monitor108/routing268保留为实现者自验声明，不冒充本轮独立执行结果。

本机证据：`$CODEX_HOME/headroom-cache/accept-20260926/1fd5c19-event-tests.log`。历次失败与裁决见同目录的回调review JSON和本目录[integrator-review-20260926.md](integrator-review-20260926.md)。本轮零真实模型测试调用。

## 保留的使用边界

事件认领提供保守的至多一次发送许可，不能据此承诺端到端必达；认领后崩溃或发送结果未知应保留记录，由控制层核实，不自动盲重发。旧日志损坏会阻断新许可，需显式诊断恢复，不得删记录换ID绕过。

CLI仍需尊重已打开会话的写入者锁。GUI交接要核对会话、空草稿和无活动生成，不能宣称任何时刻零冲突。GPT派发完结束回合，只接收完成或升级事件；GLM和确定性验证器负责执行，不以强模型轮询替代进程监督。

## 产品接续

恢复原产品会话，核对活跃写者后复用DATA候选d4aa4e8和TRAIN候选73d3e87，按既有裁决独立复现与收敛。共享Launcher/web API串行交接；新范围录像合同先由控制层冻结。产品完整门禁和GPT真实UI复核仍须完成，不能因桥验收通过自动合入main或push。之后按计划推进SETUP-01，ORCH阶段保持关闭。
