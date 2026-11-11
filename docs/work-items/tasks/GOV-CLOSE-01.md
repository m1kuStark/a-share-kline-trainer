# GOV-CLOSE-01 治理收尾与任务状态对账

```json
{
  "id": "GOV-CLOSE-01",
  "title": "治理收尾与任务状态对账",
  "owner": "integrator",
  "state": "review",
  "milestone": "ENG",
  "base_commit": "8319048",
  "summary": "治理阶段收尾：关闭 ENG-GOV-01 / TEST-BUDGET-02 / CI-STABILITY-01 / ENG-GOV-03 / TEST-BUDGET-03 五张已完成任务卡并同步统一状态；补 TEST-BUDGET-03 的 PR/CI 收据；记录本轮 Dependabot 处置结果并在 dependabot.yml 忽略钉定依赖（klinecharts）与大版本升级，防止重复噪声。产品代码零改动。",
  "next_action": "用户验收本收尾记录后关闭；随后由用户规划 F3/F2 产品开发。",
  "allowed_paths": [
    ".github/dependabot.yml",
    "docs/engineering/ci.md",
    "docs/work-items/tasks/ENG-GOV-01.md",
    "docs/work-items/tasks/TEST-BUDGET-02.md",
    "docs/work-items/tasks/CI-STABILITY-01.md",
    "docs/work-items/tasks/ENG-GOV-03.md",
    "docs/work-items/tasks/TEST-BUDGET-03.md",
    "docs/work-items/tasks/GOV-CLOSE-01.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TEST-BUDGET-03/README.md",
    "docs/verification/2026-11/GOV-CLOSE-01/**"
  ],
  "depends_on": ["TEST-BUDGET-03"],
  "docs_impact": {
    "update": [
      "docs/engineering/ci.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "治理收尾改变任务状态与依赖更新策略；需同步索引、阶段卡、CI 依赖规则与派生状态页，并保留五张任务的完成证据。"
  },
  "verification_refs": ["docs/verification/2026-11/GOV-CLOSE-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 收尾内容

- 关闭五张已完成治理任务（工程验证完成，用户 2026-11-12 指示收尾并转产品开发；分项用户验收未单独记录）。
- TEST-BUDGET-03 收据：PR #27 / run 43057334647；squash 649caf6；后续 main CI 绿。
- Dependabot 处置：#10/#16/#12 已合并；#11（含 klinecharts 钉定依赖）、#13/#14/#15（大版本）、#17（冲突）、#18（被 #12 覆盖）已关闭并留理由；当前开放 PR 为 0。
- dependabot.yml：忽略 klinecharts 全部更新与 typescript/vitest/@vitest/mocker/lucide-vue-next 的 major，防止重复 noise。

## 边界

- 不启动 F3/F2 产品开发；不改产品代码。
- 用户验收记录仍未单独填写；本卡关闭表示治理工作流收口，不替代分项用户验收。