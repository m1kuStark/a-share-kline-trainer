# CI-STABILITY-01 verify 基础设施崩溃重试

```json
{
  "id": "CI-STABILITY-01",
  "title": "verify 基础设施崩溃重试（不重试真实断言失败）",
  "owner": "integrator",
  "state": "active",
  "milestone": "ENG",
  "base_commit": "4b7156e",
  "summary": "verify job 在 GitHub 上偶尔以非 0 退出但没有任何 Vitest 失败摘要（worker/进程级基础设施崩溃，run 43012581422 实证；rerun 即绿）；该 flake 会误拦任意 PR。新增 scripts/ci/run-tests-with-retry.mjs：真实失败摘要（Failed Tests/FAIL）直接失败不重试；仅在“非 0 且无失败摘要”时重试一次并打 warning。断言、用例集合、测试命令与产物不变。",
  "next_action": "落盘 retry runner、CI 接入与自测（fake command 覆盖 成功/真实失败/崩溃重试）；PR 门禁验证后合并，观察 main CI。",
  "allowed_paths": [
    ".github/workflows/check.yml",
    "scripts/ci/run-tests-with-retry.mjs",
    "docs/engineering/ci.md",
    "docs/engineering/testing.md",
    "docs/work-items/tasks/CI-STABILITY-01.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CI-STABILITY-01/**"
  ],
  "depends_on": ["TEST-BUDGET-02"],
  "docs_impact": {
    "update": [
      "docs/engineering/ci.md",
      "docs/engineering/testing.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "CI 重试策略属于门禁纪律变化，需写清“只重试基础设施崩溃、不重试断言失败”的边界并同步索引/状态。"
  },
  "verification_refs": ["docs/verification/2026-11/CI-STABILITY-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径

- 真实断言失败（输出含 `Failed Tests` / `FAIL ` 摘要）**绝不重试**，保持红灯。
- 仅当测试进程非 0 退出且**没有任何失败摘要**时，视为基础设施崩溃（worker 退出/进程被杀/加载期崩溃），重试一次并输出 GitHub warning。
- 重试不修改测试命令、断言、用例集合、数据范围；第二次仍失败则红灯。
- 不重试 `npm ci`、`build`、`docs` 等其他步骤；只作用于 verify 的测试执行。

## 验收

1. 自测：成功命令 exit 0；含 `Failed Tests` 的真实失败 exit 1 且不重试；无摘要的崩溃重试一次。
2. PR 的 docs/verify/pr-policy 全绿；verify 使用新 runner。
3. 合并后 main CI 绿；若首次崩溃，日志出现 warning 与第二次通过记录。
4. 验证记录写 `docs/verification/2026-11/CI-STABILITY-01/README.md`，任务卡 integration_ref 回填。
