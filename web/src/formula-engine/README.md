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

## 导出面

沿用上游 `index.ts` 结构（FormulaEngine、错误类、AST、核心组件、内置函数全量导出），另导出补丁层 `scanFutureFunctions` / `FUTURE_FUNCTIONS`。

## 测试

- 上游 22 套件（jest，717 用例）移植为 vitest：`server/test/formula-engine/`（import 改指本目录；jest 特有 API 替换为 vitest 等价物）。
- 补丁用例与语料回放（corpus smoke）同目录；语料只读引用 `ai-harness-lab/formula-recon/corpus-*.txt`。
