# M7-01 随机训练模式·服务端核心 — API 契约与实施计划（design.md）

> 阶段①②③交付物。行为 oracle：用户 2026-10-06 原话（三维度随机＋训练中隐藏随机部分信息）＋架构师 M7-01 派发简报的 provisional 设计决策（proposed_default 清单随收尾报告转呈用户确认）。
> 本文档即 API 契约的一部分：请求/响应/错误码/隐藏字段语义一经实现即由矩阵 `random-training-mode.yaml` 与测试锁定。

## 一、现状结论（阶段① 读码摘要）

- 训练生命周期入口全部在 `server/src/api.ts`：`POST /api/trainings`（tier / range+previewId 两分支）、`GET /api/trainings/active`、`GET /api/trainings/:id(/bars|/orders|/drawings|/recording-context|...)`、`next/trade/settle/abandon/retrain`。
- 引擎 `server/src/train/engine.ts`：`toMeta` 已有 legacy blind 遮蔽（`blind=1 && running` → code/name/currentDate/currentOpen/currentClose 置 null）——V1 页面不启用盲测；随机模式**不复用、不改动**该语义，另建隐藏层。
- 数据读取经 DATA-04 统一入口 `MarketDataReader`（`server/src/data/reader.ts`）：`readCatalog()` 提供每股 `bars`（记录数）与 `lastDate`；`readBars(market, code, {from,to})` 提供区间日线。测试可用真实 TDX 夹具目录（temp root + .day 文件）驱动。
- 运行中会话的既有防泄漏面：`/api/kline/:code` 409、`/api/trainings/history|:id/report|equity-comparison` 与 `/api/rankings` 经 `assertNoActiveTraining` 409——随机模式的"运行中不返回"约束在这些端点已天然成立。
- 录像上下文 `GET /api/trainings/:id/recording-context` 返回 `start_date/current_date/positionEvents[].date`（真实日期）——属随机时间模式的泄漏出口，必须纳入隐藏层。
- 画线 `drawings` 以 `points[].timestamp`（epoch ms）锚定——隐藏时间模式下需请求侧反向去偏移、响应侧正向偏移，保证落库恒为真实空间。
- 迁移惯例：`db.ts` `addColumnIfMissing` 只增列；`commitTrainingCreation` 是旧 tier 与 RANGE 共用的提交边界（BEGIN IMMEDIATE＋单活动训练复查）；`retrainTraining` 按行复制冻结参数。

## 二、API 契约

### 2.1 新端点：`POST /api/trainings/random`

请求体（字段与 `POST /api/trainings` 同名者语义一致）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `dimension` | `'random_stock' \| 'random_time' \| 'random_both'` | 必填，否则 400 |
| `start_date` / `end_date` | `YYYY-MM-DD` | `random_stock` 必填（用户选定时间段；`start_date ≤ end_date`）；其余维度出现即 400 |
| `code` | string（`parseTdxSymbol` 兼容） | `random_time` 必填；`random_stock`/`random_both` 出现即 400（与随机选股矛盾） |
| `window_bars` | 正安全整数 | 仅 `random_time`/`random_both` 接受，缺省 250；`random_stock` 出现即 400 |
| `initial_cash` / `adjust_mode` / `clock_mode` / `orders_enabled` | — | 与经典创建同语义（缺省走持久默认/`close_only`/false） |

响应 `201 { training: TrainingMeta }`。随机训练行 `tier='RANGE'` 哨兵＋`range_version=1`＋`range_mode='random'`（`normalizeRangeRequest` 不接受客户端 `mode:'random'`，该值只能由服务端写入）；`range.requestedStart/requestedEnd/startDate/endDate/barCount/notes` 如实记录真实窗口（**运行中经隐藏层变换后下发**）。`blind` 不接受（随机行恒 0）。`tier`/`range`/`previewId` 出现即 400。

`TrainingMeta` 新增可选字段（仅随机训练）：

```jsonc
"random": { "dimension": "…", "hideStock": bool, "hideTime": bool }  // dimension 不敏感（用户自己选的），运行中随隐藏层注入
```

错误码：

