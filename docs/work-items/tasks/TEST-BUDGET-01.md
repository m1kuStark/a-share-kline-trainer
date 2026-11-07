# TEST-BUDGET-01 门禁稳定性：真实 I/O 测试预算收敛

```json
{
  "id": "TEST-BUDGET-01",
  "title": "门禁稳定性：review-profile 真实 git I/O 用例预算 30s→90s",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "4c7f328",
  "summary": "整批最终门禁 npm run verify:baseline 在 Windows/Node24、maxWorkers=2 下运行真实临时 git 仓用例时，review-profile「rejects renames that introduce or remove control paths on either side」实测超过默认 30s testTimeout（隔离复跑可通过）。按仓库既有先例（settings-training 20s、worktree-tools 90s、review-profile hookTimeout 45s）把该文件 testTimeout 放宽到 90s；断言、测试集合与产品语义不变，仅时间预算修正。",
  "next_action": "随整批验收与 push。",
  "allowed_paths": [
    "server/test/review-profile.test.ts",
    "docs/work-items/tasks/TEST-BUDGET-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TEST-BUDGET-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "仅测试时间预算修正（无产品/规格行为变化），记录于任务卡与验证记录。"
  },
  "verification_refs": ["docs/verification/2026-11/TEST-BUDGET-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 判定

- 不改断言、不删测试、不跳过；只把 review-profile 文件 testTimeout 30s→90s（真实 git 临时仓 I/O）。
- 复跑：该文件隔离通过 + npm run verify:baseline 全量通过作为收据。
