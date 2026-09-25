# 测试与交付门禁

四路协作遵循[模型协议](model-delegation.md)。影子路由不是验证器；Python独立收据与TS候选证明用途不同。ORCH-04分类门禁已实现，具体检查和视觉要求见下文；不能把局部测试声称为完整产品验收。

## 层次

| 检查 | 证明范围 |
|---|---|
| npm test | 账户、数据、API、纯前端逻辑、契约和文档工具回归 |
| npm run build | Vue严格类型、服务端TS及生产前端构建 |
| npm run verify:m1 | 本机只读TDX与保存原生导出的数值核验 |
| npm run verify:m2 | 真实TDX训练闭环、手算账户与防未来 |
| npm run journey | Edge真实事件用户旅程；只列清单不等于运行通过 |
| docs:check / docs:impact / docs:status -- --check | 文档结构、变更影响和派生状态 |

生产代码交付保持单测＋构建＋全量Journey；改变数据解析/复权时另跑M1，改变账户/训练时另跑M2。新基线收录跨模块既有改动时执行M2和浏览器全量，M1外部证据过期必须单独记录，不能以其他绿灯替代。

Vitest使用threads池、最多4个worker。Windows CI曾在fork池发生ERR_IPC_CHANNEL_CLOSED，日志未提供worker原始退出原因，不能称作业务断言失败。保留完整用例和断言，以线程池避开该IPC路径；需要独立cwd的用例启动真实子进程验证，不在测试worker里chdir。单独GLM定向测试可用maxWorkers=2；Journey每run仍1worker。

## UI-VISUAL-ACCEPTANCE

新schemaVersion=2证明只有被控制层重算为docs-only时允许visual=not_applicable：非空变更全是普通非执行Markdown，限docs下或根README/CONTRIBUTING，排除AGENTS/CLAUDE及docs/engineering、specs、architecture；代码、配置、UI、混合及未知范围均为full。文件模式、索引隐藏标志与工作区联接也参与保守判定。

docs-only执行docs、impact、status --check，不启动产品构建、数据快照、M2或Journey；full固定执行docs、impact、unit、types、build、snapshot、m2、journey，视觉记录仍需独立提供。旧schemaVersion=1证明保留原七项必需检查和人工视觉要求。分类、检查清单、清洁状态及commit/tree绑定不匹配时拒绝复用；详细规则见[分类实现](../../scripts/worktree/README.md)。

每次产品功能或bug交付，主代理负责真实页面、无错误覆盖层、pageerror、深浅主题、桌面尺寸、空间利用、溢出、控件状态切换及交互截图检查；子代理自验不能免除。M3无需逐工具用户确认，工程整批自验后交用户整体验收。

交互回归用真实事件及状态/几何断言；临时矩形、菜单、面板加DOM可见性。只读hooks可定位与核验，禁止操作内部对象代替交互。详见[e2e规则](../../e2e/AGENTS.md)。

## 失败与证据

保留首次失败、stderr、退出码、失败截图及复跑原因。预期T+1 400是业务路径，应标注来源，不能混为未解释错误。测试通过不能证明未覆盖的整批发布/个股覆盖等缺口已修复。

M1保存导出是历史快照，源文件增长或复权基准改变可能不匹配。更新原生证据或明确共同日期/同基准才可重新声称逐值通过；不能为绿色构建静默削弱核验。

Journey每run独立端口/SQLite/前后端构建/证据，内部仍单worker。使用冻结的真实三股票/指数样本，指纹可查；不能把样本回归说成全市场实源核验。主代理统一组织候选验证，两个工作副本的独立旅程可以并行。

`npm run verify:baseline`执行文档、单测、类型、独立生产构建、样本M2和全量Journey，不修改个人库、原dist或历史报告。`npm run verify:candidate -- --base SHA --task ID`额外运行impact；所有检查通过且提交/工作树不变才产生候选proof。M1在改解析/复权时额外执行，旧导出差异不能当作通过。主代理视觉记录是promote前的独立条件，不等于用户验收。

新增bug先有失败回归再改生产逻辑；低影响文档编辑不写镜像测试。源码形状断言逐步迁移到行为测试时，先补等价保护再移除旧断言。测试数仅在[证据记录](../verification/README.md)维护。

隔离服务器在IPC关闭宽限后直接终止自身Node进程（OPEN_BROWSER=0，无子进程），避免Windows taskkill进程树扫描拖住验收清理；通用构建/浏览器命令仍清理其进程树。候选失败优先读取本次verification.json的失败检查与日志，proof仅在全通过时存在，不能用缺失proof覆盖真实错误。

The docs-tooling test file uses a20second per-test integration budget: it starts real Git processes and commits temporary repositories. All assertions remain; this is not a product latency SLO. Other unit defaults and full candidate checks are unchanged.

Owned runtime readiness retries transient loopback connection errors only within the original deadline, after child identity checks. Persistent errors report the last cause; wrong PID/runId/health and malformed responses remain failures.
