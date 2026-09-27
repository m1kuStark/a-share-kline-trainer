# 录制上下文（recording-context）

录制文件需要记录"实际生效的"规则、版本与已发生权息，而不是产品规格的目标状态。本模块提供只读观察端点，供录制器在保存时刻调用。

## 接口

`GET /api/trainings/:id/recording-context`，由 `registerRecordingContextRoutes(app, config, database)`（[../recording-context.ts](../recording-context.ts)）注册。

响应形状：

- `app`：`version`（项目根 package.json）、`gitCommit`（`git rev-parse HEAD`）、`dirty`（`git status --porcelain` 非空）、`chartLibrary: '10.0.3'`（klinecharts 钉定版本，见根 AGENTS）。项目根取 `process.cwd()`（导出 `resolveProjectRoot()` 作为可测根定位；运行架构以 cwd 固定在 worktree 根启动）。不用 `import.meta.url` 上推：隔离构建产物在 `.runs/<run>/server/` 下，上推两级会把根推成 `.runs`，package.json 落空导致版本 `unknown`。版本与 git 状态在路由注册时读取一次（`readAppInfo(root?)`）；git 读取用 `execFileSync` 参数数组、无用户输入，失败回退 `unknown`/`false`。
- `rules`：自 TRAIN-01 起来自本局冻结的规则快照（`trainings.rules_json`，经 engine `trainingRulesOf` 严格读取；缺失/损坏/版本不支持 409 `TRAIN_RULES_UNREADABLE`，不回退当前 settings）。数值字段与快照一致：`feesEnabled/tPlusOne`、`lotSize/commissionRate/minimumCommission/stampDutyRate`、`execution: 'same-day-raw-close'`、`weightBasis: 'total-equity'`、`corporateActionPolicy`。来源元数据 `rulesOrigin`（created/legacy-migration）与 `rulesCapturedAt`（冻结时点）以可选字段如实透出；`adjustMode` 取训练记录；`observedAt` 为本次观察时间，与冻结时点独立。
- `positionEvents`：`position_events` 中 `training_id` 匹配且 `date <= 截止` 的行，按 `date, seq` 稳定排序，字段 `seq/date/kind/sharesDelta/cashDelta/costDelta`（旧 NULL `costDelta` 原样保留）。截止日 = `trainings.current_date ?? start_date`。

错误遵循既有合约：`id` 按严格十进制正整数字符串校验（`/^[1-9][0-9]*$/`；`1e0`、`0x1`、`1.0`、`01`、`+1` 等 `Number()` 宽松解析接受的形式一律 400 `id 必须是正整数`）；训练不存在 404 `训练 {id} 不存在`（HttpError，由 registerApi 的全局错误映射输出中文）。

## 语义边界

- 规则自 TRAIN-01 起是本局冻结快照：全局默认修改、迁移幂等重跑都不改变本局响应；`rulesCapturedAt` 区分 created（创建时冻结）与 legacy-migration（迁移时点冻结，不伪称创建时规则）。旧录像缺这些可选字段按原 reader 读取，不改写旧文件。
- 只读：不写任何数据库行；不访问 TDX 文件与 `/api/kline`；不下发截止日之后的权息事件（未来数据防泄漏由测试人为种未来事件验证）。
- 不返回本机路径、环境变量或密钥材料；`app` 对象键集合固定为 `version/gitCommit/dirty/chartLibrary`。

## 实现注意

`current_date` 是 SQLite 关键字 `CURRENT_DATE`：在 SELECT 选择列表中裸写会得到当天日期而非列值（`UPDATE ... SET current_date` 与 `CREATE TABLE` 列定义不受影响，`engine.ts` 走 `SELECT *` 也未触发）。本模块的选择列表必须写 `"current_date"`。参见 [data publication](../data/docs/publication.md) 之外的同类注意：列名引用尽量与既有查询保持一致。
