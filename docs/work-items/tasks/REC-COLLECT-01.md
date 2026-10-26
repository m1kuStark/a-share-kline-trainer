# REC-COLLECT-01 录像库收藏与自定义目录

```json
{
  "id": "REC-COLLECT-01",
  "title": "录像库收藏与自定义目录（收藏索引/星标/导出带结构）",
  "owner": "integrator",
  "state": "active",
  "milestone": "REC",
  "base_commit": "81cef4b",
  "summary": "四功能拍板第一序（2026-10-26，docs/proposals/后续四功能-方案细化讨论-20261026.md）：录像物理存储保持平铺，收藏走索引（多对多）；内置「收藏」目录（星标标志、不可删除/重命名）＋用户自建目录；录像条目星标按钮快速加入/移出内置收藏（QQ 邮箱式交互）；删除录像级联清理成员关系；导出 REC-BULK 携带收藏结构、导入按目录名合并。实现层调整（已披露）：索引存 IndexedDB（与录像同域、生命周期同进退），不落 SQLite——录像本体在 IndexedDB 且其迁移受物理限制（v1.2.7 实证），SQLite 侧索引会在数据迁移后悬空。",
  "next_action": "本轮=纯逻辑（collections.ts）/存储（collectionStorage.ts）/服务（collectionService.ts）三层 RED→GREEN＋transpile 提取单测；下轮=RecordingLibrary UI（星标/目录树/拖拽归档/导出）＋e2e；然后按单功能验收闸门停机提验。",
  "allowed_paths": [
    "web/src/recording/collectionTypes.ts",
    "web/src/recording/collections.ts",
    "web/src/recording/collectionStorage.ts",
    "web/src/recording/collectionService.ts",
    "web/src/recording/recordingRepository.ts",
    "web/src/components/RecordingLibrary.vue",
    "web/src/recording/recordingFile.ts",
    "server/test/recording-collections.test.ts",
    "e2e/recording-collections.spec.ts",
    "docs/work-items/tasks/REC-COLLECT-01.md",
    "docs/verification/2026-10/REC-COLLECT-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["web/src/components/docs/recording.md"],
    "reason": "录像库新增收藏目录与星标交互说明"
  },
  "verification_refs": ["docs/verification/2026-10/REC-COLLECT-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 已冻结判断（2026-10-26 用户拍板）

- 存储方案 A：物理目录平铺＋收藏索引多对多；不移动录像文件、不改自动归档命名（DATA-ARCH-01 零影响）。
- 内置目录名「收藏」（不叫"我的最爱"），星标标志与用户自建目录区分；不可删除、不可重命名。
- 条目星标＝快捷加入/移出内置收藏（QQ 邮箱邮件条目星标交互）。
- 导出统一保留收藏结构；导入合并（重名目录合并且不丢成员）。
- 索引落 IndexedDB（实现层调整，非 SQLite）：与录像同库域、迁移同进退、级联清理在删除录像同一页面事务语义内完成。

## 执行计划

1. 矩阵骨架 recording-collections.yaml（root 预登记，worker 不得编辑矩阵）。
2. RED：server/test/recording-collections.test.ts（transpile 提取真实 web 模块；期望全部独立 oracle 内嵌常量）。
3. GREEN：collectionTypes/collections/collectionStorage/collectionService 四文件（IndexedDB 封装沿用 importedStorage 惯例＋Memory 测试替身）。
4. UI 轮：RecordingLibrary 星标/目录树/归档/导出（recordingRepository 接线）＋e2e。
5. 停机提验（单功能验收闸门）。

## 本轮交付

第一轮（核心层，2026-10-26）：

- 四模块：collectionTypes（类型/常量）/collections（命名校验＋导出清单＋导入合并计划纯逻辑）/collectionStorage（IndexedDB 封装＋Memory 替身）/collectionService（编排门面，内置收藏自动补建置顶）。
- 测试：server/test/recording-collections.test.ts 9 用例（transpile 提取真实模块；RED 9 failed ENOENT→GREEN 9/9）；typecheck:web exit 0；MUTATION-1 击杀（originalSessionId 候选键）；check-binding --strict：covered=7/open=1（UI 占位）/RED=0/exit 3（设计内）。
- 实现层调整（披露）：索引存 IndexedDB 非 SQLite（录像本体在 IndexedDB 且迁移受物理限制，SQLite 侧会悬空）；行为语义与拍板零偏移。
- 验证记录：docs/verification/2026-10/REC-COLLECT-01/README.md。
- 未完成：UI（星标/目录树/导出入口）、recordingRepository 接线与级联钩子、e2e、用户验收——下轮。
