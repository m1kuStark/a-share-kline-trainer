# M9-ENABLE-01 frozen evidence staging

Prepared outside the repository. Intended destination: docs/verification/2026-11/M9-ENABLE-01/final/.
Product source freeze: f70137182ac75635b006d567b34616cc9a9f1bd4. These archives do not represent a final candidate pass or human acceptance.

## Contents

- source-ci: original GitHub CI ZIP for PR55 source run 44160559239 plus original API responses, README, native command receipts and source indices. Source CI passed on synthetic merge 06e1c4e7b265b27c6fa5138f8ae22cb1a952467a whose tree matches f701371; it does not establish local candidate/package acceptance.
- review: frozen scoped static review, original product diff, targeted receipt audit, list-only output and preserved preparation errors. Original verdict covers the reviewed scope only.
- asar: actual ASAR identity and unchanged v2 verifier, one positive and three negative oracle cases, exclusion-rule audit and native receipts. Repeated extracted runtime trees are intentionally omitted.
- journey-fixture: seven completed failing test contexts, original diagnosis, unapplied RED/GREEN proposal snapshots and patch checks as captured at diagnosis time. The original tests failed with four expected panes and five received. Proposed patches were not browser-tested by this reviewer when those documents were written.
- home-isolation: original read-only diagnosis, Windows profile/process measurements and seven pinned official source archives. The original failed home-path oracle remains failed; this evidence does not claim a successful second product run or complete absence of outside writes.

## Preservation and scope

All originals retain exact bytes, line endings, local paths and original hashes. ZIP containers prevent Git text normalization from changing original evidence. The original CI ZIP is copied directly. No credential file, database, runtime profile, full extracted app tree or production executable is included.
The partial journey.observed.log snapshot was excluded. Its old source index remains unchanged and is included for provenance; artifact-index.json records the exclusion explicitly. No currently running run log is staged as a final result.
Original statements about pending verification are historical statements at their recorded capture time. Any later RED/GREEN/full candidate/package outcome requires a separate receipt, not changes to these originals.

## Verification

Run: python verify-stage.py
This checks every direct payload and decoded ZIP member against source bytes/SHA256 in artifact-index.json and verifies ZIP CRCs. copy-integrity.receipt.json records source rechecks, package hashes, file counts and credential-pattern scan scope.
Source alias $CACHE means the local Codex headroom-cache directory. The manifest also preserves each original absolute sourcePath.
The credential scan uses high-confidence token/private-key patterns over selected source files and all original CI ZIP members. A zero match result is limited to those patterns and does not imply a general security audit.
