# evaluation_metrics.py — 离线效果对照（ORCH-04 切片B）

纯 Python 3.9 标准库的离线对照工具：对同一实验下 baseline 与 adaptive 两种策略的**完整逻辑运行**做描述性统计与成对差值。无模型/网络调用、无 Git 操作、不签收据、不推进任何流程；输出永远是咨询性质（`can_promote=false`）。输入里的 `verification`、质量真值与用量声明只是声明，本工具不做密码学认证，不能产生验收凭据。

核心纪律：

- 缺计量保持 null（未知），绝不补零；来源 `unknown` 或角色不完整时该角色指标为未知；没有任何运行记录的策略，其 token/时长/干预总量也是 null（计数仍为 0）。
- 失败、拒绝、未知运行全部保留在计数与聚合成本里，失败成本不会从总量中消失。
- `verification.run_id` 是**验证器收据/运行 ID**，不是逻辑执行的 `run_id`，二者不要求相同。accepted 须有非空收据 ID 且 candidate/oracle 指纹与运行记录一致；只有 `accepted + 真值 passed + 独立验证 + 非空收据 ID + 指纹匹配当前 candidate/oracle` 才算合格交付；其余 accepted 一律作为可见质量违规保留（错误放行不删数据）。
- 聚合不得把不可比的计量混成数字：策略内各运行的 token 口径（`token_basis`）、测量范围或该角色来源不一致时，该角色 token 聚合与派生成本为 null 并给原因（`aggregate_reasons`）；逐运行原始观测照常保留。
- 总体节省对照要求**每个策略至少一个合格交付**且双侧强模型 token 总量已知，否则 `comparison_valid=false`（不给 -100% 之类的假差值）。
- 逐对 token 差值只在双侧均合格的"成功对"上计算，并标注 `conditional_on_success`；总体差值则始终基于全量运行的聚合（失败成本含在内）。
- 不估计 USD、不宣称统计显著性；小样本对照不证明普遍节省。

## 用法

API（冻结公共接口）：

```python
import evaluation_metrics as em
report = em.evaluate_runs(experiment, runs)   # dict, dict列表 -> 报告dict；输入畸形抛 ValueError
```

CLI（只写一个新 JSON，拒绝覆盖已存在输出；输入上限 1 MiB、严格 JSON、拒绝重复键与非有限常量，语义与 `route.read_input` 一致）：

```
py -3.9 -B scripts/agent-routing/evaluation_metrics.py --input <input.json> --out <NEW_report.json>
```

## 输入 schema

`--input` 文件为 `{"experiment": {...}, "runs": [...]}`。

experiment（固定角色映射与口径，run 内不得改标）：

| 字段 | 约束 |
|---|---|
| `schema_version` | 整数 `1`（bool 拒绝） |
| `experiment_id` | 非空字符串（仅空白拒绝） |
| `model_roles` | 非空对象 `{实际模型id: 'strong'\|'weak'}`；**允许只含一个角色**（如仅 strong），缺失/未计量角色按各 run 的 `usage_complete`/来源标志处理；未声明的模型 id 拒绝 |
| `token_basis` | 必须为 `total_input_including_cache` |
| `measurement_scope` | 非空字符串（仅空白拒绝） |

每个 run（完整逻辑运行：含全部侦查/执行/修复/审查，已按模型聚合为其单行用量）：

| 字段 | 约束 |
|---|---|
| `schema_version` | 整数 `1`；`run_id` 全局唯一字符串 |
| `case_id` / `case_revision` / `trial_id` | 非空字符串 |
| `strategy` | `baseline` 或 `adaptive` |
| `input_fingerprint` / `oracle_sha256` | 64 位十六进制 |
| `candidate_fingerprint` | 64 位十六进制或 null |
| `measurement_scope` / `token_basis` | 非空字符串；须与 experiment 一致（不一致按不兼容报告，不静默丢弃） |
| `outcome` | `accepted` / `rejected` / `failed` / `unknown`（被评估管线自己的裁决） |
| `ground_truth` | `passed` / `failed` / `unknown`（独立质量真值） |
| `verification` | `{independent_verified: bool, run_id: string\|null, candidate_fingerprint: 64hex\|null, oracle_sha256: 64hex\|null}`；`run_id` 是**验证器收据/运行 ID**（如 `verify-…`），不是逻辑执行 `run_id`，二者不要求相同；accepted 须非空收据 ID 且指纹与运行记录一致 |
| `attempt_count` / `repair_count` | 正整数 / 非负整数且 `repair_count < attempt_count` |
| `elapsed_seconds` | 有限非负数或 null |
| `strong_interventions` | 非负整数或 null（不从 replan 推断，缺计量即 null） |
| `usage_complete` | `{strong: bool, weak: bool}`（该角色计量是否完整） |
| `measurement_source` | `{strong: 非空字符串, weak: 非空字符串}`；`'unknown'` 表示该角色不可量化 |
| `usage` | 数组，每模型一行 `{model_id, input_tokens, output_tokens, cache_read_tokens}`，各计数为非负整数或 null；重复模型行拒绝 |
| `notes` | 可选字符串 |

