# REL-SMOKE Portable package integrity inspection

```json
{
  "id": "REL-SMOKE",
  "title": "Portable package integrity inspection",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "REL",
  "summary": "Inspect actual extracted package hashes, required files and local user-document links.",
  "next_action": "Integrator runs `node scripts/release/verify.mjs --package <extracted-dir> --report <outside-package>.json` on the real ZIP output and reviews findings before delivery.",
  "allowed_paths": ["scripts/release/verify.mjs", "server/test/release-integrity.test.ts", "docs/work-items/tasks/REL-SMOKE.md"],
  "depends_on": [],
  "docs_impact": {"update": ["docs/work-items/tasks/REL-SMOKE.md"], "reason": "Reusable packaging acceptance inspector; no product behavior changes."},
  "verification_refs": ["server/test/release-integrity.test.ts"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

`scripts/release/verify.mjs` is a read-only CLI: `--package ABS_DIR` required, `--report ABS_FILE_OUTSIDE_PACKAGE` optional JSON (refused if inside the package). Exit 0 clean, 1 validation failures, 2 usage/IO errors; failure lines print package-relative paths.

Checks: release.json identity (`appId=a-share-kline-trainer`, semver version, 40-hex commit, Node-24 major, win32/x64); release-manifest.json schemaVersion 1, createdAt ISO, and identity agreement; manifest path safety (no absolute/traversal/backslash/duplicate), missing/extra files (only the manifest may be unlisted), size and SHA-256; required runtime/build/launcher/doc/licence paths; third-party licence tree beside dependencies.json; production `dependencies` present under node_modules; package.json version/type agreement; private artifacts (`.git`, `.runs`, `.env`, `trainer.config.json`, `*.db`/`*.sqlite` with `-wal`/`-shm`) anywhere in the tree; local Markdown links from root README/CONTRIBUTING/SECURITY and docs/user/**.md resolved per file, rejecting targets that escape the package; symlink/reparse entries rejected without following. This catches root README → docs/user/install.md being misplaced to docs/install.md and an omitted third-party folder.

`server/test/release-integrity.test.ts` (18 tests, vitest) covers a consistent synthetic package, tampered bytes, size mismatch, missing/extra files, private artifacts, unsafe and duplicate manifest paths, malformed/mismatched metadata, node_modules and licence-tree gaps, misplaced and escaping/broken doc links, symlink rejection (skipped where the OS forbids symlink creation), and report-path enforcement. All 18 pass on this branch; the CLI smoke (exit 0/1/2, report JSON) was exercised manually on synthetic packages.

Read-only checks do not replace actual Windows startup, browser acceptance or user acceptance. A passing manifest proves internal consistency only, not publisher authenticity or a digital signature; the real extracted package has not been run by this worker — that run belongs to the integrator. Integrator must rerun `npm run docs:status` at merge: this card's state change makes the generated status stale here, and status.md is outside my allowed paths.
