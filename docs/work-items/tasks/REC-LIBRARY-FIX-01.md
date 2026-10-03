# REC-LIBRARY-FIX-01 录像库隔离与管理修复

```json
{
  "id": "REC-LIBRARY-FIX-01",
  "title": "录像库隔离与管理修复",
  "owner": "integrator",
  "state": "closed",
  "milestone": "REC",
  "summary": "在首配修复候选上补齐按安装实例隔离的录像库、本机/导入分栏、删除保护和退出页深色主题修复；用户已完成验收并确认发布。",
  "next_action": "已完成用户验收；随 v1.2.7 最终 Windows 包发布。后续录像格式或来源策略变更另立任务。",
  "base_commit": "b64ad60a5585a156492d94fac18d47e91dea4177",
  "allowed_paths": [
    "server/src/api.ts",
    "server/src/db.ts",
    "server/test/api.test.ts",
    "server/test/recording-library.test.ts",
    "web/src/App.vue",
    "web/src/api.ts",
    "web/src/components/RecordingLibrary.vue",
    "web/src/recording/**",
    "e2e/exit-flow.spec.ts",
    "e2e/recording-library.spec.ts",
    "docs/specs/recording.md",
    "web/src/recording/README.md",
    "web/src/recording/compact-storage.md",
    "docs/work-items/tasks/REC-LIBRARY-FIX-01.md",
    "docs/work-items/README.md",
    "CHANGELOG.md",
    "docs/status.md"
  ],
  "depends_on": [
    "SETUP-01",
    "REC-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/recording.md",
      "web/src/recording/README.md",
      "web/src/recording/compact-storage.md",
      "docs/work-items/README.md",
      "CHANGELOG.md"
    ],
    "reason": "录像库的数据隔离、来源语义和删除边界改变了现行行为说明；退出页主题修复需要在 1.2.7 候选变更中留痕。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.7-user-acceptance/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/verification/2026-10/V1.2.7-user-acceptance/README.md"
}
```

## 当前边界

- 服务端在当前训练数据库的 `cache_meta` 中保存不含本机路径的 `recordingNamespace`；浏览器本机录像和导入录像的 IndexedDB 库名均由该命名空间派生，未完成初始化时拒绝访问。默认便携包各自使用安装目录的 `data`，因此相互隔离；显式共用同一数据库时沿用同一录像库标识。
- 录像库页面分为“本机训练录像”和“导入的分享录像”两栏。导入文件保存为新的 `imported-*` 存储 ID，同时保留原录像 ID 作为来源元数据，避免覆盖本机同名会话。
- 支持单条删除和按来源清理。当前训练或其他标签页正在写入的本机录像受保护，删除结果逐条返回成功或原因；导入录像不占用本机训练写者。
- 当前命名空间中的旧 v1 录像仍按需迁移并保留原条目；旧未隔离公共库保留但不自动归入新安装实例。文件格式仍兼容旧 v1，现行 v2 读取、校验和回放语义不因录像库索引变化而改变。
- 首配受控重启、状态轮询、录像库页面接线、删除交互和深色退出页均已由用户完成验收；最终公开包会在文档提交后重新构建。
