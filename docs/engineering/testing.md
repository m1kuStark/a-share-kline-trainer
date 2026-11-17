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

server 与 desktop 的 Vitest 均使用 threads 池、maxWorkers=2。Windows CI曾在fork池发生ERR_IPC_CHANNEL_CLOSED，日志未提供worker原始退出原因，不能称作业务断言失败。保留完整用例和断言，以线程池避开该IPC路径；需要独立cwd的用例启动真实子进程验证，不在测试worker里chdir。Journey每run仍1worker。

GitHub Source checks 仅在 Windows 上先执行 `npm ci` 和 `npm run build`，再执行完整 `npm test`。启动器装配测试需要 `server/dist` 中的真实重启模块，不能依赖开发机残留构建产物。CI 保留 JSON 测试报告供失败排查。Windows 路径解析使用 `path.win32`；操作真实临时文件的测试使用宿主绝对路径，平台专用查询通过明确的平台夹具验证。

## UI-VISUAL-ACCEPTANCE

新schemaVersion=2证明只有被控制层重算为docs-only时允许visual=not_applicable：非空变更全是普通非执行Markdown，限docs下或根README/CONTRIBUTING，排除AGENTS/CLAUDE及docs/engineering、specs、architecture；代码、配置、UI、混合及未知范围均为full。文件模式、索引隐藏标志与工作区联接也参与保守判定。

docs-only执行docs、impact、status --check，不启动产品构建、数据快照、M2或Journey；full固定执行docs、impact、unit、types、build、snapshot、m2、journey，视觉记录仍需独立提供。旧schemaVersion=1证明保留原七项必需检查和人工视觉要求。分类、检查清单、清洁状态及commit/tree绑定不匹配时拒绝复用；详细规则见[分类实现](../../scripts/worktree/README.md)。

每次产品功能或bug交付，主代理负责真实页面、无错误覆盖层、pageerror、深浅主题、桌面尺寸、空间利用、溢出、控件状态切换及交互截图检查；子代理自验不能免除。M3无需逐工具用户确认，工程整批自验后交用户整体验收。

交互回归用真实事件及状态/几何断言；临时矩形、菜单、面板加DOM可见性。只读hooks可定位与核验，禁止操作内部对象代替交互。详见[e2e规则](../../e2e/AGENTS.md)。

## 失败与证据

保留首次失败、stderr、退出码、失败截图及复跑原因。预期T+1 400是业务路径，应标注来源，不能混为未解释错误。测试通过不能证明未覆盖的整批发布/个股覆盖等缺口已修复。

M1保存导出是历史快照，源文件增长或复权基准改变可能不匹配。更新原生证据或明确共同日期/同基准才可重新声称逐值通过；不能为绿色构建静默削弱核验。

Journey每run独立端口/SQLite/前后端构建/证据，内部仍单worker。使用冻结的真实三股票/指数样本，指纹可查；不能把样本回归说成全市场实源核验。主代理统一组织候选验证，两个工作副本的独立旅程可以并行。

本地诊断（DIAG-OPLOG）另跑 `npx vitest run server/test/diagnostics-operation-log.test.ts server/test/diagnostics-operation-trace.test.ts desktop/test/diagnostics.test.ts` 与 `npm run journey -- e2e/operation-trace.spec.ts`；全量门禁仍以 `verify:baseline` 为准。

`npm run verify:baseline`执行文档、单测、类型、独立生产构建、样本M2和全量Journey，不修改个人库、原dist或历史报告。`npm run verify:candidate -- --base SHA --task ID`额外运行impact；所有检查通过且提交/工作树不变才产生候选proof。M1在改解析/复权时额外执行，旧导出差异不能当作通过。主代理视觉记录是promote前的独立条件，不等于用户验收。

新增bug先有失败回归再改生产逻辑；低影响文档编辑不写镜像测试。源码形状断言逐步迁移到行为测试时，先补等价保护再移除旧断言。测试数仅在[证据记录](../verification/README.md)维护。

隔离服务器在IPC关闭宽限后直接终止自身Node进程（OPEN_BROWSER=0，无子进程），避免Windows taskkill进程树扫描拖住验收清理；通用构建/浏览器命令仍清理其进程树。候选失败优先读取本次verification.json的失败检查与日志，proof仅在全通过时存在，不能用缺失proof覆盖真实错误。

