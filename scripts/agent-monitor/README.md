# GLM 任务看板与后台派发

面向人查看的本机窗口，与Codex是否处于活动轮次无关。[monitor.py](monitor.py)提供只读HTTP页面，[index.html](index.html)显示登记任务、Prompt、最近工具描述、最终答复和独立的复核状态。[run_glm.py](run_glm.py)派发小任务并自动登记、更新完成标志。

## 查看

本机已安装桌面快捷方式“GLM 任务看板”。双击会复用已有服务或重新启动，在独立Edge窗口打开。关闭窗口不结束GLM任务。运行副本和状态在`$CODEX_HOME/headroom-cache/glm-monitor/`，不依赖临时worktree存活。

页面可见时每5秒读取本机状态，不发送模型请求。仅监听127.0.0.1，随机路径、Host检查、不开放CORS、不提供写接口。读取Zcode SQLite使用mode=ro，只查任务登记指定的会话，核对worktree目录；不扫描展示其他个人对话。展示工具名/描述与时间，不输出原始工具参数、结果、请求头或思考全文。Prompt与完成答复纯文本呈现，并遮蔽常见凭据格式。

“运行中”由登记进程与创建时间判定；无新活动只作提示，不能证明卡死。“开发完成”是模型退出与完整答复；“模块已复核”须由集成人写入review，不自动等同整项功能验收。读库失败、断开、进程异常退出分别显示，不假装正在正常推进。

模型请求、长时间无工具及旧修正任务关联详见[运行观察](health.md)。

## 派发

从明确独立worktree出发，用已安装的run_glm.py执行；传`--batch`唯一批次、`--title`、`--cwd`、`--prompt`、`--log`、`--provider`（单次配置的来源）、`--cli`（Zcode resources/glm/zcode.cjs）、`--wake-state`（当前线程交接标志）。可选`--resume`，不得恢复仍运行的会话。

必须以Windows独立后台Popen、隐藏窗口及独立日志启动。runner阻塞等待子进程，不调用Codex轮询。`--parallelism`默认1、允许1～4；当前协调器新调用统一设3（最初两个已占用槽0/1，新增占用槽2）。locks目录分别持有规范化worktree锁、唯一batch锁和slot锁，拒绝同工作树双写/批次覆盖/超槽位调用，不自动抢遗留锁。旧worker.lock存在时拒绝迁移启动。模型固定GLM-5.3-Flash及max思考档；输出预算32768。凭据仍由Zcode原登录存储读取，配置副本和日志不入Git。

并行调用禁止`--wake-state`，以各job.json作为权威状态；集成人写group索引列出本批jobFiles。heartbeat逐项处理新完成/失败批次，不能因某个running隐藏其他已完成结果。各任务独立log/provider配置，不共用输出文件。限流以真实请求为据，有限重试后调整下一批并发数。

派发后结束Codex轮次。当前线程的heartbeat读取完成标志再验收，读到running立即退出；完整交接和其他待复核批次不能因派发新任务被遗忘。异常退出保留日志、改动和批次记录；确认无运行进程后才能处理遗留锁或重试。

## 测试与维护

`py -3.9 -m unittest discover -s scripts/agent-monitor -p 'test_*.py'`覆盖任务隔离、会话匹配、进程退出、复核分离、遮蔽、读库故障、批次保护、同树排他/并发槽位（含双进程）、并行禁止共享唤醒文件、真实短子进程完成、生命周期跨请求/跨session/轮转及修复关联。UI验收另查无新JSON时跨过提示阈值、修复跳转、Prompt、深浅主题、溢出、文本注入及pageerror。

本机2026-09-19 Zcode3.12.3/CLI0.16.5：CLI记录在`.zcode/cli/db/db.sqlite`，桌面另有`.zcode/v2/tasks-index.sqlite`；本工程worktree在桌面索引未登记。未找到CLI session直接进入GUI的入口；不手改桌面数据库。SQLite结构属本机适配，升级后需复查；优先在将来采用官方公开任务观察接口。

与[模型协作规则](../../docs/engineering/model-delegation.md)、[并行协议](../../docs/engineering/parallel-development.md)配合使用。
