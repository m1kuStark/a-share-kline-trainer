# 结算历史与只读事实成绩单

M4-HISTORY-01 交付：训练真实结算（提前/到期）后，提供历史列表与单局事实成绩单。纯同步只读查询，只依赖 `trainings/trades/equity_curve/drawings` 持久数据；不读行情 bars、不做 TDX 扫描、不做 adj_factors 重放、不按今日规则重算已结束训练。

| 任务 | 入口 |
|---|---|
| API 参数/错误契约 | [api.ts](../api.ts)：`GET /api/trainings/history`、`GET /api/trainings/:id/report` |
| 列表/报告事实口径 | [history-report.ts](../history-report.ts)：`historyList`、`historyReport`、`settledFact` |
| 回归 | [history-report.test.ts](../../../test/history-report.test.ts)（23 项：分类/稳定排序/分页/冻结手算/损坏行隔离/no-future oracle） |

## 事实口径（冻结）

- **结算方式 vs 数据完整性**：`classification`（complete/early-settled）只描述结算方式；`integrity` 才描述该行事实是否可认证。两者互不冒充。
- **finalEquity** 唯一取 `equity_curve` 中 `date === settle_date` 的持久点；不从末笔 `cash_after`、最新价格或今日规则重算。缺失/非有限、`settle_date` 缺失、`initial_cash` 非正有限 → `integrity=unavailable`，`finalEquity/returnRate=null` 并给中文原因，不以 0/前一日代补。
- **一行损坏不影响其他行**：坏 `rules_json` 与 `legacy-raw-unverified` 行在列表中仅标不可用（保留基本标识与原因）；报告侧分别 409 `TRAIN_RULES_UNREADABLE` / `LEGACY_RAW_ACCOUNTING_UNVERIFIED`。合法新 raw（`adjust_mode=raw` 且规则 `cash-shares-v1`）不受否定。
- **报告错误契约**：非法 ID 400、无此 ID 404、未 settled 409 `HISTORY_NOT_SETTLED`、结算权益缺失 409 `HISTORY_EQUITY_UNAVAILABLE`。
- **范围限定**：权益曲线按 date 升序、成交按 seq 升序，均限定 `start_date..settle_date`，范围外数据不输出。`returnRate=(finalEquity-initialCash)/initialCash` 为比率，UI 层转百分比；成交行费用仅为展示（已含在权益里，不重复扣减）。
- **画线**：无行=未保存（空数组，非错误）；行存在但 JSON 不可读 → `drawingsStatus=unavailable`+中文原因，绝不伪装成空成功；其余账户事实照常呈现。画线只做只读标注清单（类型/pane/锚点时间与数值，保留原始价格基准），不映射到权益坐标、不新增行情 K 线或编辑器。
- **no-future 守卫**：存在任何 running 训练时，列表与报告（含直接 ID 访问）先 409 `HISTORY_ACTIVE_TRAINING`，零历史内容。调用方必须保证守卫检查与其后的读取处于同一同步调用（本模块全部为同步函数，中间不得插入 await）。

## 不做的事

排行（`GET /api/rankings` 保持 404）、最大回撤、胜率、盈亏比、沪深300超额/基准接入、训练时钟、成交理由、条件单、旧数据回填或修复性写入。完整 K 线复盘另依赖 DATA 保护范围，不冒称已具备。
