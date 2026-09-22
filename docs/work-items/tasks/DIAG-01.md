# DIAG-01 诊断工具收录与退出问题分析

```json
{
  "id": "DIAG-01",
  "title": "诊断工具收录与退出问题分析",
  "owner": "integrator",
  "state": "closed",
  "milestone": "DOC",
  "summary": "保存用户原始诊断ZIP和展开源码，核对后台生命周期，登记后续受控退出任务。",
  "next_action": "工具原件、语法、公开排除与文档检查已完成；若收到朋友实际TXT报告，另建事件任务，不复用本卡。",
  "allowed_paths": ["tools/**", ".gitignore", ".gitattributes", "scripts/README.md", "docs/**"],
  "depends_on": [],
  "docs_impact": {"update": ["tools/diagnostics/README.md", "scripts/README.md", "docs/work-items/README.md", "docs/proposals/first-use-batch.md"], "reason": "仅收录尚未接入运行时的诊断脚本和计划，维护原件与报告隐私边界。"},
  "verification_refs": ["docs/verification/2026-09/LAUNCH-UX-01/report.md", "docs/verification/2026-09/LAUNCH-UX-01/checks.json"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

朋友的具体故障尚未复现：本次提供的包仅含收集脚本和说明，没有运行结果。后续接收TXT/录像时另建事件记录，原始报告放`.data/diagnostics/`，只提交脱敏的根因和回归。此任务关闭只表示工具收录和分析完成，不等于朋友故障或退出功能已修复。
