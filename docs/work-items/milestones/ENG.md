# ENG · 工程基础设施

```json
{
  "id": "ENG",
  "title": "工程基础设施",
  "state": "active",
  "summary": "工程规范与操作门禁：Git 分支/提交/PR/发布规范、本地 hooks、CI required checks、main Ruleset、签名与追溯链。目标不是增加流程，而是让既有 task/verify 体系在 GitHub 上被强制并留下可审计记录。",
  "task_ids": ["ENG-GOV-01"],
  "verification_refs": [],
  "acceptance_ref": null,
  "next_action": "完成 ENG-GOV-01 基线并合并；随后按 ENG-GOV-03/04 推进发布追溯与安全审计。"
}
```

工程类任务的共同约束：只补执行层与规范，不移动既有 `docs/specs`、`docs/work-items`、`docs/verification` 目录；任何新门禁先在本任务自身跑通再推广。