| 场景 | 状态码 | code |
|---|---|---|
| `dimension` 缺失/非法；`window_bars` 非正整数；日期非法或 `start>end`；矛盾字段组合 | 400 | 无（中文 message，沿经典创建风格） |
| `random_time` 的 code 不在目录 | 400 | 无（`代码 X 不在 A 股目录中`，用户自供 code 不属泄漏） |
| 已有进行中的训练 | 409 | 无（`commitTrainingCreation` 既有分支） |
| `random_time`：该股在指标预热约束下无可行窗口起点 | 422 | `RANDOM_WINDOW_NOT_FIT` |
| `random_stock`/`random_both`：随机股票池为空 | 422 | `RANDOM_STOCK_UNIVERSE_EMPTY` |
| 无数据目录 | 503 | 沿 `marketReader` 既有映射 |

### 2.2 随机选取规则（RNG 可注入）

- `rng: () => number`（默认 `Math.random`）为创建入参（HTTP 不暴露；测试直调函数注入种子序列）。所有随机决定只经 `rng`，目录序确定 ⇒ 同种子同结果。
- **random_stock 池**：目录全部 A 股（含 ST/北交所，proposed_default），逐股满足（目录 `lastDate ≥ end_date` 预筛后读区间日线核验）：
  1. `date ≤ start_date` 的日线根数 ≥ `MA_WARMUP_BARS + 1`（201：窗首前留足 200 根预热＋窗首本身）；起始 bar＝`≤ start_date` 的最后一根（沿经典对齐口径）；
  2. 窗口 `(起始bar, end_date]` 内至少还有 1 根日线（保证可推进至少一次）；
  3. `lastDate ≥ end_date`（数据覆盖到窗末，训练不会卡在等待数据）。
- **random_time 起点**：对该股 ≤ cutoff（`shanghaiCompleteDataDate`，与范围预览同口径）的日线序列（根数 N），可行起点 `i ∈ [MA_WARMUP_BARS, N − window_bars]`；窗＝`bars[i .. i+window_bars−1]`（恰 `window_bars` 根）；可行起点数为 0 → 422 `RANDOM_WINDOW_NOT_FIT`。
- **random_both**：先按目录 `bars ≥ window_bars + MA_WARMUP_BARS` 预筛成池，拒绝采样（`rng` 取索引→读日线核验可行，不可行剔除再取；池尽 → 422 `RANDOM_STOCK_UNIVERSE_EMPTY`），再按 random_time 规则选起点。
- **偏移常量**：隐藏时间的会话在创建时生成 `offsetDays`（非零，`1 ≤ |offsetDays| ≤ 3650`，符号与幅度均出自 `rng`），存 `trainings.random_time_offset_days`，全程不变。

### 2.3 隐藏语义（运行中，API 级真隐藏）

适用条件：该训练 `status='running'` 且 `random_mode` 非空。覆盖端点＝该会话一切出口：`GET /api/trainings/active`、`GET /api/trainings/:id`、`GET /api/trainings/:id/bars`、`POST :id/next|trade|settle|abandon|retrain`、`GET/POST :id/orders(/:orderId/cancel)`、`GET/PUT :id/drawings`、`GET/PUT :id/trades/:seq/note`（无敏感字段，同层处理）、`GET :id/recording-context`、`POST /api/trainings/random` 创建响应（模块内直接产出遮蔽数据）。

- **隐藏股票**（`random_stock`/`random_both`）：`training.code`、`training.name` 置 null；`training.market` 保留（非名称/代码；proposed_default，M7-02 可再收紧）。深度遍历后响应不得含股票名称或代码子串（测试 deep-walk 断言）。
- **隐藏时间**（`random_time`/`random_both`）：响应内全部市场日期经 `+offsetDays` 常量平移——
  - 字符串值恰为 `YYYY-MM-DD` → 平移为 `YYYY-MM-DD`（间距与缺口结构逐日保留）；
  - 字符串值恰为 `YYYY-MM`（月 K 键）→ 按该月首日平移后取月；
  - 长字符串（错误消息、range notes）内出现的 `YYYY-MM-DD` 子串（后随 `T` 的 ISO 时间戳除外）同映射平移；
  - `createdAt`/`expiresAt`/`rulesCapturedAt` 等挂钟 ISO 时间戳**不平移**（非市场日期，保持真实）；
  - `drawings[].points[].timestamp`（epoch ms）出口 `+offsetDays×86400000`；
  - 请求侧反向：`GET :id/bars?before=<shifted>` 在查询前去偏移；`PUT :id/drawings` 的 `points[].timestamp` 去偏移后落库（库内恒真实空间，GET/PUT 对称）。
