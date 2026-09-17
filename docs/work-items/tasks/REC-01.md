# REC-01 默认操作录制与分享复盘首批

```json
{
  "id": "REC-01",
  "title": "默认操作录制与分享复盘首批",
  "owner": "unassigned",
  "state": "planned",
  "milestone": "REC",
  "summary": "默认开启、首页及训练内开关、状态提示和分享方向已确认；实现待启动。",
  "next_action": "细化schema与暂停恢复语义，先实现录制导出和只读复盘，再接确定性及真实UI回归。",
  "allowed_paths": [
    "web/src/**",
    "server/src/**",
    "server/test/**",
    "e2e/**",
    "docs/specs/recording.md",
    "docs/proposals/session-recorder/**",
    "docs/work-items/tasks/REC-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/recording.md"
    ],
    "reason": "实现时同步覆盖边界、格式版本和验收要求。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```