Windows 真实进程树用例必须先确认父进程、detached 孙进程和树外哨兵都存活，再验证取消理由/日志、受管进程退出、临时目录即时释放及哨兵继续存活。夹具按所有权登记，`finally` 与 `afterEach` 共用幂等清理，先等待命令和 ChildProcess close，再删目录；最终夹具回收可对 Windows EBUSY 做有界重试，成功路径的目录释放断言不重试。RUNTIME-CANCEL-02 的 runtime 单例预算为45s（8s就绪＋20s taskkill＋两段5s退出确认＋余量），desktop 为60s（5s就绪＋30s taskkill＋15s注入退出确认＋3s孙进程确认＋余量）；生产等待上限保持原值。测试应能在撤去 `/T` 时因孙进程仍存活而失败，不能只靠附着子进程随父进程退出。诊断、原失败和每次复跑见[验证记录](../verification/2026-11/RUNTIME-CANCEL-02/validation.md)。

verify job 的测试命令经 scripts/ci/run-tests-with-retry.mjs：仅在“非 0 退出且无 Vitest 失败摘要”时重试一次（基础设施崩溃），真实断言失败不重试；重试记录打 GitHub warning，断言/用例集合/数据范围不变。desktop 全套在 desktop/vitest.config.ts 设 testTimeout 30s（TEST-BUDGET-04）；server 保持既有默认预算，个别用例的显式预算以测试声明为准。详见 [CI 门禁](ci.md)。

迁移真实文件 I/O 用例（`desktop/test/mig-inline.test.ts`、`desktop/test/mig-import.test.ts` 的整库合并/幂等用例）使用真实临时目录、`server/dist/db.js` 与 SQLite。TEST-BUDGET-02（2026-11-11）先将这些用例预算放宽到 30s，以消除 CI verify 满载时的 5s 误拦 flake；随后由 TEST-BUDGET-04 将 desktop 套件统一设为 30s，接续该局部预算方案。断言与用例集合未因此改变，server 默认预算不变。

公式引擎的实盘语料回放（`server/test/formula-engine/crossPeriod.test.ts`、`corpus-smoke.test.ts`、`marketContext.test.ts`）依赖工作区 `tdx/选股公式` 与 `ai-harness-lab/formula-recon`，不随仓库分发；路径可用 `TRAINER_TDX_FORMULA_DIR` / `TRAINER_FORMULA_CORPUS_DIR` 覆盖。CI/无语料机器会醒目跳过这些用例（其余合成夹具仍覆盖跨周期、市场上下文语义）；公式引擎交付必须在有语料的机器跑全量并保留收据，不能用 CI skip 冒充语料通过。

The docs-tooling test file uses a20second per-test integration budget: it starts real Git processes and commits temporary repositories. All assertions remain; this is not a product latency SLO. Other unit defaults and full candidate checks are unchanged.

Owned runtime readiness retries transient loopback connection errors only within the original deadline, after child identity checks. Persistent errors report the last cause; wrong PID/runId/health and malformed responses remain failures.

## 分层门禁与耗时（TEST-SPEED-01，2026-11-09 用户要求）

- **迭代循环**：`npm run verify:fast -- --unit <受影响单测文件> --journey <受影响 e2e spec>`（无参数时仅 docs:check＋build），分钟级；用于 RED/GREEN 与功能自验。
- **发布/整批验收**：全量单测＋全量 journey 一次；全量 journey 可用 `npm run journey:parallel -- --shards 2` 拆成 2~4 个独立 run 并行（各自 manifest/端口/数据库/构建/报告，单 run 仍 workers:1）。
- **失败处理**：全量中若只有既有环境 flaky 失败，只复跑失败 spec（`npm run journey -- <failed specs> --retries=0`）并保存隔离收据，不重复整轮全量；新失败仍按 RED→GREEN 修复。
- **trace**：默认关闭逐动作 trace（失败仍有截图），定向排查设 `TRAINER_TRACE=on`。
- 正式候选证明仍以 `verify:baseline` 为准；并行全量用于整批验收提速，必须保留每个 shard 的 journey.log/退出码。
