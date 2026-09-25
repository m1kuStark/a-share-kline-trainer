# GLM 任务看板与后台派发

四路协作与显式控制器见[路由入口](../agent-routing/README.md)。run_glm支持已登记任务的后台执行；completed只表示执行退出，不代表独立验证或合入通过。

面向人查看的本机窗口，与Codex是否处于活动轮次无关。[monitor.py](monitor.py)提供只读HTTP页面，[index.html](index.html)显示登记任务、Prompt、最近工具描述、最终答复和独立的复核状态。[run_glm.py](run_glm.py)派发小任务并自动登记、更新完成标志。非图像理解的重活可`--model GLM-5.3`显式换型（provider配置须匹配同一模型，默认仍Flash）。

## 查看

本机已安装桌面快捷方式“GLM 任务看板”。双击会复用已有服务或重新启动，在独立Edge窗口打开。关闭窗口不结束GLM任务。运行副本和状态在`$CODEX_HOME/headroom-cache/glm-monitor/`，不依赖临时worktree存活。

页面可见时每5秒读取本机状态，不发送模型请求。仅监听127.0.0.1，随机路径、Host检查、不开放CORS、不提供写接口。读取Zcode SQLite使用mode=ro，只查任务登记指定的会话，核对worktree目录；不扫描展示其他个人对话。展示工具名/描述与时间，不输出原始工具参数、结果、请求头或思考全文。Prompt与完成答复纯文本呈现，并遮蔽常见凭据格式。

“运行中”由登记进程与创建时间判定；无新活动只作提示，不能证明卡死。“开发完成”是模型退出与完整答复；“模块已复核”须由集成人写入review，不自动等同整项功能验收。读库失败、断开、进程异常退出分别显示，不假装正在正常推进。

模型请求、长时间无工具及旧修正任务关联详见[运行观察](health.md)。

## 用量与额度

看板增加[原生统计与额度来源](usage.md)：通过CLI `session/usage`取得会话累计，直接查询当前委派配置对应的BigModel官方Coding Plan额度，并独立显示Zcode Desktop已收到的活动套餐余额快照。会话统计采用Zcode去重口径，不代表账单Token；续接不重复汇总。余额不本地估算、不从token换算，也不自动切换套餐。

`usage`和`quota`端点使用后台缓存，读取不阻塞原任务状态；每60秒最多刷新一轮，失败明确标记过期。每个来源显示采样时间，桌面快照的更新时间不随网页刷新而变化。新登记显示new/resume、续接来源、附件数量/文件名和CLI版本；旧登记未记录的字段不猜测。

运行目录`sources.json`配置CLI和委派provider文件路径，格式见[用量维护说明](usage.md)。凭据不进入页面、仓库或错误信息。界面回归：`node scripts/agent-monitor/test_monitor_ui.cjs`（使用仓库或Git公共目录中的Playwright，证据写至仓库外）。

## 派发

从明确独立worktree出发，用已安装的run_glm.py执行；传`--batch`唯一批次、`--title`、`--cwd`、`--prompt`、`--log`、`--provider`（单次配置的来源）、`--cli`（Zcode resources/glm/zcode.cjs）、`--wake-state`（当前线程交接标志）。可选`--resume`，不得恢复仍运行会话；`--attach`可重复，仅接受图片（gif/jpeg/jpg/png/webp）与视频（mp4/m4v/mov/webm/mkv/avi）后缀，其他后缀派发前即报错。默认stream-json保存逐事件日志和末尾摘要，能力与实测边界见[官方核对](../../docs/engineering/zcode-official-capabilities.md)。

运行预算参数（2026-09-20新增）：`--permission-mode`默认yolo并显式传给CLI `--mode`，不依赖CLI默认值防未来变化导致无头权限死锁；`--timeout-minutes`总时长上限默认0不限；`--idle-minutes`空闲上限默认5分钟、设0关闭；`--max-output-tokens`输出预算默认32768、不得超过官方上限128000。空闲判定信号=任务日志增长、登记会话的库内活动、或应用日志中已started无完成的在途模型请求（在途不判死，兼容max档单次长思考，实测单请求744秒、历史记录989秒）；会话未识别前空闲判定不武装。超时只停止该任务PID子树，保留日志与已写文件；job登记`timeoutKind`与错误指引，要求主代理确认工作树改动后以**新批次ID**携更大预算重派，不得复用原批次。每份登记记录派发时的`cliVersion`，升级排障以此为准。

必须以Windows独立后台Popen、隐藏窗口及独立日志启动。runner阻塞等待子进程，不调用Codex轮询。`--parallelism`默认1、允许1～4；并发上限受订阅账号级额度与动态限流约束（无官方固定并发数，见[官方核对](../../docs/engineering/zcode-official-capabilities.md)），实践2～3路稳定，重现429/1302则下调。locks目录分别持有规范化worktree锁、唯一batch锁和slot锁，拒绝同工作树双写/批次覆盖/超槽位调用，不自动抢遗留锁。旧worker.lock存在时拒绝迁移启动。模型固定GLM-5.3-Flash及max思考档；输出预算32768。凭据仍由Zcode原登录存储读取，配置副本和日志不入Git。

并行调用禁止`--wake-state`，以各job.json作为权威状态；集成人写group索引列出本批jobFiles。heartbeat逐项处理新完成/失败批次，不能因某个running隐藏其他已完成结果。各任务独立log/provider配置，不共用输出文件。限流以真实请求为据，有限重试后调整下一批并发数。

派发后结束Codex轮次。当前线程的heartbeat读取完成标志再验收，读到running立即退出；完整交接和其他待复核批次不能因派发新任务被遗忘。异常退出保留日志、改动和批次记录；确认无运行进程后才能处理遗留锁或重试。

## Verification

`py -3.9 -m unittest discover -s scripts/agent-monitor -p "test_*.py"`验证隔离、生命周期、遮蔽、地址校验、事件流和附件；UI检查单独执行。

CLI与Zcode桌面会话索引不同，观察限制见[模型CLI经验](../../docs/engineering/zcode-cli.md)。升级后复查，不手改桌面数据库。

与[模型协作规则](../../docs/engineering/model-delegation.md)、[并行协议](../../docs/engineering/parallel-development.md)配合使用。

复用既有窗口前验证server.json中的URL为精确127.0.0.1、合法端口和单层token路径；健康请求禁重定向、禁环境代理，不能让损坏元数据发起外部请求。
