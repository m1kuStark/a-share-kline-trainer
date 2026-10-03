# REC-LIBRARY-FIX-01 录像库隔离与管理修复

```json
{
  "id": "REC-LIBRARY-FIX-01",
  "title": "录像库隔离与管理修复",
  "owner": "integrator",
  "state": "active",
  "milestone": "REC",
  "summary": "在首配修复候选上补齐按安装实例隔离的录像库、本机/导入分栏、删除保护和退出页深色主题修复。首配卡死修复已获用户确认；本卡新增录像库与主题改动仍待人工复验。",
  "next_action": "合入录像库与退出页改动后，从干净提交重新生成 1.2.7 Windows 验收包；由用户复现首配、查看录像库、导入/删除录像及深色退出流程，记录决定后再发布。",
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
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 当前边界

- 服务端在当前训练数据库的 `cache_meta` 中保存不含本机路径的 `recordingNamespace`；浏览器本机录像和导入录像的 IndexedDB 库名均由该命名空间派生，未完成初始化时拒绝访问。默认便携包各自使用安装目录的 `data`，因此相互隔离；显式共用同一数据库时沿用同一录像库标识。
- 录像库页面分为“本机训练录像”和“导入的分享录像”两栏。导入文件保存为新的 `imported-*` 存储 ID，同时保留原录像 ID 作为来源元数据，避免覆盖本机同名会话。
- 支持单条删除和按来源清理。当前训练或其他标签页正在写入的本机录像受保护，删除结果逐条返回成功或原因；导入录像不占用本机训练写者。
- 当前命名空间中的旧 v1 录像仍按需迁移并保留原条目；旧未隔离公共库保留但不自动归入新安装实例。文件格式仍兼容旧 v1，现行 v2 读取、校验和回放语义不因录像库索引变化而改变。
- 首配受控重启与状态轮询修复已由用户确认；本卡的录像库页面接线、删除交互、深色退出页和新的验收包尚未取得用户验收结论。
