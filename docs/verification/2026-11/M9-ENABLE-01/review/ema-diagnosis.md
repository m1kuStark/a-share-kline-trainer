# QINIU_B1_SUB independent diagnosis and proposed successor

Reviewed HEAD: `f392eee24c64eab1f9d0cbe713a87d1f78a4de41` in the M9-ENABLE-01 worktree. This is a read-only diagnostic verdict, not final approval of M9-ENABLE-01. All reviewer artifacts are in this cache directory; no repository, matrix, ledger, index, branch, browser, or database was changed.

**Verdict: C0 / I1 / M0. M9 full acceptance remains blocked.** The existing QINIU_B1_SUB source exposes an old engine defect. The enabled-request correction and this engine correction are different scopes. Current user approval and M9 allowed paths do not include `math.ts`; obtain a concrete scope extension before applying any engine change.

## Root cause

- `web/src/formula-engine/interpreter/functions/math.ts:38–61`: EMA initializes only at absolute index `period - 1`, using the first `period` input items. At every later index it uses the previous result.
- The seeded formula is unchanged: `DIF:EMA(CLOSE,12)-EMA(CLOSE,26); DEA:EMA(DIF,9); B1:IF(CROSS(DIF,DEA),1,0);` (`server/src/formulas/seed.ts:38`). DIF has a normal 25-item NaN warmup. DEA seeds at index 8 from NaNs and never recovers.
- `logical.ts:44–59`: comparisons against NaN are false. CROSS therefore yields zero, and IF produces finite zeros for B1. A finite B1 line does not establish correct signals.
- `web/src/formulaIndicators.ts:92` converts non-finite results to null. `server/src/formulas/evaluate.ts:25–45` does the same and returns `ok:true` unless evaluation throws. Neither creates the invalid DEA.
- `functions/indicators.ts:10–51,165–167` has a separate EMA helper used by MACD_DEA, which shifts the seed past a leading NaN prefix. This explains the inconsistency with the public EMA function.

## Reproduction and independent oracle

`ema-diagnostic.mts` imports the genuine source engine, chart evaluator, real server loader, real evaluateOnBars, and actual seed source. The server source bundle is absent, so its loader exercised the source fallback. Both diagnostic runs exited 0; the script deliberately asserts the observed defect and separately checks mathematical expectations. This is not a green product acceptance run.

For 120 bars with close `1..120`:

| Entry | DIF first finite / count | DEA first finite / count | B1 |
|---|---|---|---|
| Genuine FormulaEngine | 25 / 95 | none / 0 | 120 finite zeros |
| evaluateFormulaChart | 25 / 95 | none / 0 | 120 finite zeros; error=null |
| Server loader + evaluateOnBars | 25 / 95 | none / 0 | 120 finite zeros; ok=true |
| Independent SMA-seed oracle | 25 / 95 | 33 / 87 | zero is correct for this linear series |
| Existing MACD_DEA helper | — | 33 / 87 | — |

The oracle uses a mean over the first contiguous finite window and `alpha*x+(1-alpha)*previous`, independently of either production helper. Tiny hand example: `EMA([NaN,NaN,2,4,6,8],3)` must be `[NaN,NaN,NaN,NaN,4,6]` under the engine's already documented SMA-seed convention. Current public EMA returns all NaN. For close `1..N`, EMA12 is `C-5.5`, EMA26 is `C-12.5`, so DIF=7 from index25; the first nine valid DIFs seed DEA=7 at index33.

On 120 bars with close `50+10*sin(index/5)+0.05*index`, the independent oracle has B1 cross indexes `[61,93]`; the actual engine has `[]`. This demonstrates lost signals in addition to a missing rendered DEA.

Existing `server/test/formula-engine/interpreter/functions/math.test.ts:38–67` tests uninterrupted finite EMA and period1. `server/test/formula-seed.test.ts:117–122` checks parse/evaluate success and output lengths, so an all-null DEA passes those assertions. These observations describe the inspected tests, not a claim that every repository test has been audited for NaNs.

## Concrete minimum scope extension

Suggested task identity: `M9-EMA-WARMUP-01` (proposed name only; no task, manifest, or matrix was created).

Runtime change: only `web/src/formula-engine/interpreter/functions/math.ts::EMA`. Find the first item that is not NaN, set the SMA seed at `firstValidIndex+period-1`, and retain the current reverse-order sum and recurrence verbatim. Fill all leading entries with NaN. If there is no non-NaN item, return all NaN. Do not collect values across internal holes, reorder data, replace NaN with zero, change to first-value seeding, or restart after later holes.

`ema-leading-nan.optional.patch` contains this optional runtime diff. It was generated from the reviewed source and **was not applied**. `git apply --check` exited 0. The cache-only candidate was imported and tested independently: five hand/boundary cases, 108 exact old-versus-candidate comparisons for finite inputs (including empty/short arrays, periods1/2/3/9/12/26, linear/constant/oscillating values), and three compatibility observations for later NaN/+Infinity/-Infinity all passed. The candidate composition produces DEA=7 at index33. These checks validate the proposal locally; they do not substitute for real-engine, server, browser, or package checks after approval.

### Semantics to approve and leave explicit

