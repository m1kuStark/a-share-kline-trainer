# M9-02 验证记录（跨周期/跨公式引用自研，2026-10-26）

- base `99311dc`（M9-02 立卡 docs 提交）；交付 commit 见任务卡「本轮交付」回填
- 规格：docs/work-items/tasks/M9-02.md（语义冻结＋root 预判定）；矩阵 formula-cross-period.yaml 7 行（root 预登记，worker 未编辑）
- 纪律适配（root 预声明）：纯引擎零 UI，journey/e2e 不适用；替代收据＝全量 server 回归＋typecheck＋corpus 提升

## 门禁表（命令＝字面退出码；root 将独立复跑关键断言）

| 门禁 | 命令 | exit | 结果 |
|---|---|---|---|
| 基线复现（探针，HEAD=99311dc） | corpus 逐块执行 | — | parse 22/23、exec **9/23**（9＝M9-01 BASELINE_EXEC_OK 8＋六龙连山-1，后者系 M9-01 语句修饰补丁增益、未入名单）；执行失败 14 块分类见下表 |
| RED | `vitest … crossPeriod.test.ts`（新增，先于实现） | 1 | **20 失败/2 通过**——失败原因逐类核对为缺功能（`resampleBars is not a function`×4、`must be numeric`×引用仍是字符串、裸写不 throw 等）；2 通过＝既有行为回归守卫（用户局部 MACD 定义优先、DRAWTEXT 字符串文本），属预期绿 |
| GREEN 定向（全套件） | `npx vitest run --config server/vitest.config.ts server/test/formula-engine/` | 0 | **25 文件 768/768**（上游 717 移植＋M9-01 patches/corpus＋M9-02 新增 22＋corpus 新增 2） |
| typecheck | `npm run typecheck:web` | 0 | vue-tsc 零错误 |
| build:server（全量前置） | `npm run build:server` | 0 | tsc 零错误 |
| 全量回归 | `npx vitest run --config server/vitest.config.ts`（不带路径） | 1 | 2553/2555；2 失败＝random-training-mode RF-05（test timeout 5s）＋review-profile（hook timeout 15s），**隔离复验 2 文件 49/49 全绿 exit 0**＝负载性 flake（M9-01 同范式先例：全量轮换超时、隔离全绿）；两套件与 formula-engine 零 import 关联 |
| check-binding（cross-period） | `… --matrix formula-cross-period.yaml --strict --include-untracked` | 3 | 7 行 planned、RED=0＝**派发简报预期值**（root 回填 test_ids 升 covered 后应转 0） |
| check-binding（formula-engine） | `… --matrix formula-engine.yaml --strict --include-untracked` | 0 | **8 covered 全解析＝M9-01 零回归** |
| 变异 MUT1 | broadcastReferenceLine 末组改为整组单值广播（仅完整周） | 1 | **4 杀手击杀**（trailing week/month、weekly MACD 末周锚点、aux 注册表末周 oracle）→反向定点还原，复绿 22/22、grep MUTATION 残留=0 |
| 变异 MUT2 | 默认 provider 柱体去 ×2（DIF−DEA 不放大） | 1 | **2 杀手击杀**（896/351、1792/351 精确分数锚点；裸 MACD 与参考实现逐 bar 相等）→还原复绿 |

## corpus 回放对比（M9-01 后基线 → 本轮）

| 指标 | 基线（HEAD） | 本轮裸重放 | 本轮组装重放 |
|---|---|---|---|
| 解析通过 | 22/23 | 22/23（零变化） | 同左 |
| 执行通过 | 9/23 | **11/23** | **14/23**（≥13 达标） |

逐块归属（23 块全量）：

