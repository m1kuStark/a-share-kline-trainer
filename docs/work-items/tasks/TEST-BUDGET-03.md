# TEST-BUDGET-03 CI desktop 测试预算 30s

```json
{
  "id": "TEST-BUDGET-03",
  "title": "CI desktop 测试预算 30s（消除 5s 超时误拦）",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ENG",
  "base_commit": "8362fd9",
  "summary": "PR #26 verify 又因 mig-import.test.ts 的另一个真实 fs+SQLite 用例 5s 默认超时失败一次（rerun 通过），同类预算问题已出现三次；逐用例放宽不可持续。仅对 CI verify 的 desktop 测试命令显式加 --testTimeout=30000（npm test 的参数只追加到 desktop 命令），本地/全局 testTimeout 契约不变；断言、用例集合、数据范围不变。",
  "next_action": "工程验证完成（PR #27 → main 649caf6；PR run 43057334647 三 job success）。**更正（TEST-BUDGET-04）**：--testTimeout CLI 未传给 vitest，已由 desktop config 30s 替代；用户验收未记录。",
  "allowed_paths": [
    "scripts/ci/run-tests-with-retry.mjs",
    "docs/engineering/testing.md",
    "docs/engineering/ci.md",
    "docs/work-items/tasks/TEST-BUDGET-03.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TEST-BUDGET-03/**"
  ],
  "depends_on": ["TEST-BUDGET-02", "CI-STABILITY-01"],
  "docs_impact": {
    "update": [
      "docs/engineering/testing.md",
      "docs/engineering/ci.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "CI 测试预算属于门禁纪律；只影响 CI 的 desktop 命令，需在测试协议与 CI 文档记录，并说明本地契约不变。"
  },
  "verification_refs": ["docs/verification/2026-11/TEST-BUDGET-03/README.md"],
  "integration_ref": "649caf63d0317b80ba72a806ac9d14315cd63dee",
  "acceptance_ref": null
}
```

## 冻结口径

- 只改 CI 执行器默认命令：`--testTimeout=30000` 只作用于 desktop vitest（npm test 的参数追加在第二条命令之后）；server 与本地默认不变。
- 不改断言、用例集合、数据范围、产品代码。
- 真实断言失败仍不重试（CI-STABILITY-01 规则不变）；本任务只是放宽桌面真实文件 I/O 用例的超时。

## 验收

1. `node scripts/ci/run-tests-with-retry.mjs --print-command` 输出包含 `--testTimeout=30000`。
2. 语法检查与 CI-STABILITY-01 自测不受影响。
3. PR 的 docs/verify/pr-policy 全绿；合并后 main CI 绿；后续 PR 不再出现 desktop 5s 超时误拦。