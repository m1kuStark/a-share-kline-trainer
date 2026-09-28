# DATA-05 实现验证报告（工作树 task/DATA-05-integration）

日期：2026-09-25。实现者：GLM（Z Code 会话）。合同：DATA-05-integration 派发提示词存于原 DATA 会话工作区（未随本候选携带）；冻结口径见 docs/engineering/release-032-contracts.md。

## 范围与基线

- 起点 af0efaf（FRESH-01/RANGE-01 已验收）。三套基线先跑绿：freshness 26 + refresh 13 + catalog-protection 3 = 42 通过。
- 交付：协调器注入已验收 `assessFreshness` 与上交所2026离线日历；`DataStatusPayload` 新增 `freshness` 与 `calendar` 元信息；首页按 current/stale/unknown 三态显示并常驻手动"重新读取"入口；可见页 60s 廉价 GET 重判（隐藏暂停、回前台恢复、卸载清理）。

## 失败先行

- 新建 `server/test/data-calendar.test.ts`、`server/test/data-status-timing.test.ts` 后首跑红灯：`Failed to load url ../src/data/calendar.js`（模块尚未实现）。证据：[red-first-run.txt](./red-first-run.txt)（exit=1）。
- 随后最小实现 `server/src/data/calendar.ts` 并接线协调器，再扩展边界用例。

## 实现

- `server/src/data/calendar.ts`（新）：SSE 2026 全年 19 个工作日闭市日内嵌（周末由纯模块处理），来源元信息（url/快照 sha256/retrievedAt/公告文号；publishedDate=null；注明"未完成深交所独立交叉核验，不宣称双源"）。生产不联网。
- `server/src/data/refresh.ts`：`CreateRefreshCoordinatorOptions` 新增 `now`（测试时钟）与 `calendar`（undefined=内置官方日历；null=显式无日历）；`getStatus` 每次调用重算 `freshness`，payload 新增 `freshness` 与 `calendar` 元信息；legacy `needsUpdate`/`reason` 原样保留为兼容提示。
- `web/src/api.ts`（仅 DataStatus 相关）：`DataFreshness`/`DataCalendarInfo` 类型。
- `web/src/dataStatus.ts`：`startStatusTicker`/`stopStatusTicker`（周期=60s 节流常量，回调内再校验可见性；只 GET，不定时 POST）；`onDataActive` 恢复计时；`cancelDataWatchers` 清理。
- `web/src/App.vue`：状态机改由 freshness 驱动（current→绿色；stale→琥珀"更新日线"＋"先在通达信完成盘后下载…不联网"指引；unknown→中性"数据截至…，最新交易日待确认"，无绿点）；ok/unknown 常驻 `data-reread-btn`"重新读取"；visibilitychange→hidden 停止计时。新增样式写在 App.vue scoped 块（styles.css 未动）。

## 测试与退出码

| 命令（仓库根） | 结果 | exit |
|---|---|---|
| `npm test -- server/test/data-freshness.test.ts server/test/data-refresh.test.ts server/test/catalog-protection.test.ts --maxWorkers=2`（基线） | 42 passed | 0 |
| `npm test --`（上述5套件，含新增 calendar/timing） | 58 passed（freshness 26、calendar 7、timing 6、refresh 16、catalog 3） | 0 |
| `npm test -- server/test/frontend-data-status-contract.test.ts` | 17 passed | 0 |
| `npm run build` | typecheck:web + tsc server + vite build 通过（chunk>500kB 警告为既有） | 0 |
| `npm run journey -- e2e/data-update.spec.ts --retries=0` | 6 passed / 0 unexpected；evidence：.runs/run-abfd41c5-e8c1-4933-a9b6-93c4d7b4c434 | 0 |

六套件合并终跑 75 passed（exit=0）：[final-test-run.txt](./final-test-run.txt)；journey 输出：[journey-run.txt](./journey-run.txt)。

新增/改写覆盖（对合同必须覆盖项）：14:59/15:00 分界与跨15:00重判（calendar、timing）、非上海主机（固定 UTC 时刻确定性，纯模块不含本地时区读取）、官方休市/周末回退（calendar、timing）、日历缺失与2026越界 unknown（timing、calendar）、unknown 不绿色（e2e d、前端契约）、扫描 unchanged 仍 stale（timing）、失败保留 freshness（refresh o）、current 仍能手动读取（refresh p、e2e b/c）、隐藏暂停与回前台恢复（前端契约、dataStatus 实现）。

## 允许范围偏差（需集成人知悉）

- `server/test/frontend-data-status-contract.test.ts` 不在任务卡允许路径内，但其中"已最新时按钮不渲染"断言编码了被本合同明确推翻的旧产品决策（"始终提供重新读取入口"）。按合同对 e2e 同类断言的处理方式（改为新需求而非删除），最小改写该文件：ok 分支仍断言无内嵌按钮，新增 freshness 状态机、unknown 不绿色、常驻 `data-reread-btn`、ticker/隐藏恢复与卸载清理断言；其余 14 项断言未动。
- `docs/status.md` 为生成摘要：任务卡（允许路径内）next_action 变更后按仓库规则运行 `npm run docs:status` 再生成，docs:check 归零（0 errors）。仅 DATA-05 行摘要与证据链接变化。

## 风险与边界

- 2027年起（或时钟越界）freshness 一律 unknown，需更新日历版本（calendar.ts 与证据 JSON 由测试强制一致）。
- legacy `needsUpdate` 启发式（本地时区最近工作日）保留，Launcher 训练确认框仍用它作建议；节假日可误报，属规格允许。
- 官方发布日期字段保持 null；来源日期未知未回填。