| 块 | 基线 | 本轮 | 归属说明 |
|---|---|---|---|
| 乖离度×2、六龙连山-1/2、骑牛买1×2、骑牛买3-1/2/4 | OK | OK | 基线 9 块零损失（测试逐名断言） |
| 骑牛买2-1 | FAIL（周线C must be numeric） | **OK** | 跨周期引用 `"MACD.MACD#WEEK"` 等 5 处（裸重放通过） |
| 骑牛买3-5 | FAIL（周DIF must be numeric） | **OK** | 严格口径 REF(周DIF,WEEKDAY)＋SUMBARS(MONTH!=…) 形态（裸重放通过） |
| 分金定穴-1/2/3 | FAIL（Undefined identifier MACD） | 仍 FAIL | 裸 `MACD` 已解析为内置线，但块内另有 N/M（参数区被语料抽取剥除）与块1 的 RED_MAX_144/GRE_MIN_144——**组装前奏后 OK**（前奏值与归属见 corpus-smoke.test.ts 头注；N/M=144 属 proposed_default 待拍板） |
| 分金定穴-4 | FAIL | FAIL | 跨块伪影（IS_RED）——豁免口径不变 |
| 六龙连山-3/4/7 | FAIL | FAIL | M9-03 板块函数域（HYBLOCK/INBLOCK/HY_INDEXC 族） |
| 六龙连山-6 | FAIL | FAIL | INDEC——M9-03 域（侦察归伪影，本卡维持不计） |
| 六龙连山-5/8 | FAIL | FAIL | 跨块伪影——豁免口径不变 |
| 骑牛买3-3 | FAIL | FAIL | 跨块伪影（峰距）——豁免口径不变 |
| 万能过左峰-1 | parse FAIL | parse FAIL | 语料编码伪影——豁免口径不变 |

额外实盘重放（不计入 /23 分母）：骑牛买1 **严格版/宽松版**全文执行通过（WEEKDAY/SUMBARS 严格口径＋REF 近似口径；源文件运行时节选、注释由 lexer 跳过）；**周线144选股＋W144UP 辅助公式**端到端通过（注册表注入、800 根合成日线、预热边界=第 145 周组处 XG 首次可真）。

## oracle 独立性声明

- 周/月 OHLCV 聚合、广播、末周逐日前缀：全部手算字面常量（1 月 20 根＋2 月 5 根＋3 月 2 根显式夹具）。
- MACD 周线：**精确分数手算锚点**（末周 Tue：DIF=560/351、DEA=112/351、柱=896/351；Wed 值×2）＋测试内按速查表文档口径独立复写的参考实现（refEMA：SMA 种子、2/(N+1)、前导 NaN 跳过）做逐 bar 差分——期望不取自被测引擎。
- 常数周序列的 NaN 结构（DIF 自 0 基第 26 周、DEA 自第 34 周）＝EMA 播种规则直接推论。
- 环/深度/未注册/无输出线错误＝冻结语义的人话断言（/环/、/8/、/未注册/、可用输出名）。

## 实现层披露

- 新增 `web/src/formula-engine/crossPeriod.ts`（纯函数＋类型，零引擎反向依赖）；`lexer/TokenType.ts`+`lexer/Lexer.ts` 增 DOT/HASH 两 token；`parser/ast/nodes.ts` 增 PeriodReference；`parser/Parser.ts` 两形态解析＋周期校验；`interpreter/Context.ts` 增 resolver 注入与 `getMarketData()`；`interpreter/Interpreter.ts` 增 PeriodReference 求值＋裸 MACD/DIF/DEA 兜底（变量优先）；`FormulaEngine.ts` evaluate 第三可选参数＋引用栈递归（环/深度）。上游逻辑零改动（见 README 补丁清单 #7~#10）。
- **移植基线测试单点更新**：`unit/lexer/Token.test.ts` 的枚举计数断言 31→33（DOT/HASH 注入所致），断言保留、注记 M9-02——非删除断言换绿；formula-engine 矩阵 8 行绑定用例不受影响（check-binding exit 0 证实）。
- 语料夹具既知形态披露：corpus syntheticBars 首根 bar 落在周二（`new Date('2025-01-06')` 按 UTC 解析＋本地时区后移），首周组=4 根；周线144 测试的预热边界按 resampleBars 组结构推导而非硬编码。

## 待拍板（needs_user_decision / proposed_default，见收尾报告）

1. 分金定穴 1~3 的「主体块＋参数前奏」组装重放口径（裸重放 11/23 不达 ≥13，组装 14/23 达标；前奏含 N/M=144 取值）。
2. 任务卡内嵌 JSON summary 含未转义直引号致 task-manifest.mjs 解析失败（立卡时既有，本卡仅追加「本轮交付」未修）。
