# REC-COLLECT-01 录像库收藏与自定义目录

```json
{
  "id": "REC-COLLECT-01",
  "title": "录像库收藏与自定义目录（收藏索引/星标/导出带结构）",
  "owner": "integrator",
  "state": "review",
  "milestone": "REC",
  "base_commit": "81cef4b",
  "summary": "四功能拍板第一序（2026-10-26，docs/proposals/后续四功能-方案细化讨论-20261026.md）：录像物理存储保持平铺，收藏走索引（多对多）；内置「收藏」目录（星标标志、不可删除/重命名）＋用户自建目录；录像条目星标按钮快速加入/移出内置收藏（QQ 邮箱式交互）；删除录像级联清理成员关系；导出 REC-BULK 携带收藏结构、导入按目录名合并。实现层调整（已披露）：索引存 IndexedDB（与录像同域、生命周期同进退），不落 SQLite——录像本体在 IndexedDB 且其迁移受物理限制（v1.2.7 实证），SQLite 侧索引会在数据迁移后悬空。",
  "next_action": "两轮工程验证完成（核心层 0e08424＋UI 层 b719b78），矩阵 8/8 covered、root 复核独立复跑全绿（定向 30/30、journey 新 spec exit 0、check-binding --strict exit 0）。停机提验：待用户验收录像库星标/目录/归档/导出导入全链路（proposed_default 清单见验证记录第二轮节）＋拍板目录级导出是否补做＋推送 547b13a/0e08424/b719b78 三个提交。root 扩卡记录（2026-10-26）：UI 轮新增 allowed_paths＝web/src/recording/bundle.ts＋server/test/recording-bundle.test.ts＋web/src/components/docs/recording.md——拍板「导出（REC-BULK）统一保留收藏结构」要求合并包携带 manifest，bundle.ts 是合并包结构的唯一属主；recording.md 系 docs_impact 已声明但首轮漏列。",
  "allowed_paths": [
    "web/src/recording/collectionTypes.ts",
    "web/src/recording/collections.ts",
    "web/src/recording/collectionStorage.ts",
    "web/src/recording/collectionService.ts",
    "web/src/recording/recordingRepository.ts",
    "web/src/recording/bundle.ts",
    "web/src/components/RecordingLibrary.vue",
    "web/src/recording/recordingFile.ts",
    "server/test/recording-collections.test.ts",
    "server/test/recording-bundle.test.ts",
    "e2e/recording-collections.spec.ts",
    "web/src/components/docs/recording.md",
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

第二轮（UI 层＋接线，2026-10-26）：

- recordingRepository 接线：configureRecordingNamespace 构造 IndexedDbCollectionStorage（`<录像库>.collections`）＋CollectionCatalogService（同 namespace 生命周期）；remove/clear 成功删除后 cleanupRemovedRecordings（失败不阻塞、console.warn 如实记录）；模块级收藏面 API（list/create/rename/remove/toggleStar/assign/unassign/membershipsFor/exportManifest/importManifest，守卫与 library() 同口径）。
- bundle.ts：RecordingBundle 可选 `collections` 字段（版本保持 1）；parseRecordingBundleEnvelope 透出清单（collections 存在即结构校验，坏清单整文件失败）；bulkImportRecordingFiles 返回 outcome.collections 供 UI 合并；双向兼容锁形（旧解析器忽略新字段/新解析器读旧包）。
- RecordingLibrary.vue：目录条（全部/收藏星形置顶/用户目录重命名＋删除＋确认框/新建内联表单校验）、条目星标（aria-pressed 键盘可达）、归档面板（原生 checkbox 多目录勾选、内置收藏与星标等价）、按目录过滤（两步 computeds 保 frontend-contract 字面量契约）、全部导出携带结构（失败如实降级提示）、批量导入后按目录名合并（人话汇总含跳过计数）、级联清理后计数联动。
- 测试：collections 3 接线用例＋bundle 5 collections 用例＋e2e/recording-collections.spec.ts 3 用例（星标往返/目录全生命周期＋导出断言/合并包跨命名空间并集＋级联重载持久）；MUTATION-A（级联移除）与 MUTATION-B（清单丢弃）双击杀；typecheck:web exit 0；全量回归：真实回归 frontend-contract 字面量已修复复绿，其余三轮各 1 个互不相同的负载性超时 flake（隔离复验全绿、零导入关系、已登记）；journey：新 spec 3/3＋邻接 bulk 2/2＋library 2/2；check-binding --strict：covered=7/open=1（COLL-UI-LIBRARY-ENTRY 待 root 升 covered，test_ids 提案 4 条见验证记录）/RED=0/exit 3。
- 文档：web/src/components/docs/recording.md 追加「录像库收藏与自定义目录」用户交互说明。
- 待用户提验：proposed_default 清单（目录条形态/文案/星标色/目录级导出未做）与读屏器等通道——见验证记录「第二轮」节。
- 契约文档缺口（root 已补，2026-10-26）：web/src/recording/recording-file.md「录像合并包」节已同步 collections 可选字段（含向后兼容与导入合并口径），随 root docs 提交入账。
