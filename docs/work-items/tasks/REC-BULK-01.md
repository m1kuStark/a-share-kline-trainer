# REC-BULK-01 录像库批量导出与批量导入

```json
{
  "id": "REC-BULK-01", "title": "录像库全部导出为合并包文件，并支持合并包/多选/单条兼容的批量导入（版本迁移与备份恢复）", "owner": "zcode:rec-bulk-export",
  "state": "review", "milestone": "REC",
  "summary": "已实现：新增 web/src/recording/bundle.ts（合并包格式契约 buildRecordingBundle/parseRecordingBundle/exportRecordingBundleFile/isRecordingBundleFile + 批量导入编排 bulkImportRecordingFiles）；RecordingLibrary.vue 增加「全部导出」与多选导入（单条非合并包保持既有导入路径零回归，导入结果 成功/跳过/失败 计数报告，批量导入新条目即时可见）。合并包=明文 JSON {format: trainer-recordings-bundle, version: 1, exportedAt, items:[单条导出载荷]}，契约全文见 web/src/recording/recording-file.md「录像合并包」节。去重口径：trainingKey/sessionId/originalSessionId 相同跳过不覆盖；trainingKey 为 null 不参与去重。RED（模块缺失 exit 1）→GREEN 13 单测＋e2e recording-bulk 2/2；定向回归 recording-migration/recording-library e2e 与 83 个 recording 单测、npm run build 全过；recording.spec「默认录制…离线回放」1 例在干净基线 3e13f98 同样失败（git stash 实证，与本任务无关，登记相邻问题）。",
  "next_action": "待集成侧合码与用户验收；App.vue 不在本卡 allowed_paths，批量导入后父页面列表刷新与直接回放需要集成侧补一条约 3 行的通道（详见待拍板项）。",
  "allowed_paths": ["web/src/recording/**", "web/src/components/RecordingLibrary.vue", "server/test/recording-*.test.ts", "e2e/recording-bulk.spec.ts", "e2e/README.md", "docs/work-items/tasks/REC-BULK-01.md", "docs/verification/2026-10/REC-BULK-01/**", "docs/status.md"],
  "depends_on": [],
  "docs_impact": { "update": ["web/src/recording/recording-file.md（新增「录像合并包」契约节）", "e2e/README.md（recording-bulk 行）"], "reason": "合并包格式是版本迁移工具链的对外契约，按任务要求写入格式文档。" },
  "verification_refs": ["docs/verification/2026-10/REC-BULK-01/README.md"], "integration_ref": null, "acceptance_ref": null
}
```

用户需求（oracle 来源，2026-10-09 拍板）："可以补上录像文件批量导出、导入功能"——版本迁移工具链的关键依赖件（v1.2.7 老用户升级 v1.3.0 需要把全部录像导出成文件、再在新版本批量导入），同时服务日常备份/恢复。

实现落点：

- `web/src/recording/bundle.ts`：合并包组装/解析/识别＋批量导入编排（逐条容错、去重跳过、计数报告）。
- `web/src/components/RecordingLibrary.vue`：工具栏「全部导出」（下载 `训练录像库-<时间戳>.trainer-recordings.json`）；导入 input 加 `multiple`；单条非合并包文件维持 emit 单条路径（既有行为零回归）；批量结果 notice（role=status/alert）；批量导入的新条目以本地补充行即时呈现，父列表刷新后自然收编。
- 测试：`server/test/recording-bundle.test.ts`（13 用例）、`e2e/recording-bulk.spec.ts`（迁移主路径＋容错/去重）。
