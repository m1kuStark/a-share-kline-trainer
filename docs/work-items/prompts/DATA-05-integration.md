# DATA-05 首页新鲜度完整接线

你是本任务的GLM实现者。仅在当前 `task/DATA-05-integration` 工作树开发；起点是af0efaf上的已验收FRESH-01/RANGE-01，调度者已建立工作树并准备本合同，不再新建纯模块或采用22fcdac替代实现。用户已授权实现和本地提交；不push、不合入main、不部署。先读任务卡及受影响目录AGENTS。

## 结果与边界

交付用户在首页可以区分“本地扫描结果”和“市场数据新鲜度”，盘后/节假日不会错误显示已最新。复用 `assessFreshness`，保持扫描单飞行、原子发布、超时屏障及业务错误码。具体实现方式自行判断；不要另建调度系统或顺带修改训练/录像。

- `DataStatusPayload`新增 `freshness: FreshnessResult`，沿用现有state、lastResult、sourceMaxDate等字段；旧needsUpdate保留为兼容提示，不能再用于界面断言“已最新”。增加可选日历来源元信息（id/from/through/source URL/版本）；日历缺失或无覆盖明确unknown。
- 当前已核实的正式资料是 `docs/verification/2026-09/DATA-05/calendar-source.json`：上交所2026全年休市表，19个工作日休市日。以明确年度覆盖的离线资料注入协调器，生产不联网查询。保留来源/版本，2027或覆盖不足返回unknown。2026-09-25是中秋休市，预期最近已完成交易日是09-24。没有独立深交所双源核验，不这样宣称；来源日期未注明的字段保留null。
- 协调器提供测试用的now/calendar注入。Asia/Shanghai、15:00分界由已有纯模块负责；sourceMaxDate是目录最大日，不证明每股完整。首次未扫描、来源不可读、扫描无变化但日线落后、失败均要准确说明。
- UI绿色已最新只对应freshness.current；unknown显示“数据截至…，最新交易日待确认”，stale提示先去通达信下载盘后日线，再回来重新读取。始终允许手动“重新读取本地日线”，不暗示联网下载。扫描按钮运行/不可用状态保留。
- 可见页面每60秒廉价GET状态并在回前台重新检查，隐藏停止计时，卸载清理；跨15:00和跨日期能重判。不定时POST扫描，不干扰训练画线，不引入高频文件扫描。

独占文件：server/src/data/**；server/test/data-refresh.test.ts、data-freshness.test.ts及新建data-calendar.test.ts/data-status-timing.test.ts；web/src/api.ts（仅DataStatus相关）、web/src/dataStatus.ts、web/src/App.vue；e2e/data-update.spec.ts；docs/specs/market-data/requirements.md；本DATA-05任务卡和验证目录。无需改server/src/api.ts路由（现有两个入口直转coordinator）。不改db、train、recording、TDX个人目录；不得扩大权限或删除既有回归。

## 验证与交接

基线已跑：freshness26 + refresh13 + catalog-protection3 = 42项通过。先取得一个准确失败回归，再完成最小可运行接线，然后扩展边界。批量进行必要文件读取，不输出长篇推理；尽早留下有效diff和定向测试证据。

必须覆盖：14:59/15:00、非上海主机、官方休市/周末、日历缺失/过期、未知不绿色、扫描unchanged仍stale、失败、current仍能手动读取、前台跨收盘/隐藏暂停及恢复。e2e/data-update已有“正常不显示按钮”的旧断言需按新需求改为始终有手动入口，而非删除行为验证。

从本工作树执行：`npm test -- server/test/data-freshness.test.ts server/test/data-refresh.test.ts server/test/catalog-protection.test.ts --maxWorkers=2`及新增套件；`npm run build`；`npm run journey -- e2e/data-update.spec.ts --retries=0`。Journey仅用隔离产物和库，不连接生产端口。个人库和TDX不作测试夹具。保留首次失败及复跑原因，关键证据放本任务验证目录；集成人再跑完整门禁与实际UI验收。

禁止读取/打印完整环境变量、凭据文件、用户会话日志；测试必须用合成配置，断言不能输出os.environ/process.env。Mimosa已获用户授权关闭，保持现状，不改用户设置。若任务卡或环境出现新事实，记录具体证据再收敛方案，不反复重做已完成模块。

完成后正常提交仅本任务文件，短报告返回commit、changed_files、tests与退出码、未完成/风险。不用返回完整源文件或思考过程。