- **注入**：被遮蔽的 TrainingMeta 附 `random: {dimension, hideStock, hideTime}`，前端（M7-02）据此渲染隐藏态。
- **威胁模型外**：拿到偏移后序列与全市场真实日历做缺口指纹暴力比对反推真实区间，不在本威胁模型（文档注明）。
- **录像（REC）**：M7-01 不改 REC 链路；REC 载荷（浏览器侧捕获，本就只见遮蔽后 UI）不做二次脱敏/还原，回放属事后（proposed_default，报告转呈）。

### 2.4 揭晓（settlement 及一切结束态）

`settle`/`abandon`（含 advance 自然到期）后 `status != running` → 隐藏层对该会话全部端点停用：结算载荷本身、`GET :id`、bars、orders、drawings、recording-context 即刻返回真实 code/name/日期；`/api/trainings/history`、`:id/report`、`equity-comparison`、`/api/rankings` 本就 409 于运行中，结束后天然返回真实信息。`retrain` 复制 `random_mode` 与同一 `random_time_offset_days`（重练再次进入隐藏态）。

### 2.5 经典模式零影响

- 既有 tier / range 创建、查询、推进、结算的请求与响应结构不变；`toMeta`、撮合、T+1、条件单、防未来、规则快照语义零改动。
- 实现层面：engine.ts 仅做加法——`TrainingRow` 补两列、`commitTrainingCreation`/`retrainTraining` INSERT 补两列；隐藏与随机逻辑全部在新模块 `server/src/train/random-mode.ts`；api.ts 只挂新路由与两个钩子（preHandler 请求侧去偏移、onSend 响应侧遮蔽），钩子对非随机会话零改动直通。
- 回归证据：存量测试全绿（`npm test` 全量）。

### 2.6 数据库迁移（只增列）

```
trainings.random_mode TEXT              -- NULL=经典；'random_stock'|'random_time'|'random_both'
trainings.random_time_offset_days INTEGER -- NULL=不隐藏时间；非零常量
```

沿 `addColumnIfMissing` 兼容路径，不重建表、不清理旧行（旧行 NULL=经典）。

## 三、实施计划（阶段③：文件清单＋验证命令）

| # | 文件 | 改动形态 | 验证命令 | 完成判据 |
|---|---|---|---|---|
| 1 | `server/src/train/random-mode.ts`（新） | 契约 2.1–2.4 全部纯服务端逻辑：类型、日期平移纯函数、池/起点选取、`createRandomTraining`、会话上下文、深度遮蔽/去偏移、Fastify 挂接函数 | `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` | 新测试 RED→GREEN |
| 2 | `server/src/db.ts` | 2×`addColumnIfMissing` | 同上（迁移用例内建） | 旧库列缺省 NULL |
| 3 | `server/src/train/engine.ts` | `TrainingRow`＋`TrainingCreationRow.random`＋两条 INSERT＋retrain 复制两列（纯加法） | `npm test -- server/test/train-engine.test.ts server/test/train-range-preview.test.ts` | 存量全绿 |
| 4 | `server/src/api.ts` | 挂 `POST /api/trainings/random`＋preHandler/onSend 钩子（调用 random-mode 导出函数） | 同 #1 | 新测试 GREEN |
| 5 | `server/test/random-training-mode.test.ts`（新） | TDX 夹具（≥3 股、≥460 根者）＋全矩阵行测试 | 同 #1 | 逐行 RED 亲见→GREEN |
| 6 | 矩阵 skill 侧＋镜像（阶段②已建） | planned→covered 升级 | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix <skill>/matrix/random-training-mode.yaml --strict --include-untracked` | RED=0，任务行闭合 |

顺序：矩阵（已先建）→ 测试文件（RED）→ db.ts → engine.ts → random-mode.ts → api.ts（GREEN）→ REFACTOR → 门禁四件套（check-binding --strict / 定向 / `npm test` 全量 / `npm run build`）→ 变异抽检 2 行（HIDE-STOCK-NO-LEAK、HIDE-TIME-OFFSET）→ 收尾。

已知成本（登记不顺手修）：`random_stock`/`random_both` 池核验需逐股读日线文件（目录 `lastDate` 预筛后），创建为一次性用户动作，成本可接受；如需优化（文件尺寸推根数）另立任务。
