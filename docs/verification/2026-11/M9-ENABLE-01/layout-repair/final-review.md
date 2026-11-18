# M9 pane layout fixed-snapshot review

Verdict: **可合入（本次 pane 产品补丁范围）**. Critical=0 / Important=0 / Minor=0. No substantive product defect was found in the reviewed calculation, native gesture reconciliation or RAF cleanup. This verdict is code review, not a complete candidate/package/user acceptance result.

## Scope and identity

Read-only review against HEAD `f9454fec92017eba74de2904abf9982deb685ab4`. Before B's temporary mutation, the four files and both diffs were copied outside the repository, and source SHA256 matched before/after copying. Original snapshot receipt: `snapshot.receipt.json`; four-path diff SHA256 `4acdf69e233ea6a8c282eece0319469180932f7d0550163adea524cc922835d8`.

Product snapshots remained byte-identical when the final test was copied:

- `web/src/components/KlineChart.vue`: `99afbf345f0f7eae54e2304b47b0961247d1bfd31cf72ad5d1e240bfd0a1c2b7`
- `web/src/chartPaneLayout.ts`: `a2605ee875919516d601acaa998315624ccc36d7dc18894f59ea1f7c599e1cf0`
- `server/test/chart-pane-layout.test.ts`: `5369cb581dbb74777f3c1275eac4949c417fb330df4567d6286dc623a4332d5d`
- Final `e2e/formula-chart.spec.ts`: `081f33d8e6e1b15f81dd91dac44416254161c02d9add1ce4d155d5382b16e4de`

Sources for findings are the frozen copies under `source/`, with the final fixture under `final-source/`. The pinned installed library10.0.3 was copied as `baseline/klinecharts-10.0.3-index.esm.js`, SHA256 `bcb3e91af61046a1e6d8e4e9d9198887898175ed818febe71922616682e1e264`. No app, test, build or GitHub command was executed by this reviewer; no repository/control/matrix file was written.

## Five review dimensions

1. Plan alignment: the patch preserves all pane identities, reserves a provisional main100px when normal floors fit, proportionally compresses all floors when they do not, restores remembered requests on growth, and returns formula-free panes to native behavior. The task card and display/interaction/library-adapter documentation state the same limits. No acceptance standard was retroactively lowered in the reviewed product patch.
2. Code quality: `chartPaneLayout.ts:3-13` is conservative for the finite nonnegative internal inputs supplied by this component. Its three branches conserve the available budget: unchanged requests when they fit; proportional effective floors when total minima cannot fit; proportional headroom above minima otherwise. The last branch cannot divide by zero under those preconditions because it is reached only when total>budget>=minimum. The geometry matcher at18-21 rejects size/topology/order changes and null geometry.
3. Integration: `KlineChart.vue:576-611` keeps requested and effective heights separate. A sub/sub drag preserves total height and adjusts its requests by delta/previous fraction, preserving the visible endpoint after recompression. A main/sub drag commits the visible layout instead of ratcheting the main minimum; the main floor remains100 or the scaled emergency floor. Formula-free restoration at561-574 and live-ID pruning at558-559 keep the allocator scoped to formula panes. This agrees with pinned library behavior: SeparatorWidget synchronously updates options.height at10730-10738; layout gives candle the remainder at14803-14822; setPaneOptions applies minHeight with height at15421-15426.
4. Gesture/lifecycle: `KlineChart.vue:547` invalidates a gesture synchronously on geometry mismatch, and578 checks again at reconciliation.551 skips budgets while the native pointer is held; a window pointerup schedules a fresh budget at2092 after the earlier pointerup handler clears the pointer at1441. Cancellation clears the pending delta and restores accepted requests at1267-1273. Replay/maximize paths clear or invalidate gesture intent.2161 cancels the outstanding RAF, clears maps/gesture state and removes listeners; the callback also checks chart/host/disposed. No actionable leaked-frame or stale-gesture defect was found.
5. Test/evidence authenticity: the added Journey uses real mouse events and read-only pane observations, tests pressed/immediate-release/settled geometry, grows/shrinks repeatedly, checks emergency visibility, main-boundary reversal, all-formula disable and the new resize-during-held-drag case. The final donor correction adds a precondition and retains the original abs>10 and restored-request assertions. Existing output from `run-99cc271f-0f3a-4213-8fdc-858236eb85d8` was copied read-only: expected1/unexpected0/skipped0/flaky0. This reviewer inspected its report and attachments; native0 and six-size visual review are root's execution observations, not executions independently repeated here.

## Resolved fixture issue

The initial frozen test at `e2e/formula-chart.spec.ts:371-375` attempted another +15px sub/sub drag after its preceding compressed drag had left MACD at36.933333px. The original failure report received6.933333px; this equals MACD36.933333 minus its native min30. The pinned SeparatorWidget10718-10738 selects the lower pane as donor for a downward drag, so the failure is caused by the fixture's insufficient donor space, not a pane-budget bounce.

The original `dense-compressed-separator-drag` attachment from runcc3ce6c6 shows main/VOL/MACD before `[100,68.533333,54.933333]`, and move/up/settled all `[100,86.533333,36.933333]`. The final fixture at364-384 changes to-15px and explicitly asserts `VOL.height-30>15`; its original displacement>10 and restored preferred heights assertions remain unchanged. `held-donor-fixture.normalized.diff` contains the exact semantic diff. Final GREEN's compressed attachment retains identical move/up/settled values, and the held-resize attachment restores roomy preferred values. The fixture issue is resolved in the final snapshot and is not listed as an outstanding finding.

## Problems

- Critical: none.
- Important: none in this pane patch.
- Minor: none. The previously removed cache-only note was not repeated.

## Declined to judge

- The provisional100px main reserve's readability, aesthetics and whole-product user acceptance require root/operator visual judgment. Static arithmetic and the Journey's nonzero/minimum assertions cannot decide this.
- The complete candidate, same-commit Windows package, installer/upgrade, full replay fidelity and all other regression suites were not rerun. The known original f945259/2 candidate failure is not erased by the one-case GREEN inspected here.
- Harness strict-binding commands and test-list queries were not rerun because this assignment explicitly forbids test/app execution and matrix/control writes. This report cannot certify the entire gate receipt set; root retains that responsibility.
- The separately investigated recording decompression/cleanup race is outside the pane review and does not affect this verdict's scope.

Recommendation: retain this review with the exact final source hashes, then run the required overall gate and package checks against the eventual frozen commit. Root may record this scoped verdict through gate-report.
