# 公式校验/求值 agent 接口（本地只读）

> 2026-11-24：M9 候选移至 `task/M9-ACCEPT-HOLD` 待人工验收；本文涉及公式的能力是候选范围。撤出与恢复见 [M9-DEFER-01](../work-items/tasks/M9-DEFER-01.md)。

> 适用：M9-04A 服务端契约（M9-04D 文档化）；供 DeepSeek/codex 等本机工具在生成通达信公式后校验与试算。
> **只读边界**：这些接口不写训练、成交、画线、录像、账户，也不下单；公式库 CRUD 只改公式库本身。
> 服务只监听本机回环地址（Host/Origin 校验见 server README「本机 HTTP 边界」），不是远程 API。

启动：正常启动训练器（默认 `http://127.0.0.1:8787`；端口被占用时启动器会回退，`GET /api/health` 的 `launcher.port` 可确认）。CI/隔离环境请用实际端口或 `--base`。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/formulas | 公式库列表（含 builtin/futureFunctions/enabled） |
| POST | /api/formulas/validate | 只校验源码：parse ＋ 未来函数静态标记，不执行、不写库 |
| POST | /api/formulas/evaluate | 只读求值：训练上下文（trainingId）或 TDX 日线（code）二选一 |

### POST /api/formulas/validate

请求：`{"source":"MA5:MA(CLOSE,5);"}`（string，非空，≤20000 字符）

- 成功：`200 {"ok":true,"futureFunctions":["BACKSET"],"warnings":["..."]}`
- 语法/词法错误：`200 {"ok":false,"error":{"kind":"lexer|parser","message":"语法错误（第 1 行第 12 列）：…","line":1,"column":12},"warnings":[]}`
- 空源码/请求形状错误/超长：`400 {"error":"..."}`

### POST /api/formulas/evaluate

请求字段（至少一组数据来源）：

| 字段 | 需求 | 说明 |
|---|---|---|
| source | source/formulaId 二选一 | 直接给源码（≤20000 字符） |
| formulaId | 同上 | 用公式库中已保存公式的 id |
| trainingId | trainingId/code 二选一 | 训练上下文：按推进日截断→复权→聚合（`trainingBars` 唯一链路） |
| code | 同上 | 独立证券：读 TDX 日线最近 N 根，**不复权**（dataSource.note 显式声明） |
| timeframe | 可选，默认 1D | 1D/1W/1M；独立证券仅 1D（非 1D 返回 400） |
| limit / bars | 可选，默认 500，范围 10~2000 | 返回最近 N 根；训练上下文受既有 840 可见+250 暖机上限约束，超额时 warnings 说明 |

响应成功：

```json
{
  "ok": true,
  "outputs": [{ "name": "MA5", "style": {}, "data": [null, null, 12.3, 12.5] }],
  "bars": [{ "date": "2026-01-05", "timestamp": 1767571200000 }],
  "futureFunctions": [],
  "warnings": [],
  "dataSource": { "kind": "training|tdx", "note": "训练上下文：已按推进日截断→复权→聚合（trainingBars 唯一链路）" }
}
```

- 运行期错误：`200 {"ok":false,"error":{"kind":"runtime","message":"运行错误：…"},"warnings":[],"dataSource":{...}}`
- 业务错误：`400/404/422/503` + `{"error":"中文人话"}`
- 输出线与 bars 等长；NaN/Infinity → null。

### 随机训练遮蔽（M7-01）

运行中的随机训练（random_time/random_stock）仍可求值，但：

- random_time：响应中的日期字符串与 bars.timestamp 按会话偏移遮蔽；
- random_stock：不注入 StockContext（NAMELIKE/CODELIKE/HYBLOCK 等返回人话「缺少上下文」错误）；
- 响应 warnings 追加「随机训练会话：返回值已按 M7-01 规则遮蔽日期/代码/名称信息」；
- 已结束（settled）随机训练按揭晓态正常返回。

## CLI：scripts/formula-agent.mjs

```bash
node scripts/formula-agent.mjs list [--base URL]
node scripts/formula-agent.mjs validate --source "MA5:MA(CLOSE,5);" [--base URL]
node scripts/formula-agent.mjs evaluate --source "..." --code 600519 --limit 120 [--base URL]
node scripts/formula-agent.mjs evaluate --formula-id 12 --training-id 3 --base http://127.0.0.1:8787
```

- 默认 base=`http://127.0.0.1:8787`，可用 `--base` 或 `TRAINER_BASE_URL` 覆盖；只读（无写接口）。
- stdout 为 JSON；`ok:false` 或请求失败时退出码非 0，stderr 打一行人话（如「公式校验失败：语法错误（第 1 行第 12 列）：…」）。
- `--timeframe 1D|1W|1M`、`--limit 10..2000`；`--source` 与 `--formula-id`、`--code` 与 `--training-id` 分别互斥。

## curl 示例

```bash
curl -s http://127.0.0.1:8787/api/formulas
curl -s -X POST http://127.0.0.1:8787/api/formulas/validate \
  -H "Content-Type: application/json" -d '{"source":"MA5:MA(CLOSE,5);"}'
curl -s -X POST http://127.0.0.1:8787/api/formulas/evaluate \
  -H "Content-Type: application/json" -d '{"source":"MA5:MA(CLOSE,5);","code":"600519","limit":120}'
```

## 内置示例

启动时幂等写入 3 个内置示例（builtin=1，UI 显示「内置」徽标，禁止改名/改源码/删除）：`WEEK_MACD_SUB`（周线 MACD 跨周期）、`MA_BULL_MAIN`（MA5/10/20/60 主图）、`QINIU_B1_SUB`（DIF/DEA 金叉 B1）。默认 `enabled=false`，避免开箱改变既有图表布局；可在设置中查看/预览，启用通过 `PUT /api/formulas/:id {"enabled":true}`（设置开关留待后续卡）。
