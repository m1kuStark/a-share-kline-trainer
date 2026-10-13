# MIG-ONECLICK-01 迁移工具傻瓜式一键重设计

```json
{
  "id": "MIG-ONECLICK-01", "title": "迁移工具一键化：同一文件在 v1.2.7 目录运行产包、移到 v1.3.x 目录再运行自动归位；设置页迁移分栏取消", "owner": "zcode:mig-oneclick",
  "state": "queued", "milestone": "R5",
  "summary": "用户拍板新交互：工具放 v1.2.7 目录运行→自检测所在目录→一键打包（录像+历史）到工具文件夹内；工具文件夹移动/复制到 v1.3.x 安装目录再运行同一文件→自动完成历史并入+录像导入归位。全程点鼠标不思考路径。相应设置页「从 v1.2.7 迁移」分栏取消。",
  "next_action": "矩阵行 MIG-ONECLICK-EXPORT-SIDE/IMPORT-SIDE/SETTINGS-PANEL-REMOVED 已预登记 planned；技术要点：新版本侧用 ELECTRON_RUN_AS_NODE 跑 K线训练器.exe 当 node；录像 IndexedDB 只能应用内写入→boot 自动导入方案。",
  "allowed_paths": ["tools/migrate-v127/", "desktop/src/mig-import.ts", "desktop/src/main.ts", "desktop/test/mig-import.test.ts", "web/src/components/TrainingSettings.vue", "web/src/components/RecordingLibrary.vue", "docs/work-items/tasks/MIG-ONECLICK-01.md", "docs/verification/2026-10/MIG-ONECLICK-01/**"],
  "depends_on": ["MIG-MERGE-01"],
  "docs_impact": { "update": [], "reason": "用户操作路径完全改变：迁移说明文档需按新交互重写。" },
  "verification_refs": [], "integration_ref": null, "acceptance_ref": null
}
```

用户原话（oracle）：「在老版本目录运行一下，自动完成打包，然后把工具文件夹移动或复制到新版本安装目录，再运行一下，自动完成数据的迁移归位，全程只是点一点鼠标，运行同一个文件，完全不需要自己思考路径等问题」「设置界面……单独的老版本数据迁移栏，直接取消掉」（2026-10-13 第五轮任务 3）。
