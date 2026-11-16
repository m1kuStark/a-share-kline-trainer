# M9-04 公式系统产品化（提案与冻结口径）

> 状态：已实施中（2026-11-16 用户拍板默认方案）；本文件冻结口径与拆卡，不代表已交付或用户验收。阶段见 [M9 里程碑](../work-items/milestones/M9.md)。

## 一、用户拍板（2026-11-16 默认方案）

1. **存储**：本机 SQLite（trainer 数据库内 `formulas` 表，随数据目录备份/迁移；不在本批做文件目录编辑形态）。
2. **Agent 接口**：提供**本地只读** HTTP 接口 `POST /api/formulas/validate` 与 `POST /api/formulas/evaluate`，供 DeepSeek/codex 等工具生成公式后校验/试算；**不提供**写训练、下单、改账户等接口。公式的增删改只读改公式库本身。
3. **首批范围**：只做**图表显示**（主图叠加线 + 副图指标窗格）；**不做**全市场选股扫描、条件单/策略联动。
4. **示例**：内置 3 个通达信示例公式（周线 MACD 副图、均线多头排列主图、骑牛 B1 条件类标记），开箱可用于自检。
5. **未来函数**：允许使用，显式标记提示（复用 M9-01 `scanFutureFunctions`），不禁止。
6. **引擎**：复用 `web/src/formula-engine`（M9-01/02/03 已交付能力），本批不改引擎语义；服务端通过构建期 esbuild bundle 加载同一来源，浏览器直接 import。

## 二、拆卡

| 卡 | 内容 | 状态 |
|---|---|---|
| M9-04A | 公式库与校验/只读求值服务（SQLite 迁移、CRUD、validate、evaluate、通达信文本导入、未来函数标记） | 开发中 |
| M9-04B | 公式管理 UI（列表/编辑/校验提示/导入粘贴/预览） | planned |
| M9-04C | 图表挂载（主图叠加+副图窗格；周期/推进/刷新/录像回放；与 VOL/MACD/KDJ 同机制） | planned |
| M9-04D | 内置示例与 agent 接口文档/CLI | planned |

## 三、契约草案（M9-04A 实现基线）

- `GET /api/formulas` → `{ formulas: FormulaView[] }`；`POST/PUT/DELETE` 对应写公式库（不做训练写入）。
- `FormulaView = { id, name, description, placement: 'main'|'sub', source, enabled, builtin, futureFunctions: string[], createdAt, updatedAt }`。
- `POST /api/formulas/validate { source }` → `200 { ok:true, futureFunctions: string[], warnings: string[] }` 或 `200 { ok:false, error:{ kind:'lexer'|'parser'|'runtime', message, line?, column? } }`；请求形状错误 `400`。
- `POST /api/formulas/evaluate { source? | formulaId?, trainingId?, timeframe?: '1D'|'1W'|'1M', code?, bars?: number }` → `200 { ok:true, outputs:[{name, style?, data:(number|null)[]}], bars:[{date,timestamp}], futureFunctions, warnings }`；训练上下文（trainingId）走 `trainingBars` 既有截断→复权→聚合链；无训练时按 `code` 读 TDX 日线最近 N 根（不复权，响应显式声明）。运行期错误 `200 ok:false`（与 validate 同形）。
- 只读性：validate/evaluate 不写训练/画线/录像/账户；评估错误不得 500 掩盖业务语义。

## 四、边界与后续

- 不做：选股扫描、条件单联动、公式云同步、任意脚本执行（只执行公式 DSL）。
- 公式来源可信度：公式为用户本机文本；引擎执行按既有沙箱（无 IO/网络能力）。
- 内置示例随 M9-04D 入库；本批 A 卡不 seed。

## 五、评审修订（2026-11-17，实施后冻结调整）

- 求值请求字段：`limit`（10~2000）与 `bars` 互为别名；训练上下文返回根数受既有 840 可见+250 暖机上限约束，超出时响应 `warnings` 明示。
- 公式名：1~64 字符，允许中文/字母/数字/下划线/短横线，禁止空白/控制字符；**跨公式引用要求纯英文名**（引擎标识符限制），UI 需提示。
- 随机训练（M7-01）：运行中的 `random_time` 由 `transformRandomPayload` 偏移日期/时间戳；`random_stock` 不注入 StockContext（NAMELIKE/CODELIKE/HYBLOCK 报人话错误）；响应附遮蔽告警。已结束（settled）随机训练按揭晓态正常返回。
- 引擎加载：生产加载构建期 bundle；dev/测试回退 `FormulaEngine.ts`＋`futureFunctions.ts` 纯值入口（不能加载 index.ts，其把纯类型按值导出）。
- 错误消息：统一中文前缀＋行/列；常见引擎消息映射中文，未知细节保留原文便于排查。
- 发布打包：ZIP/桌面包的 server/dist 必须包含 `formulas/engine-bundle/index.mjs`（`scripts/release/build.mjs` 已纳入 `.mjs`）。
