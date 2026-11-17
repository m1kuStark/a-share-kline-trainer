# M9 saving correction: scoped draft review

**Scoped result: no new C/I/M findings in the inspected saving correction (C0/I0/M0). Delivery result: known EMA I1 remains open. This is draft-review evidence, not a merge-ready or full-acceptance verdict.**

Initial capture HEAD: `f392eee24c64eab1f9d0cbe713a87d1f78a4de41`. Final review HEAD: `c83cae6a880e059c91bcf85c0daf7b8ba59d938e` (`chore(formulas): integrate verified maintenance prerequisites`). All five file hashes and the complete scoped diff were rechecked after this HEAD advancement and are identical.

Bound uncommitted diff: `saving-fix-review.diff`, SHA256 `4603d76266603b0c7f4af336d5b957889d41c32cd394bfbf820d8761e099a56b`. Exact file hashes and capture time are in `saving-fix-review-receipt.json`. Scope is FormulaSettings.vue, api.ts, the seed comment, seed preservation test, and final E2E waits. This verdict does not transfer to later changes in those files without checking the receipt.

## 1. Plan alignment

The correction addresses the two approved request defects: include the selected enabled boolean for custom save, and omit protected name/source fields for built-in updates. It also clears stale success text before a new save request. No engine, storage protection, source formula, seed default, placement default, or migration change is in the reviewed diff.

The seed comment now describes an already implemented UI switch. The added test explicitly sets one built-in enabled, reseeds, and checks that its enabled value is retained while the other two remain disabled. This is an appropriate seed-idempotence regression, separate from UI/API coverage.

## 2. Code quality

- `FormulaSettings.vue:129–140`: clear saveMessage before awaiting the request; always include enabled/description/placement; conditionally include name/source only for custom formulas. New custom formulas explicitly supply required name/source to createFormula. There is no await between payload construction and selected-id capture, so this change adds no asynchronous payload/id mismatch.
- `web/src/api.ts:842–866`: optional enabled on FormulaInput makes creation express the persisted choice. JSON.stringify preserves `false`; it is not lost through truthiness filtering.
- Existing backend storage validation checks enabled against undefined, validates boolean type, and preserves false/0 with nullish fallback. Built-in updates still reject any supplied name/source, including unchanged values. No backend guard was weakened.
- Existing UI save-button validation prevents the empty-source early-return from being reached through the enabled save button; this diff does not add an empty-input success path.

No new actionable correctness, security, or maintainability defect was found in this bounded correction. This statement is limited to the reviewed change and does not certify all surrounding FormulaSettings behavior.

## 3. Architecture

The browser uses the existing formula API and backend persistence contract. The change sends the intended fields instead of relaxing backend protections. Built-in source and name remain protected by the authoritative backend. The seed runtime implementation is unchanged.

The independently confirmed public-EMA warmup defect is a separate engine concern. Its diagnosis, numerical oracle, optional unapplied patch, and proposed authorized scope are in `ema-diagnosis.md`. It remains I1 for the complete M9 delivery because QINIU_B1_SUB lacks DEA results and can suppress B1 signals.

## 4. Test authenticity and waits

`e2e/formula-enable.spec.ts:65` now waits until the actual read-only formulaIndicators probe exists. It neither returns synthetic empty results nor catches a missing probe as success. `:100` and `:141` poll actual `hasResult` values instead of checking immediately after indicator registration.

These waits add readiness tolerance and preserve the semantic oracles: fixed expected line counts, every expected line has a finite result, pane placement, refresh persistence, disable disappearance, request body omissions, and the saving-failure message branch. They do not change expectations from true to false, drop DEA, accept fewer lines, bypass rendering, or turn QINIU into a skip. The unchanged immediate hasResult assertions remain after the polls. The 4/1 result confirms the EMA defect still fails the original expectation.

Evidence independently inspected:

- `run-6698a681-156b-49c2-956f-edc72f314b56`: journey log says 4 passed / 1 failed; structured browser results expected=4, unexpected=1, skipped=0, flaky=0. Failed scenario is QINIU with expected `[true,true,true]`, actual `[true,false,true]`. Browser-results SHA256 `e1ff92374a30fd8d5c9155ad021f736ef61ea171ca2977a6e21baf8edaed041e`.
- `run-6eb1ecab-8032-4fac-a5bb-80aa2dc58a2b`: formula-manager plus formula-chart log says 8 passed (55.5s). Structured browser results expected=8, unexpected=0, skipped=0, flaky=0, errors=0. SHA256 `ca200d855615c8ae125433ae88b3cf5531309a9106c7c791f7f69b7860477a6a`. These eight are an existing regression group and are not added to the new five as one green acceptance suite.
- Backend log independently read: `C:/Users/Stark_Du666/.codex/headroom-cache/m9-enable-01-20261118/green-server-targeted.txt`, SHA256 `56c475caf824776de5f70265ee4f6828c867809f9a555c5b34d8b8b91f0ed3e2`. It reports 3 files / 12 passed. It contains neither the invocation/file list nor a native exit code. No matching exit-code receipt was found among the inspected sibling files. The target selection and native exit0 are root-provided provenance; counts are independently verified. Root likewise provides the existing browser group's native exit0; the structured Playwright results independently show zero failures.

No browser or product process was started by this reviewer. The earlier read-only diagnostic scripts exercised genuine engine/server/chart functions and remain separate from the browser acceptance runs.

## 5. Harness and receipt limits

All five reviewed paths are within the current task manifest's allowed paths. The optional EMA patch has not been applied, and engine source still matches HEAD. This reviewer wrote only cache files; no repository, matrix, ledger, branch, database, index, or HEAD mutation was performed.

The inspected run manifest records the expected worktree and HEAD. It does not contain an uncommitted source fingerprint, and runtime directories contain built outputs rather than the reviewed source files. This review therefore binds the current diff and hashes but does not independently certify dirty-source-to-built-runtime byte identity. Final source/package identity, full gate completion, and final independent acceptance remain required before a merge-ready conclusion.

No current gate or full-delivery GREEN is inferred from targeted passing groups. Preserve the known RED and its receipts in any draft PR. Do not label the draft as complete or close the EMA finding on the strength of this saving correction.

## Declined to judge

Full M9 feature acceptance; numerical correctness of QINIU under the current broken EMA; all five enable journeys passing; compiled runtime/source byte identity; a Windows candidate package; installer/manual user acceptance; release readiness; and merge eligibility. Pending engine scope authorization remains the user's decision.

See `saving-fix-review-result.json` for the scoped/complete finding counts and evidence provenance; `saving-fix-review-receipt.json` for HEAD/diff/file hashes. No memory facts were used.