规则：所有计数拒绝 bool/负数；时长拒绝非有限值；非空字符串校验（id、来源、范围等标识符）拒绝仅空白值；`cache_read_tokens <= input_tokens`（缓存已含在总输入里，**不再相加**）；角色总量 = 该角色各模型 `input_tokens + output_tokens`。角色显式完整但无调用行 → 已知零；来源 unknown、角色不完整或行内计数为 null → 未知（null）。

## 判定与配对

- **合格交付**：accepted ∧ 真值 passed ∧ `independent_verified` ∧ `verification.run_id` 非空（验证器收据 ID，**不要求等于 run_id**）∧ candidate/oracle 指纹均与运行记录一致。
- **质量违规**（保留并计数，不删记录）：`false_acceptance`（accepted 但真值 failed）、`unverified_acceptance`（未独立验证）、`missing_verification_id`（accepted 但收据 ID 缺失）、`binding_mismatch`（指纹不匹配或 candidate 缺失）。`rejected + 真值 passed` 记为**错误拒绝**（单独列出，不影响总体有效性条件）。
- **配对**：按 `(case_id, trial_id)` 严格一 baseline 一 adaptive；重复策略键（即使 revision 不同）与重复 `run_id` 直接 ValueError。缺对手的运行进入 `unmatched_runs` 明确报告。
- **兼容**：两侧 `case_revision`、`input_fingerprint`、`oracle_sha256`、`measurement_scope`、`token_basis` 必须一致且与 experiment 一致；逐对 `measurement_source` 按角色必须一致，否则该指标的比较为未知。不兼容写入 `incompatibility_reasons`，绝不静默取第一条/最后一条/最小值。

## 输出字段

聚合口径必须与experiment一致，即使所有运行采用同一种其他token口径，也不形成有效token总量或单位交付成本。measurement_scope不一致时，时长及强模型介入汇总同样为null；原始逐运行观察和运行/尝试次数保留。仅token口径不同不会抹掉范围一致的独立时长计量。

| 字段 | 含义 |
|---|---|
| `can_promote` / `advisory_only` | 恒为 `false` / `true` |
| `generated_from` | experiment 摘要与 run 总数 |
| `per_strategy.<strategy>` | `run_count`；`outcome_counts`；`ground_truth_counts`；`qualified_delivery_count/rate`；`false_acceptance_count`；`false_rejection_count`；`unknown_quality_count`；`quality_violation_count`；`attempt_count_total`；`repair_count_total`；`strong_interventions_total`（任一未知即 null；无运行记录也是 null）；`elapsed_seconds_total`（同）；`tokens.strong/weak`（聚合 null；策略内口径/范围/来源不可比时不求和并给 `aggregate_reasons`）；`tokens_unknown_run_ids`；`measurement_sources`；`aggregate_reasons`（聚合拒绝原因）；`cost_per_qualified_delivery = 全部运行的强模型 token 总量 / 合格交付数`（分母 0 或总量未知/不可比即 null） |
| `pairs[]` | `compatible`、`incompatibility_reasons`、`measurement_source_match`、`baseline/adaptive/both_qualified`、`conditional_on_success`、`values`（两侧原始值）、`deltas`（adaptive−baseline；`strong_tokens`/`weak_tokens` 仅在兼容+来源一致+双侧合格时给出，即条件于成功）、`delta_limitations`（null 原因） |
| `unmatched_runs[]` | `run_id`、`strategy`、`reasons` |
| `quality_violations[]` | `run_id`、`strategy`、`kinds` |
| `false_rejections[]` | `run_id`、`strategy` |
| `run_records[]` | 每运行一行判定摘要（qualified、违规种类、各角色 token 等） |
| `overall` | `comparison_valid` 与 `validity_reasons`；`strong_tokens`（baseline/adaptive/delta/relative_change + 原因）、`weak_tokens`、`elapsed_seconds`、`strong_interventions`（各带 delta 与原因）；`qualified_delivery_rate`；`cost_per_qualified_delivery`；`caveats` |

**总体有效性条件**（全部满足才 `comparison_valid=true`，否则总体强模型差值/相对变化为 null 并给原因）：配对完整且兼容、accepted 均有非空收据 ID 的当前绑定验证、无错误放行、无未知质量、合格交付率不下降、**每个策略至少一个合格交付**（双侧全失败/全拒绝时无效，不给 -100% 假差值；原始失败成本总量照常可见）、**双侧强模型 token 总量已知**（缺计量即无效）且强模型计量来源跨策略可比。相对变化在 baseline 总量为 0 时为 null（不做除零）。弱模型差值额外要求弱来源可比；`elapsed`/`strong_interventions` 差值同样仅在总量已知时给出。

