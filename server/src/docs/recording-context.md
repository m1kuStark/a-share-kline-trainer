# 录制上下文（recording-context）

录制文件需要记录"实际观察到的"规则、版本与已发生权息，而不是产品规格的目标状态。本模块提供只读观察端点，供录制器在保存时刻调用。

## 接口

`GET /api/trainings/:id/recording-context`，由 `registerRecordingContextRoutes(app, config, database)`（[../recording-context.ts](../recording-context.ts)）注册。

响应形状：

- `app`：`version`（项目根 package.json）、`gitCommit`（`git rev-parse HEAD`）、`dirty`（`git status --porcelain` 非空）、`chartLibrary: '10.0.3'`（klinecharts 钉定版本，见根 AGENTS）。项目根取 `process.cwd()`（导出 `resolveProjectRoot()` 作为可测根定位；运行架构以 cwd 固定在 worktree 根启动）。不用 `import.meta.url` 上推：隔离构建产物在 `.runs/<run>/server/` 下，上推两级会把根推成 `.runs`，package.json 落空导致版本 `unknown`。版本与 git 状态在路由注册时读取一次（`readAppInfo(root?)`）；git 读取用 `execFileSync` 参数数组、无用户输入，失败回退 `unknown`/`false`。
- `rules`：`feesEnabled`、`tPlusOne` 每次请求读取 settings 当前值（`fees_enabled` 回退关、`t1_enabled` 回退开，与 [engine.ts](../train/engine.ts) 的 `feeConfigOf/t1Enabled` 一致）；`lotSize/commissionRate/minimumCommission/stampDutyRate` 取 [account.ts](../train/account.ts) 常量（100 / 0.00025 / 5 / 0.0005）；`execution: 'same-day-raw-close'`、`weightBasis: 'total-equity'` 为现行实现语义；`adjustMode` 取训练记录；`observedAt` 为本次观察时间。
- `positionEvents`：`position_events` 中 `training_id` 匹配且 `date <= 截止` 的行，按 `date, seq` 稳定排序，字段 `seq/date/kind/sharesDelta/cashDelta/costDelta`（旧 NULL `costDelta` 原样保留）。截止日 = `trainings.current_date ?? start_date`。

错误遵循既有合约：`id` 按严格十进制正整数字符串校验（`/^[1-9][0-9]*$/`；`1e0`、`0x1`、`1.0`、`01`、`+1` 等 `Number()` 宽松解析接受的形式一律 400 `id 必须是正整数`）；训练不存在 404 `训练 {id} 不存在`（HttpError，由 registerApi 的全局错误映射输出中文）。

## 语义边界

- 这是**观察到的现行规则**，不是冻结快照：费用/T+1 尚未按训练创建时冻结（缺口见 [TRAIN-01](../../../docs/work-items/tasks/TRAIN-01.md)），录制文件若需强可复现，应把本端点响应与录制数据一起存档。
- 只读：不写任何数据库行；不访问 TDX 文件与 `/api/kline`；不下发截止日之后的权息事件（未来数据防泄漏由测试人为种未来事件验证）。
- 不返回本机路径、环境变量或密钥材料；`app` 对象键集合固定为 `version/gitCommit/dirty/chartLibrary`。

## 实现注意

`current_date` 是 SQLite 关键字 `CURRENT_DATE`：在 SELECT 选择列表中裸写会得到当天日期而非列值（`UPDATE ... SET current_date` 与 `CREATE TABLE` 列定义不受影响，`engine.ts` 走 `SELECT *` 也未触发）。本模块的选择列表必须写 `"current_date"`。参见 [data publication](../data/docs/publication.md) 之外的同类注意：列名引用尽量与既有查询保持一致。

## 接线

集成方在 `registerApi`（[../api.ts](../api.ts)）错误处理器注册之后调用 `await registerRecordingContextRoutes(app, config, database)` 即可；本模块不修改 api.ts/db.ts。

## 验证记录

- 2026-09-18，worktree `task/REC-CONTEXT`：先写测试确认失败（模块不存在），再实现。
  - `npm test -- server/test/recording-context.test.ts`：8 passed，退出码 0。覆盖：错误 id 400、不存在 404、settings 实际值（含未配置回退）、`current_date` 截止过滤与 `date/seq` 排序（人为种未来事件与其他训练事件）、响应无绝对路径/配置信息、请求前后整库行不变。
  - `npm run build:server`：退出码 0。
  - 测试用真实临时 SQLite 文件 + `Fastify.inject`，复用 `registerApi` 获得真实错误映射；不触碰个人训练库与真实 TDX 目录。
- 中途发现并修复：SELECT 列表中裸写 `current_date` 返回关键字日期导致截止过滤失效，已改为 `"current_date"` 并回归通过。
- 2026-09-19，worktree `task/REC-CONTEXT`：审查修复——项目根改按 `process.cwd()` 定位（隔离构建 `.runs/<run>/server` 下 `import.meta.url` 上推会得到 `.runs`），`id` 改严格十进制正整数字符串校验。先加失败测试再修：`1e0/0x1/1.0/01/+1` 原被宽松解析放行；`resolveProjectRoot/readAppInfo` 导出原不存在。
  - `npm test -- server/test/recording-context.test.ts`：11 passed（原 8 + 新 3：非规范 id 拒绝；chdir 到隔离构建根时定位跟随 cwd 且严格降级、不读 `.runs` 诱饵包；cwd 为 worktree 根时 version/git 准确且诱饵不干扰），退出码 0。
  - `npm run build:server`：退出码 0。
  - 隔离构建场景以临时 `.runs/run-uuid/server/index.js` 布局 + `.runs/package.json` 诱饵模拟（未做整库构建）；vitest 3 默认 forks 池，`process.chdir` 在用例内安全并在 finally 还原。
