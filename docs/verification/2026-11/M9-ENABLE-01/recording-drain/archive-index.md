# Recording gzip drain repair evidence

This bundle preserves the original failure and the complete RED/GREEN chain. It is a scoped engineering evidence archive; independent product/code review is pending root and is not represented as passed.

## Result and scope

- Original related Journey `run-841877c0-d471-479d-8169-577c4d7a1606`: native exit 1; 18 passed, recording-long failed after its original 30-minute budget. The precise await was line 140 waiting for the replay last-day button. The page was still in the recording library because browser import JSON parsing failed with `Unterminated string ... position 3924624`.
- Both original exported gzip files are retained under `original-exports-8418/` and independently decompress/parse. The final file has 974 events, 975 checkpoints and 4219137 plain bytes. It was not a corrupt on-disk export.
- Product defect: normal cleanup cancelled the decompressor output reader before its concurrent drain completed. Writable close can settle while readable tail chunks remain queued. The production repair inserts only two explanatory comments and a normal-path await of `draining.catch` before existing cleanup. Formats, budgets and existing error classification/interrupt code are unchanged.
- Exact new unit regression RED: expected 262267 bytes, received 262144, missing the last 123 bytes; native exit 1.
- Complete GREEN command ran both recording-file and recording-bundle files without a test-name filter: 44/44 passed, native exit 0.
- Real two-year Journey `run-b8cb3f18-211d-4fd1-a4d3-0dd36ced0af1`: native exit 0, 1/1 passed, 483 advances, 974 events, 975 checkpoints, export 462ms, import 374ms, restoredCheckpoints 975, no unexpected page errors. Its screenshot and both gzip exports are included.

Both Journey manifests point to HEAD f9454fe, but their source worktrees were dirty. The repaired product SHA256 is `1536368e2ba6e080c96d4d18c05ab40aa43cf4f38278c0e826bd0b0c10716180`; the new-test file SHA256 is `c6db633a296533d80d0923900f1d6beab7c6b8bcab594318b55ef1e1dfa29da4`. These match the complete unit GREEN receipt. Do not infer source identity solely from the shared commit.

## Evidence boundaries

Unmodified native Edge decoding did not reproduce the original timing: original and external candidate each passed 20 current-gzip and 20 old-GREEN-gzip trials, with exact bytes/hash, JSON parsing and public read entry checked. Native Edge with explicitly delayed output-read scheduling reproduced original truncation in 9/9 trials; the external candidate completed 9/9. A deterministic queued-output stream double reproduced original truncation in 5/5 and candidate completeness in 5/5. These prove the cleanup mechanism; they are not an exact replay of the original Journey's unrecorded microtask sequence.

The Node unit regression keeps the native decompressor and yields only output read scheduling. It verifies the independently constructed complete expected bytes. The original 25 tests were displayed as skipped only because the RED command used `-t` to select the new test. No product test was newly marked skip, and all existing test bodies/assertions are preserved. The final full two-file run has 44 passing tests without filtering. Existing budget/corruption/interrupt cases were rerun; the new regression adds normal queued-tail coverage and does not claim to newly cover every abnormal case.

The original failure is preserved. A focused repaired recording Journey does not replace the failed 19-test related Journey or prove the rest of M9/package/migration acceptance. Screenshot inclusion proves artifact availability, not independent visual approval. Independent review will be added by root separately.

## Contents

- `diagnosis/README.md`: original historical investigation and RED handoff. Its at-the-time next-step language is preserved; the repaired GREEN results above supersede it.
- `diagnosis/current/`: original error-context, manifest, browser reporter, full Journey/server logs and derived gzip summary.
- `failed-journey-controller/`: native-exit-1 wrapper receipt/log. Despite the original filename containing green, its receipt truthfully records exit 1.
- `original-exports-8418/`: both original exports, kept byte-for-byte. The final file duplicates the controlled probe's current input intentionally for clear original-artifact provenance; hashes verify identity.
- `diagnosis/controlled-browser/`: unmodified native Edge comparisons, both real comparison gzip inputs, fixed original/candidate source and bundles, complete trial receipts. No browser profiles are included.
- `diagnosis/controlled-drain-schedule/`, `diagnosis/deterministic-close-queue/`: disclosed schedule and deterministic mechanism probes.
- `diagnosis/test-red/`: exact RED command receipt, complete log, regression diff and test source snapshot.
- `unit-green/`: complete 44-pass command, native receipt and full log.
- `green-journey-controller/`, `journey-green-b8cb/`: repaired two-year Journey native receipt, manifest, logs, reporter, metrics, replay PNG and both gzip exports. Built web hashes are listed; runtime/data trees are omitted.
- `source-final/`, `source-baseline-f945/`: final product/test/doc snapshots, narrow repair diff and immutable baseline product/test sources. Source/test fingerprints are in the member manifest and GREEN receipts.
- `gzip-integrity.json`: independent gzip/JSON identity and shape checks for all five selected original/comparison/green exports.
- `semantic-verification.receipt.json`: archived-fact and identity checks. This is not the pending independent product review.
- `provenance.json`, `collection-policy.json`: exact copy origins and exclusions.
- `manifest.json`: bytes and SHA256 for every bundle member except itself.

Browser profiles/cookies, SQLite/TDX data and generated runtime trees are excluded. All source artifacts were read-only; no repository/control/matrix edit or test run was performed by this packaging task. The standalone diagnostic scripts preserve their original absolute paths as execution evidence; relocation requires explicit path adjustment.

The ZIP verification receipt is adjacent to the ZIP. After any later review is appended, regenerate the member manifest, ZIP and archive verification rather than reusing these hashes.
