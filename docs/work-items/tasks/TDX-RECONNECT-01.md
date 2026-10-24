# TDX-RECONNECT-01 设置页 TDX 路径保存后受控重启立即生效

```json
{
  "id": "TDX-RECONNECT-01",
  "title": "统一设置分栏与首配向导的 TDX 路径生效语义（受控重启+自动恢复，消灭唐突的手动重启提示）",
  "owner": "zcode:tdx-reconnect",
  "state": "planned",
  "milestone": "R5",
  "summary": "用户验收 v1.3.3 报告：首装后经右上角设置选择通达信路径，保存后提示需重启应用才能连接（v1.2.7 顶栏「连接通达信」向导为受控重启+轮询自动恢复，无此断裂）。根因：v1.3.0 M5-01 新增设置页「数据目录（通达信）」分栏走 PUT /api/settings/tdx-path 仅保存（restartRequired:true 提示手动重启），与 SETUP apply 受控重启链（/api/setup/apply + restart-status 轮询）语义割裂。",
  "next_action": "RED→修复：分栏保存后自动走 SETUP apply 受控重启链（或等价机制），体验对齐向导；矩阵行 TDX-SETTINGS-APPLY-RESTART 已预登记 planned。",
  "allowed_paths": [
    "web/src/components/TrainingSettings.vue",
    "web/src/appSettings.ts",
    "web/src/api.ts",
    "web/src/App.vue",
    "server/src/settings/tdx-path.ts",
    "server/src/setup/",
    "server/test/settings-tdx-path.test.ts",
    "server/test/m5-settings-frontend.test.ts",
    "docs/work-items/tasks/TDX-RECONNECT-01.md",
    "docs/verification/2026-10/TDX-RECONNECT-01/**"
  ],
  "depends_on": [
    "M5-01"
  ],
  "docs_impact": {
    "update": [],
    "reason": "用户可见行为变化（保存后自动生效）需在验证记录与设置页文案中如实呈现。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

用户原话（oracle）：「第一次安装 v1.3.3 之后，我已经通过右上角选择了通达信路径，但是不能直接连接……为什么这里唐突地多了一个重启？」（2026-10-13 第五轮任务 1）。

## 2026-10-20 元数据修复

旧状态 `queued` 规范为 `planned`；仅对齐既有工作流枚举，不新增实现或用户验收结论。
