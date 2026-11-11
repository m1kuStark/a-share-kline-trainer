# TEST-BUDGET-02 迁移真实文件 I/O 测试预算

```json
{
  "id": "TEST-BUDGET-02",
  "title": "迁移真实文件 I/O 测试预算（desktop mig-*）",
  "owner": "integrator",
  "state": "active",
  "milestone": "ENG",
  "base_commit": "7cee87e",
  "summary": "CI verify 在 PR #19/#20 两次因 desktop mig-inline/mig-import 的真实 fs+SQLite 迁移用例 5s 默认超时失败（rerun 均通过）。按 TEST-BUDGET-01 既有口径只放宽这两个用例的 timeout 到 30s，断言/用例集合/产品代码不变；并记录该 flake 作为 required check 的不稳定源。",
  "next_action": "落盘两个 timeout、定向 desktop 套件与 PR 门禁验证；合并后观察 main CI 是否不再被该用例误拦。",
  "allowed_paths": [
    "desktop/test/mig-inline.test.ts",
    "desktop/test/mig-import.test.ts",
    "docs/engineering/testing.md",
    "docs/work-items/tasks/TEST-BUDGET-02.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TEST-BUDGET-02/**"
  ],
  "depends_on": ["TEST-BUDGET-01"],
  "docs_impact": {
    "update": [
      "docs/engineering/testing.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "测试预算调整属于门禁纪律变化，需在测试协议与本阶段/任务索引记录；产品代码零改动。"
  },
  "verification_refs": ["docs/verification/2026-11/TEST-BUDGET-02/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 背景与口径

- 证据：PR #19 verify（desktop `mig-inline` 空目标库用例）与 PR #20 verify（desktop `mig-import` MIG-MERGE-NS-PRESERVE 用例）各失败一次，错误均为 `Test timed out in 5000ms`；rerun 通过，main CI 通过。
- 根因：两用例走真实临时目录、真实 `server/dist/db.js` 迁移、真实 SQLite 与迁移包构建；CI 满载时 5s 默认预算不足。
- 处置：只对两个用例加 `{ timeout: 30_000 }`，保留全部断言、用例数量与数据范围；不全局放宽 desktop testTimeout。
- 不做：不改迁移实现、不改产品代码、不删除/跳过任何断言。

## 验收

1. 定向 `desktop/test/mig-inline.test.ts`、`desktop/test/mig-import.test.ts` 全绿。
2. PR 的 `docs` / `verify` / `pr-policy` 全绿（提交需 SSH 签名）。
3. 合并后 main CI 绿；该两个用例不再以 5s 默认预算误拦。
4. 验证记录写 `docs/verification/2026-11/TEST-BUDGET-02/README.md`，任务卡 `integration_ref` 回填。