## 示例（ORCH-03 试点实测形状；强模型用量与耗时未知、无 baseline → 不可量化节省）

输入取自实际观测记录（3 次尝试、2 次纠偏续跑；强模型干预/token 与完整墙钟时间未可靠计量，故为 null；GLM 计数来自 provider 聚合，非账单金额；指纹为真实 64 位十六进制记录）：

```json
{
  "experiment": {"schema_version": 1, "experiment_id": "orch04-observed-pilot",
                 "model_roles": {"gpt-6": "strong", "GLM-5.3-Flash": "weak"},
                 "token_basis": "total_input_including_cache",
                 "measurement_scope": "All ORCH-03-PILOT planning, execution, corrective continuations and review; infrastructure development excluded; unmetered control work remains unknown."},
  "runs": [{
    "schema_version": 1, "run_id": "ORCH-03-PILOT-complete",
    "case_id": "sample-config-help", "case_revision": "1",
    "trial_id": "observed-20260925", "strategy": "adaptive",
    "input_fingerprint": "246b9c83d39d40e8bf06968e226b05800b6f57dcbea847b24a499131c078b881",
    "oracle_sha256": "af1ae66525d911c6d001dfaca384b5f8cb7be591c151a83318e24512345f1aa6",
    "candidate_fingerprint": "21452fab7805af25905e6c800c1d778109a82dd2486c58d94240238a87b694ee",
    "measurement_scope": "All ORCH-03-PILOT planning, execution, corrective continuations and review; infrastructure development excluded; unmetered control work remains unknown.",
    "token_basis": "total_input_including_cache",
    "outcome": "accepted", "ground_truth": "passed",
    "verification": {"independent_verified": true,
                     "run_id": "verify-d957804fb9174558a622b2f1b5df611f",
                     "candidate_fingerprint": "21452fab7805af25905e6c800c1d778109a82dd2486c58d94240238a87b694ee",
                     "oracle_sha256": "af1ae66525d911c6d001dfaca384b5f8cb7be591c151a83318e24512345f1aa6"},
    "attempt_count": 3, "repair_count": 2, "elapsed_seconds": null,
    "strong_interventions": null,
    "usage_complete": {"strong": false, "weak": true},
    "measurement_source": {"strong": "unknown", "weak": "provider"},
    "usage": [{"model_id": "GLM-5.3-Flash", "input_tokens": 1331558,
               "output_tokens": 18604, "cache_read_tokens": 1206080}]
  }]
}
```

注意 `verification.run_id`（`verify-d957804f…`）是验证器收据 ID，与逻辑执行 `run_id`（`ORCH-03-PILOT-complete`）不同——这正是合法输入，不构成绑定违规。

报告要点（节选）：`per_strategy.adaptive.qualified_delivery_count = 1`，`quality_violations = []`；`per_strategy.adaptive.tokens = {"strong": null, "weak": 1350162}`；`unmatched_runs` 1 条（无 baseline 对手）；`overall.comparison_valid=false`，`validity_reasons` 含 `no runs recorded for strategy 'baseline'` 与 `strong token totals unknown for strategy 'adaptive'`，`strong_tokens.delta=null` —— 即如实输出"强模型节省不可量化"，不从该样本推断任何节省。

## 测试

`py -3.9 -B -m unittest discover -s scripts/agent-routing -p test_evaluation_metrics.py -q`（44 项，全部合成夹具/临时目录）。覆盖：已知零 vs 未知 null；无运行记录策略的总量为 null（计数为 0）；失败运行照常计费与计数；一对一配对与重复键拒绝；revision/oracle/input/scope/basis/source 不兼容；混合口径/来源不做跨源求和（强聚合与派生成本 null 且给原因，可比的弱/时长照常给出）；错误放行、缺失收据 ID、指纹不匹配、错误拒绝；验证器收据 ID 与 run_id 不同仍合格；缺强计量使总体无效；无合格交付使节省对照无效（不做 -100%）；bool/负数/非有限值；仅空白标识符拒绝；单角色 model_roles 接受；缓存不重复相加；无合格交付的成本为 null；baseline 为 0；未知模型；畸形/超限/重复键 JSON；CLI 拒绝覆盖输出；ORCH-03 实测形状示例。

## 边界与限制

- 只做描述与对照：不签收据、不调模型、不推进 Git、不冒充 TypeScript candidate-proof。
- 输入声明未经本工具认证，不能作为验收凭据；真实证据仍由独立验证收据体系约束。
- 条件于成功的逐对差值不包含失败成本；总体聚合才含失败成本，两者用途不同，不得互相替换。
