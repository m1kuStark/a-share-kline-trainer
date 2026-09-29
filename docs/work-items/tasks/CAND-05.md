# CAND-05

```json
{
  "id": "CAND-05",
  "title": "M4-HISTORY-01 卡索引入 main 并标注待拍板处置",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "对账性收编（docs-only，不合码）：M4-HISTORY-01 任务卡原仅存于分支 task/M4-HISTORY-01，main 状态页未登记；本卡把卡自 tip f707a14 索引入 main 并标注待拍板处置（git merge-base 实测 f707a14 不是基线 5bf4484 祖先，代码未收编），为 S5 拍板提供输入；仅 verification_refs 与 docs_impact.update 两条分支侧路径按主仓门禁调整且分支原文保留在卡内，代码收编由 M4-HISTORY-01 任务在拍板后执行，本任务不合码。",
  "next_action": "卡索引、README 登记与状态页再生成已完成；处置待 S5 拍板，拍板后由 M4-HISTORY-01 任务自行安排收编与完整门禁。",
  "base_commit": "c10367b0765566304c95cf5f60fc4d1422510c50",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/CAND-05.md",
    "docs/work-items/tasks/M4-HISTORY-01.md",
    "docs/work-items/README.md"
  ],
  "depends_on": [
    "CAND-04"
  ],
  "docs_impact": {
    "reason": "索引动作本身即文档影响：新增一张待拍板卡（含悬引说明）、README 一条登记与状态页派生行；不触运行代码。",
    "update": []
  },
  "verification_refs": [],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 对账记录（2026-09-29，git 实测）

- 索引前状态：main（基线 5bf4484）的 docs/status.md 与 docs/work-items/tasks/ 均无 M4-HISTORY-01 卡；卡仅存于分支 task/M4-HISTORY-01（本轮 `git show task/M4-HISTORY-01:docs/work-items/tasks/M4-HISTORY-01.md` 取得后原样落盘）。
- 分支实测：tip f707a14（2026-09-28「docs:status 重生成」，全名 f707a148740f57690ad56b084231e507c64c53c0）；`git merge-base --is-ancestor f707a14 5bf4484` 失败（exit 1），不是基线祖先——代码未收编，本任务不合码。该卡基于 V1 基线 888778c（2026-09-28，已在 main），分支线自基线分叉后含本任务专属提交。
- 待拍板口径：是否/何时收编 task/M4-HISTORY-01 由 S5 拍板；拍板前 main 不取回其代码与 docs/verification/2026-09/M4-HISTORY-01/** 证据；卡面 integration_ref「未上main」表述拍板前为真，状态（review）保持分支原貌。
- 门禁驱动的引用调整（如实）：索引后 docs:status 实测 6 errors——verification_refs 四条与 docs_impact.update 中 specs/training/history.md、user/training-history.md 两条被指文件仅存于分支（scripts/docs/validate.ts:42 要求引用为仓内实存文件）。为不提前取回分支内容，索引卡 JSON 将 verification_refs 暂置空、update 暂移除该两条（其余三条 main 已存在，保留），分支原文逐条保留在 M4-HISTORY-01 卡「索引与拍板状态」节，收编时按分支卡恢复。
- 登记：docs/work-items/README.md 任务清单新增「待拍板收编」条目；status.md 由生成器派生该卡行。

## 边界

- 不改 M4-HISTORY-01 分支及其工作树（trainer-worktrees/M4-HISTORY-01）任何内容；不取回代码、规格、用户文档与 verification 证据；不合码。
