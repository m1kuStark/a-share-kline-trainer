# 结算历史与只读事实成绩单

已结算训练的历史查询与单局事实展示（M4-HISTORY-01 已交付）。只读持久事实：`trainings/trades/equity_curve/drawings`；不读行情、不做 TDX 扫描、不按今日规则重算已结束训练。

## 历史列表

- `GET /api/trainings/history`：只返回 `status='settled'` 的训练；abandoned 与 running 不出现。
- `classification` 只描述**结算方式**：`complete`（到期结算）/`early-settled`（提前结算）；它不认证历史数据完整性——完整性由 `integrity` 表达。
- 排序：`settle_date DESC, id DESC` 稳定排序；分页 `limit` 默认 20（正整数 1..100）、`offset` 默认 0（非负整数），非法返回 400；响应含 `total/items/limit/offset`。
- 每行：id、代码/名称、tier、`rangeMode`（RANGE 训练如实标注 preset/latest/bars；旧五档训练为 tier，不并入五档）、classification、起止日期、初始资金、`finalEquity`、`returnRate`、成交笔数、`integrity`。
- `finalEquity` 唯一取 `equity_curve` 中 `date === settle_date` 的持久点；不从末笔 `cash_after`、最新价格或今日规则重算，不以 0/前一日代补。结算日点缺失/非有限、`settle_date` 缺失、初始资金非正有限 → 该行 `integrity=unavailable`（`finalEquity/returnRate=null`＋中文原因）。一行损坏只影响该行；坏 `rules_json` 与 legacy-raw 行仅标不可用，不影响其他行。

## 只读事实成绩单

- `GET /api/trainings/:id/report`：非法 ID 400；无此 ID 404；未 settled（含 abandoned）409 `HISTORY_NOT_SETTLED`。
- 内容：事实元信息（含结算方式、训练区间、复权方式）、冻结规则（含 `origin`/`capturedAt`；`legacy-migration` 如实标注为迁移时点观察）、初始资金、最终权益、收益率（比率，UI 转百分比）、逐笔成交（序号/日期/买卖/价格/股数/金额/费用，seq 升序）、持久权益曲线（date 升序）、画线标注清单。
- 范围限定：曲线与成交限定 `start_date..settle_date`，范围外数据不输出。零成交训练如实呈现 0 笔；未卖完持仓按已记账权益展示，不虚构平仓。费用已含在权益里，逐笔费用仅为展示，不重复扣减。
- 错误契约：坏/缺规则快照 409 `TRAIN_RULES_UNREADABLE`；`legacy-raw-unverified` 409 `LEGACY_RAW_ACCOUNTING_UNVERIFIED`（成绩未经验证，不提供成绩单；不否定合法新 raw）；结算权益缺失 409 `HISTORY_EQUITY_UNAVAILABLE`；均无写入/回填。
- 画线：无行=未保存（空数组）；行 JSON 不可读 → `drawingsStatus=unavailable`＋中文原因，绝不伪装成空成功，其余账户事实照常呈现。画线以只读标注清单显示类型、窗格、锚点时间/数值，保留原始价格基准；不把价格点画到权益坐标、不提供行情 K 线或编辑器。完整 K 线复盘另依赖数据保护范围（DATA-03/04），本页不冒称已具备。

## 防未来守卫

- 存在任何 running 训练时，历史列表与成绩单（含直接 ID 访问）先返回 409 `HISTORY_ACTIVE_TRAINING`，零历史内容；UI 说明"结束当前训练后可查看历史"，可经侧栏返回当前训练。守卫检查与查询在服务端同一同步调用内完成。
- 无 running 后，接口只查持久数据；TDX 离线状态下历史与成绩单照常可用。

## 明确不做

排行（`GET /api/rankings` 保持 404）、最大回撤、胜率、盈亏比、沪深300超额/基准接入、训练时钟、成交理由、条件单；历史列表不重建/清空既有表，不改变账户算法、录像 schema 与结算/放弃语义。

回归与证据：[M4-HISTORY-01 验证记录](../../verification/2026-09/M4-HISTORY-01/server-red-green.md)、[Journey 记录](../../verification/2026-09/M4-HISTORY-01/journey-red-green.md)。
