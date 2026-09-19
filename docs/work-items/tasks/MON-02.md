# MON-02 Dashboard status

```json
{
  "id": "MON-02",
  "title": "Task dashboard successor-aware status",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "REC",
  "summary": "Separate superseded failures from current work.",
  "next_action": "Review chain status and visible task summary.",
  "allowed_paths": [
    "scripts/agent-monitor/index.html",
    "scripts/agent-monitor/monitor.py",
    "scripts/agent-monitor/test_monitor.py",
    "scripts/agent-monitor/health.md",
    "docs/work-items/tasks/MON-02.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "scripts/agent-monitor/health.md",
      "docs/work-items/tasks/MON-02.md"
    ],
    "reason": "User reports historical failed candidates look like4current GLM failures."
  },
  "verification_refs": [
    "scripts/agent-monitor/test_monitor.py"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

实现记录（2026-09-20）：monitor.py按followupId在有界图内解析chainTip，superseded仅在有有效后继时为真，resolved仅当链尾phase=reviewed；环/缺失如实返回chainIssue，不改写原始phase/review。看板把被取代轮次折叠进"历史轮次"区（选中历史任务时自动展开），当前列表保留最新失败并可操作；历史徽章按链尾状态区分；model为本机自动门禁的任务与GLM开发分区呈现，计数（运行/待验收/需关注）只统计当前任务。快照新增summary与jobKind字段，5秒本地轮询、遮蔽、只读库边界不变。

验证：`py -3.9 -m unittest discover -s scripts/agent-monitor -p "test_*.py"` 29项通过（原22项含test_followup_link_preserves_historical_review全部保留，新增7项覆盖三跳链running/failed/reviewed链尾、缺失、环、当前计数、jobKind）；另以临时fixture注册表+随机环回端口实例做Playwright检查29项通过（历史折叠/自动展开、跳转链尾、四轮链、明暗主题、无页面错误），fixture与临时脚本已删除，未触碰运行中的看板实例。
