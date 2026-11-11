# TEST-BUDGET-04 desktop 套件 30s 超时（修正 CLI flag 未生效）

```json
{
  "id": "TEST-BUDGET-04",
  "title": "desktop 套件 30s 超时（修正 TEST-BUDGET-03 CLI flag 未生效）",
  "owner": "integrator",
  "state": "review",
  "milestone": "ENG",
  "base_commit": "2cc83d9",
  "summary": "main CI 在 2cc83d9 又因 desktop mig-import 用例 5000ms 超时失败；定位到 TEST-BUDGET-03 把 --testTimeout 追加到 npm test 的参数，但嵌套 npm run test:desktop 不会把该 flag 传给 vitest（日志仍是 5000ms）。改为 desktop/vitest.config.ts 显式 testTimeout: 30_000（桌面套件含真实 fs/SQLite/子进程用例），并撤销误导性 CLI flag；断言/用例集合/数据范围不变。",
  "next_action": "改 desktop config、撤销 runner CLI flag、更新文档与 TEST-BUDGET-03 更正；跑 desktop 套件与门禁后发 PR。",
  "allowed_paths": [
    "desktop/vitest.config.ts",
    "scripts/ci/run-tests-with-retry.mjs",
    "docs/engineering/testing.md",
    "docs/engineering/ci.md",
    "docs/work-items/tasks/TEST-BUDGET-04.md",
    "docs/work-items/tasks/TEST-BUDGET-03.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TEST-BUDGET-04/**",
    "docs/verification/2026-11/TEST-BUDGET-03/README.md"
  ],
  "depends_on": ["TEST-BUDGET-03"],
  "docs_impact": {
    "update": [
      "docs/engineering/testing.md",
      "docs/engineering/ci.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md",
      "docs/verification/2026-11/TEST-BUDGET-03/README.md"
    ],
    "reason": "测试预算实现方式修正：从 CLI flag 改为 desktop config；需在测试/CI 文档与旧任务证据中更正，避免继续误导。"
  },
  "verification_refs": ["docs/verification/2026-11/TEST-BUDGET-04/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 根因

- 命令形态：`npm test -- --reporter... --testTimeout=30000` 末尾追加到 `npm run test:desktop ...`，但该 flag 属于外层 npm，不会作为 vitest 参数生效；CI 日志仍报 `Test timed out in 5000ms`。
- 直接证据：main CI run 43063764248 失败用例 `desktop/test/mig-import.test.ts > MIG-MERGE-IDEMPOTENT`，5000ms。

## 口径

- `desktop/vitest.config.ts` 设 `testTimeout: 30_000`；只影响 desktop 套件，server 默认不变。
- 撤销 TEST-BUDGET-03 的 CLI flag，避免假通过。
- 断言/用例集合/数据范围不变。