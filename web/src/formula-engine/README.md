# formula-engine（通达信公式引擎 · vendor 冻结基线）

## 来源与许可

- 上游：[DTrader-store/formula-ts](https://github.com/DTrader-store/formula-ts) `@dtrader/formula-ts` **v1.0.0**（MIT，见本目录 [LICENSE](./LICENSE)）。
- 入仓依据：TECH-FORMULA-RECON 侦察（`ai-harness-lab/formula-recon/REPORT.md`，2026-10-26）——717/717 自测绿、`tsc` 构建绿、内核可用；用户 2026-10-26 拍板「在已有开源基础上二次开发补足」。
- 拷贝范围：上游 `src/` 全量 → 本目录（`src/index.ts` 对应本目录 `index.ts`），入仓时与上游字节一致（diff 验证）。

## 冻结基线（同步策略）

**冻结 v1.0.0，不跟进上游**；缺口以本仓库自有补丁层维护，补丁逐条列在下方。上游若发布新版本，不自动合并；若未来需要吸收上游修复，按「补丁清单为 diff 基准的显式合并」流程单独立卡。
（该同步策略为 root proposed_default，待用户追认。）

## 补丁层清单（M9-01，均在本目录内以最小改动实现）

| # | 缺口 | 侦察实证 | 改动位置 |
|---|---|---|---|
| 1 | `!=` 不等运算符（骑牛买3 严格版在用） | lexer 在 `!` 处报 Unexpected character | `lexer/Lexer.ts`（`!` + `=` → NEQ，与既有 `<>` 同 token） |
| 2 | 语句级颜色/线型修饰：`X:=expr,COLORRED;`、`表达式,COLORRED;`、`STICKLINE(...),COLORxxx;` | 输出行 `A:MA(...),COLORRED` 已支持，其余语句形态 parse fail | `parser/Parser.ts`＋`parser/ast/nodes.ts`（VariableDeclaration/ExpressionStatement 增可选 style）＋`interpreter/Interpreter.ts`（画线事件挂样式元数据，数值语义不变） |
| 3 | `DRAWNUMBER(cond,price,number,小数位)` 四参（三参兼容） | 上游仅三参 | `interpreter/Interpreter.ts` |
| 4 | `BACKSET(X,N)`（条件成立周期起向前 N 周期置 1；未来函数族） | Unknown function | `interpreter/functions/reference.ts`＋注册（interpreter switch / registry / 函数清单） |
| 5 | `VARCAT(A,B)` 字符串拼接（DRAWTEXT 文本参数可用拼接）；`STRCAT` 同语义别名 | Unknown function | `interpreter/Interpreter.ts` |
| 6 | 未来函数静态标记 API：`scanFutureFunctions(formula): string[]` ＋ `FUTURE_FUNCTIONS` 常量（支持＋显式标记，不禁止；标记不改变执行结果） | 上游零相关机制 | 新增 `futureFunctions.ts`，自 `index.ts` 导出 |

不在本层（另立卡）：跨周期/跨公式引用 `#WEEK/#MONTH`（M9-02）、板块/市场上下文函数族 FINANCE/HYBLOCK 等（M9-03）、产品 UI（M9-04）。

## 补丁层清单（M9-02：跨周期/跨公式引用，任务卡 M9-02 语义冻结）

新增 `crossPeriod.ts`（纯函数层：重采样/广播/内置指标表/注册表类型，零引擎反向依赖），并最小改动 lexer/parser/Interpreter/FormulaEngine：

| # | 能力 | 语义（冻结） | 改动位置 |
|---|---|---|---|
| 7 | 跨周期引用 `"MACD.DEA#WEEK"`（带引号）与 `MACD.DIF#MONTH`（裸写） | 两种形态都解析为 `PeriodReference` 节点并参与数值比较；字符串仅当严格匹配 `名.线#周期` 模式才升级（DRAWTEXT 文本等正当字符串用途零回归）；未知周期后缀（如 `#MIN60`）＝人话 ParserError | `lexer/TokenType.ts`＋`lexer/Lexer.ts`（`.`/`#` 两个 token）＋`parser/ast/nodes.ts`（PeriodReference）＋`parser/Parser.ts` |
| 8 | 周线/月线重采样与广播 | 自然周（周一始，节假日周＝实际交易日聚合）/自然月；每完整周单值广播到该周全部日 bar；**当周（数据末组）未走完按截至当日的部分周聚合、组内随日线推进**（周内重绘属设计内语义；证据＝骑牛买1 注释「WEEKDAY…确保取的是上周五数据」）；`#DAY` 恒等 | `crossPeriod.ts`（`resampleBars`/`broadcastReferenceLine`/`aggregateBars`）＋`interpreter/Interpreter.ts` |
| 9 | 内置指标引用＝通达信口径 | `MACD.DIF/DEA/MACD`：DIF=EMA(C,12)−EMA(C,26)、DEA=EMA(DIF,9)、柱=2×(DIF−DEA)（复用 vendored `functions/indicators.ts`，其柱体本就 ×2）；裸 `MACD`/`DIF`/`DEA` 标识符＝当前周期内置线（分金定穴形态），**公式局部 `MACD:=` 定义优先**；可经 `options.builtinIndicators` 注入替换 | `crossPeriod.ts`（默认 provider）＋`interpreter/Interpreter.ts`（visitIdentifier 兜底） |
| 10 | 跨公式引用 `"W144UP.UP#WEEK"` | 注入式注册表：`evaluate(formula, bars, { auxiliaryFormulas: { 名: 源码 } })`；被引公式先在**重采样后的高周期 bar 序列**上求值、取其输出线再广播；递归依赖共享同一引用栈（环＝人话报错、深度上限 8）；未注册/无输出线＝人话错误；缺省 options 时内置指标仍可用系统定义、辅助公式引用报人话错 | `FormulaEngine.ts`（evaluate 第三可选参数＋引用栈递归）＋`interpreter/Context.ts`（resolver 注入与 `getMarketData()`） |

边界与披露（M9-02 实现口径）：
- 复权属数据层职责，引擎收到的行情序列原样参与重采样（root 预判定）。
- 数据末组恒按「当周未走完」处理（即便末日恰为周五——无法从数据本身判定周已走完，as-of 语义）。
- 跨周期引用在 `evaluateIncremental` 路径未注入注册表：内置指标引用可用，辅助公式引用报人话错误。
- 带引号字符串若恰为 `A.B#C` 形状（ASCII 标识符）即视为引用（通达信同款语义）；DRAWTEXT 想显示这类文本属病用例，不保证。
- 引用求值为无前视（no-lookahead）口径：完整周的值只依赖其前序周；这也使 EMA 族指标在历史周上稳定不重绘，重绘只发生在当周。

## 补丁层清单（M9-03：市场上下文函数族，任务卡 M9-03 语义冻结）

新增 `marketContext.ts`（纯函数层：StockContext 类型＋前缀/品种/日期对齐纯函数，零引擎反向依赖），并最小改动 Interpreter/Context/FormulaEngine/crossPeriod：

| # | 能力 | 语义（冻结） | 改动位置 |
|---|---|---|---|
| 11 | StockContext 注入 | `evaluate(formula, bars, { stockContext })` 注入被评估证券上下文（code/name/industry/industryIndexBars/regionName/conceptName/styleName）；未注入而调上下文函数＝人话运行时错误（引擎独立使用可测） | `crossPeriod.ts`（options 增字段）＋`FormulaEngine.ts`（接线）＋`interpreter/Context.ts`（注入） |
| 12 | `FINANCE(3)` 品种类型 | 按代码前缀派生常数序列：60/00→1 沪深主板（工作区既有口径）；688/689→3 科创板、300/301→2 创业板、4/8/92 前缀→4 北交所（非主板值＝proposed_default，速查表无记载，可经 `<>1` 剔除）；**其余 FINANCE 编号＝显式未实现人话错误，不返回假值**；无法识别前缀同样报错 | `marketContext.ts`（`boardTypeOfCode`）＋`interpreter/Interpreter.ts` |
| 13 | `NAMELIKE(s)`/`CODELIKE(s)` | 名称/代码**前缀**匹配布尔常数序列（通达信口径）；参数须字符串字面量；`NOT(NAMELIKE('ST'))` 组合可用（放量解放公式口径） | `marketContext.ts`（`prefixMatchSeries`）＋`interpreter/Interpreter.ts` |
| 14 | `HYBLOCK` 行业名 | 返回所属行业名字符串常数（`industry.name`）；无行业数据＝人话错误。同族 `DYBLOCK`/`GNBLOCK`/`FGBLOCK`（地域/概念/风格，取上下文可选字段，缺失＝人话错误）——六龙连山-3 语料依赖 | `marketContext.ts`（`marketBlockName`）＋`interpreter/Interpreter.ts` |
| 15 | `HY_INDEXC/O/H/L/V/A` | 行业指数收/开/高/低/量/额序列，**按股票日线日历日对齐**（本地日历日键，与跨周期周/月分组同约定）：指数缺该日→NaN（比较为假不崩溃，与 warmup NaN 同语义）；股票轴外的指数日被忽略；**对齐错位＝缺陷**（变异必杀）；未注入 industryIndexBars＝人话错误 | `marketContext.ts`（`alignIndexField`/`localDateKey`）＋`interpreter/Interpreter.ts` |
| 16 | 裸标识符形态 | `CCC:=HY_INDEXC;`、`STRCAT('行业',HYBLOCK)` 等无括号用法＝Identifier 兜底解析（用户变量优先，规则同 M9-02 裸 MACD 线） | `interpreter/Interpreter.ts`（visitIdentifier） |
| 17 | 字符串变量中间态 | `Z10:=STRCAT(' 行业： ',HYBLOCK);` 允许字符串存入变量并在后续 STRCAT/DRAWTEXT 消费（六龙连山-3 形态）；`FormulaResult.variables` 保持纯数值形状（字符串中间态不出现在结果里） | `interpreter/Context.ts`（变量类型放宽）＋`FormulaEngine.ts`（结果收集过滤） |

边界与披露（M9-03 实现口径）：
- 上下文函数在 `evaluateIncremental` 路径未注入 StockContext：调用＝人话错误（与 M9-02 注册表同边界）。
- `HY_INDEX` 对齐约定：bars 时间戳的**本地日历日**须等于交易日（服务端 `/api/formulas/context` 产出本地午夜毫秒时间戳，与此约定配套）。
- `HYBLOCK` 返回字符串（非数值序列）：输出行 `X:HYBLOCK;`（数值输出位）会报 must be numeric——字符串仅作为 STRCAT/DRAWTEXT 文本路径的中间态，通达信同款用法。
- 上下文函数未注册进 FunctionRegistry（其 execute 签名无法承载字符串/上下文），分发在 Interpreter switch＋Identifier 兜底，与 marketData 函数族（OPEN/CLOSE…）同模式。

## 导出面

沿用上游 `index.ts` 结构（FormulaEngine、错误类、AST、核心组件、内置函数全量导出），另导出补丁层 `scanFutureFunctions` / `FUTURE_FUNCTIONS`（M9-01）、`crossPeriod.ts` 全部类型与纯函数（`resampleBars`/`broadcastReferenceLine`/`aggregateBars`/`FormulaEvaluationOptions` 等，M9-02）与 `marketContext.ts` 全部类型与纯函数（`StockContext`/`boardTypeOfCode`/`alignIndexField`/`prefixMatchSeries` 等，M9-03）。

## 测试

- 上游 22 套件（jest，717 用例）移植为 vitest：`server/test/formula-engine/`（import 改指本目录；jest 特有 API 替换为 vitest 等价物）。
- 补丁用例与语料回放（corpus smoke）同目录；语料只读引用 `ai-harness-lab/formula-recon/corpus-*.txt`。
