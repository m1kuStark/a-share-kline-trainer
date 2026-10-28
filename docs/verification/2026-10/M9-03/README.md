# M9-03 验证记录（公式引擎市场上下文函数族）

- 日期：2026-10-28 ｜ 执行：M9-03 worker（AI Native Harness 纪律下 TDD）
- 候选：HEAD=fc1306b（立卡）＋本轮工作树改动（commit 见任务卡「本轮交付」）
- 环境声明：e2e/journey 不适用（root 预声明纪律适配——纯引擎＋数据接口）；替代收据＝全量 server 回归＋typecheck:web＋build:server＋服务端接口测试（含真机数据轨）。
- TDX_ROOT 真实数据：`D:\MySoftWares\TDX`（服务端接口真机轨默认路径，env `TRAINER_TDX_ROOT_TEST` 可覆盖，缺失时普通 it＋内联 return 跳过并醒目告警）。

## 一、RED（先于产品码，正确原因失败）

| 命令 | 退出码 | 失败形态（正确原因＝缺功能） |
|---|---|---|
| `npx vitest run --config server/vitest.config.ts server/test/formula-engine/marketContext.test.ts server/test/formula-engine/corpus-smoke.test.ts server/test/formula-context-api.test.ts`（实现前） | 1（21 failed / 7 passed） | `Unknown function: FINANCE`、`Undefined identifier: HY_INDEXA/HYBLOCK`（裸标识符形态）；corpus M9-03 提升 14<16；API 全部 404（路由不存在）；M9-02 lift ≥13 用例保持绿（零回归） |

RED 阶段同时钉死一个实现需求：`IC:HY_INDEXC;`（无括号）解析为 Identifier 而非 FunctionCall——上下文函数族必须同时覆盖 visitFunctionCall（带参形态）与 visitIdentifier 兜底（裸形态）。

## 二、GREEN（定向）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx vitest run --config server/vitest.config.ts server/test/formula-engine/ server/test/formula-context-api.test.ts` | 0 | 27 文件 791/791 全绿（含 vendored 上游 717 全量移植＋M9-01/02 补丁用例零回归） |

测试夹具层修正两处（非断言放宽）：①fixture 断言 amount 期望值改按 float32 换算（.day 记录 float32 存储，dayfile.ts `getFloat32` 口径——oracle 独立按同精度换算）；②真机全目录扫描（5566+ 只 stat＋tnf 解析）超 vitest 默认 5s，按 api.test.ts 既有先例显式 30s 等待预算（断言语义不变）。

## 三、变异验证（executed，还原禁 git checkout -- 整文件，逐行编辑还原）

| 变异 | 注入点 | 杀手（用例全文） | 结果 |
|---|---|---|---|
| MUT1 FINANCE 前缀表反转（60↔688：688/689→1、60/00→3） | `marketContext.ts boardTypeOfCode` | `marketContext.test.ts::derives FINANCE 3 board type by code prefix truth table`＋`marketContext.test.ts::replays fangliang formula with mainboard context passing BD gate` | `MUT1_EXIT=1`（2 用例击杀：600519 期望 1 得 3、688981 期望 3 得 1；放量解放 BD 闸门随 FINANCE(3) 翻转）→还原后 `RESTORE_EXIT=0`（14/14 复绿） |
| MUT2 HY_INDEXC 对齐改按数组下标（错位对齐，非日历日映射） | `marketContext.ts alignIndexField` | `marketContext.test.ts::aligns industry index series to stock daily dates with NaN for missing days` | `MUT2_EXIT=1`（手算 oracle [10,NaN,11,12] vs 错位 [9,10,NaN,11]，多余日/缺失日双轴差异被识别）→还原复绿 |

## 四、门禁