- Established contract: use alpha `2/(N+1)`, SMA seed, insufficient warmup => NaN. Existing uninterrupted finite-input values must remain exact, including period1.
- New bounded behavior: skip only a **leading NaN prefix** introduced by another expression. The seed window still consists of contiguous original array positions. It requires the requested number of available items after the prefix.
- Existing observed behavior: an internal NaN after seeding poisons later recurrence; Infinity can produce Infinity and then NaN through native arithmetic. Current docs do not define recovery, interpolation, or restart semantics for these cases. Keep their existing behavior in this patch; label recovery policy unresolved rather than silently adopting one.
- Use `!Number.isNaN`, not `Number.isFinite`, for locating the prefix end in this bounded patch. Filtering Infinity would introduce another behavior change. Do not export/reuse/refactor the other helper in this task; it also does not provide general hole recovery.
- Preserve CROSS and IF semantics. Do not make all-null outputs globally throw: insufficient bars can legitimately produce all-null lines.
- The built-in visual MACD in `web/src/indicators.ts` uses first-value initialization. It is not the numerical oracle for this patch and remains outside this scope.

### Proposed allowed paths

1. Runtime: `web/src/formula-engine/interpreter/functions/math.ts`.
2. Focused unit and integration tests: `server/test/formula-engine/interpreter/functions/math.test.ts`, `server/test/formula-engine/integration/FormulaEngine.test.ts`.
3. Product regressions: `server/test/formula-seed.test.ts`, `server/test/formula-chart.test.ts`; retain `e2e/formula-enable.spec.ts` unchanged unless adding stronger value assertions. Do not remove or weaken `hasResult`.
4. Contract and patch record: `web/src/formula-engine/README.md`, `docs/specs/formulas.md`, the approved successor task, affected M9/ENG indexes and generated status, successor verification directory. Keep documentation changes tied to the approved behavior and result.
5. Outside the repo, a separately authorized harness update to `D:/Superlinear_Academy/Stock_WorkSpace/.zcode/skills/ai-harness/matrix/formula-engine.yaml` is needed. The current `FE-VENDOR-BASELINE` row and matrix note freeze upstream v1.0.0 semantics; record the explicit new exception instead of weakening the existing baseline assertions.

No formula source rewrite, indicator-helper refactor, parser change, CROSS change, chart built-in MACD change, storage migration, enabled default reset, dependency change, or release action is needed.

### Required regressions and matrix bindings

Add focused tests with literal names and independent expectations; proposed rows are not installed:

| Proposed row | Test and expectation |
|---|---|
| FE-EMA-LEADING-NAN | math.test: hand `[NaN,NaN,2,4,6,8]`, period3 => index4=4,index5=6; all-NaN; too few post-prefix items; period1 |
| FE-EMA-FINITE-COMPAT | math.test: existing finite cases remain; deterministic old frozen vectors/independent expected numbers, including constant and oscillating values. Compatibility checks must not compute expected data with the patched helper |
| FE-EMA-NESTED | FormulaEngine.test: `X:EMA(EMA(CLOSE,3),3);` on C=1..7 => four warmup NaNs then `[3,4,5]` |
| FE-EMA-QINIU-DEA | real seed/server/chart tests: C=1..120 gives DIF first index25, DEA first index33 and 87 values equal7; bars before index33 remain null; B1 all0 for linear input |
| FE-EMA-QINIU-CROSS | real source evaluation on the fixed oscillating fixture gives B1 at indexes61 and93, using an independent oracle/tolerance for DEA |

Add compatibility coverage for internal NaN only if the test is explicitly labeled retention of existing behavior; do not claim that this resolves the product's general non-finite input policy. Use the existing `FORMULA-CHART-SUB` and M9 enable rows as affected integration coverage; no need to duplicate them as engine semantics. Existing `FE-VENDOR-BASELINE` and `FE-CORPUS-SMOKE` remain required, with the approved exception documented.

After separate approval: archive a new RED for the focused defect, apply the minimal patch, run targeted function/integration/seed/chart tests, the complete server+desktop suite, existing engine corpus/baseline and relevant guards/binding checks, and web/server builds. Rerun **all five** M9 enable journeys on the same final source/dependency tree. Rebuild server engine bundle and the requested Windows candidate package from that final tree, preserving final hashes, native exit codes, and identity. Do not splice earlier targeted green runs into a claimed complete total. Finish with the required independent review and existing manual acceptance/release boundary.

## Five review dimensions and limits

- Plan alignment: M9 request fields remain bounded; no approval inferred for this discovered engine correction.
- Code quality: I1 is the permanent NaN propagation and suppressed signals. The proposed fix preserves continuous finite arithmetic and avoids a refactor.
- Architecture: browser/server share the source engine, so the defect affects both. Parallel EMA helpers explain inconsistency but are not refactored in the minimum fix.
- Test authenticity: genuine engine/server/chart calls plus separate arithmetic oracle; no browser started. Parent-provided 4/5 E2E result is corroborating evidence, not rerun by this reviewer.
- Harness: source EMA SHA256 before/after matches; optional patch check0; no matrix/state/ledger writes. The current task allowed list excludes engine changes. Receipt and full diagnostic JSON are in this cache.

Declined to judge: full M9 enable implementation acceptance, production package behavior, real-market numerical equivalence to the user's TDX version, historical first-value versus SMA preference, internal-hole recovery policy, complete corpus regressions, and human acceptance. Those remain independent checks or decisions.

Artifacts: `ema-diagnostic.mts/.json/.raw.log`, `ema-candidate-validation.mts/.json/.raw.log`, `ema-leading-nan.optional.patch`, `ema-review-receipt.json`, and source/test/matrix snapshots. No memory-derived facts were used.
