# 本机Z code委派经验

2026-09-18实际核验：桌面ZCode 3.12.3，自带CLI 0.16.5，入口为安装目录 `resources/glm/zcode.cjs`，由Node24执行。本机位置为D盘MySoftWares/Zcode；跨机器先发现安装位置，不硬编码为项目必需路径。

2026-09-20补充：[官方资料与本机多模态/事件流能力](zcode-official-capabilities.md)。

## 可用调用

使用参数数组调用Node＋入口，支持 `--cwd <独立worktree>`、`--prompt <读取prompt文件的文本>`、`--json`、`--no-color`。本版本帮助列出的 `--max-turns`/`--settings`不在实际参数解析器里，会被拒绝；`/model`在headless prompt中是普通模型消息，不能用于确认模型配置。

裸运行会找错builtin provider配置路径。通过进程环境指定 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 和 `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE` 到安装目录config/provider/zcode-builtin.json；`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指向本轮专用配置副本。不要在共享的用户全局配置上反复切换模型。

本机已验证providerId=bigmodel-api、modelId=GLM-5.3-Flash、reasoningLevel=max。真实模型请求包含thinking enabled和output_config.effort=max；现有登录/凭据由Z code读取，不进入Prompt或Git。

专用模型配置设置contextWindow=1000000。CLI projection.contextWindow仍返回200000初始统计值，因此只声明已配置1M，不把摘要统计视为已证实的1M实测；没有用百万token探针浪费订阅额度。后续版本应复查这一差异。输出上限独立设置：8192曾导致图表捕获任务以“response exceeded the output token maximum”退出；后续小任务采用32768预算，保留max思考档。

## 调度规则

- Prompt给出当前worktree、有限写范围、已有接口、定向测试和停止条件；禁止worker自行push/reset/合并/修改个人库。
- 首先用极小类型/接口任务验证读写与类型检查，然后分开validator、状态机、图表接线、回放页。一次性多模块任务在max档可能长时间停留；超过合理观察窗口先查真实请求/工具进度，再缩小任务。
- 头部JSON摘要只在任务结束返回，不能把无stdout误当无进展。由运行协调器在完成时通知主代理，主代理只收一次摘要；不以短周期轮询日志、Git差异或SQLite会话。仅异常退出或预设超时触发定向诊断，禁止扫描无关会话内容。
- 2026-09-19调度修正：等待中的原生子代理也不应长期占用活动轮次。Windows独立后台进程通过进程句柄等待退出，完成后写状态文件；Codex结束本轮，由原线程heartbeat后续读取。监视进程已做真实短子进程退出自测；自动唤醒是否成功以首次续接事实为准，创建成功不等于已经验证完整唤醒链路。
- 超时只停止确认属于该任务的PID及子树，保留日志和已写文件；停止后重新检查工作树，再派更小的修正任务，不让两个进程同时写同一文件。
- Z code mimosa插件产生 `.mimosa/` hook状态，已在项目忽略。新运行文件不得悄悄进入Git；若有全局hook行为影响任务，记录而非降低干净工作树闸门。
- 返回通过后仍由主代理运行测试和审查。本轮后端审查曾发现模块以文件位置算仓库根不适用于隔离构建；改用架构约定的worktree cwd，并补回归。
- 本机订阅曾在多调用并发时返回429/1302；用户后续明确要求提升并行度。本轮2任务启动核验分别已有9/8次completed请求且无错误，随后加入第3个独立存储任务。失败保留请求ID与时间，重试有限退避；若重现限流则下调并发，不反复轰击服务。启动成功不等于整批运行稳定，后续按完成/异常证据调整。
- 最大thinking effort与输出token上限独立。小任务采用有限输出预算，保持max档；长时间无进展先检查是否限流、网络还是生成中，再缩小Prompt，不凭无stdout猜测。

Prompt是可审查工件，保存到任务文档；原始模型日志保存在全局Headroom缓存，正式报告只引用必要结果与模型标识。