| 门禁 | 命令 | 退出码 |
|---|---|---|
| 定向全绿 | 见二 | 0 |
| typecheck:web | `npm run typecheck:web` | 0（首轮 2→修复 evaluateIncremental 路径变量收集的类型流（IncrementalContext 继承放宽后的 getVariables），同款字符串过滤；语义零变化） |
| build:server | `npm run build:server` | 0 |
| 全量 server 回归 | `npx vitest run --config server/vitest.config.ts` | 0（171 文件 2581/2581 全绿，见「五」） |
| check-binding（本卡矩阵） | `check-binding.mjs --matrix formula-market-context.yaml --strict --include-untracked` | **3（设计内）**：7 行 planned/0 RED——worker 禁写矩阵，test_ids 经收尾报告回传，root 合并后绑定升 covered |
| check-binding（formula-engine） | `--strict` | 0（8/8 covered，零回归） |
| check-binding（formula-cross-period） | `--strict` | 0（7/7 covered，零回归） |

## 五、全量 server 回归

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx vitest run --config server/vitest.config.ts`（全量） | **0** | **171 文件 2581/2581 全绿**（290s；M9-02 基线为 2553/2555 含 2 例负载 flake，本轮零失败零 flake；增量＝本轮新增 21 用例＋M9-02 后新增的其他用例，存量零回归） |

## 六、oracle 独立性声明

- FINANCE(3) 真值表：13 条前缀→类型映射全部手算内嵌（1＝主板为工作区冻结口径；2/3/4 为 proposed_default 标注于测试头注与任务卡）。
- NAMELIKE/CODELIKE 真值表：6＋6 条前缀匹配手算（含 `*ST` 与 `ST` 的区分、`NOT` 组合 0/1）。
- HY_INDEX 日期对齐：显式四日股票轴×四日指数（一缺失日＋一多余日）手算矩阵（C/O/H/L/V/A 六线＋GATE 比较线 [0,0,1,1]）。
- 未注入上下文人话错误：冻结语义断言（/StockContext|上下文/）。
- 服务端接口：fixture 轨合成 56 行业 ASCII 配置＋手写 .day 记录（期望值含 float32 换算）；真机轨锚点＝600519→酿酒/T0305/sh880380（侦查实测钉死，非实现反推）。
- 放量解放重放：BD 闸门 600519 上下文恒 1、688981+ST 上下文恒 0（由冻结语义手推，非取自实现）。

## 七、实现层披露（vendor 保真）

- 新增 `web/src/formula-engine/marketContext.ts`（纯函数＋类型，零引擎反向依赖）；`crossPeriod.ts` 仅增 options 字段＋类型导入；`interpreter/Context.ts` 变量类型放宽（number[]|string）＋StockContext 注入；`interpreter/Interpreter.ts` 增 M9-03 分发 case＋Identifier 兜底＋requireStockContext；`FormulaEngine.ts` options 接线＋两处结果收集字符串过滤。上游逻辑零改动（README 补丁清单 #11~#17）。
- `server/src/tdx/industry.ts`：IndustryEntry 增可选 blockCode 字段并透传（两 TDX 路径均来自 tdxzs3.cfg 第 6 列；显式映射文件路径缺省）。
- `server/src/api.ts`：新增 GET /api/formulas/context 路由（仅调用既有 reader/解析器，无 .day 读取器改动——readDayFileRange 本就接受任意路径含 sh880xxx）。
- 上下文函数未注册进 FunctionRegistry（execute 签名限制），与 marketData 函数族同模式（README 边界披露）。

## 八、待拍板项

- FINANCE(3) 非主板返回值（创业板=2/科创板=3/北交所=4）：proposed_default（速查表无 FINANCE(3) 条目；外网核实各版本编码不一致——百度知道/55188 帖）。主板=1 为工作区冻结口径不受影响。
- HYBLOCK 同族 DYBLOCK/GNBLOCK/FGBLOCK 的服务端数据源：引擎已支持（上下文可选字段），服务端 context 接口暂只提供行业（预判形 shape 冻结）；地域/概念/风格数据（incon.dat 等）不在本卡范围。
