# REC-COLLECT-01 第一轮（核心层）验证记录

- 日期：2026-10-26 ｜ 分支：main（81cef4b 之上）｜ 范围：收藏目录核心层（纯逻辑/存储/服务），UI 未动
- 规格：docs/proposals/后续四功能-方案细化讨论-20261026.md 拍板记录节（用户 2026-10-26）
- 矩阵：recording-collections.yaml（8 行：7 covered＋1 planned UI 占位）

## 交付物

| 文件 | 说明 |
|---|---|
| web/src/recording/collectionTypes.ts | 类型层：RecordingCollection/CollectionMembership/CollectionsManifest、FAVORITES 常量、recordingKeyOf |
| web/src/recording/collections.ts | 纯逻辑：命名校验（trim/空白拒/重名拒排除自身）、导出清单构建、导入合并计划（originalSessionId 候选键解析） |
| web/src/recording/collectionStorage.ts | 存储层：IndexedDbCollectionStorage（`${录像库}.collections` 独立库，沿用 importedStorage 事务封装惯例）＋MemoryCollectionStorage 测试替身 |
| web/src/recording/collectionService.ts | 服务层：list/create/rename/remove/assign/unassign/toggleStar/membershipsFor/memberKeys/cleanupRemovedRecordings/exportManifest/importManifest |
| server/test/recording-collections.test.ts | 9 用例，transpile 提取执行真实 web 模块（kdj 先例模式），期望全部独立 oracle 内嵌 |

## 门禁收据

| 项 | 命令 | 结果 |
|---|---|---|
| RED | vitest run server/test/recording-collections.test.ts（实现前） | 9 failed（ENOENT，以正确原因失败） |
| GREEN | 同上（实现后） | 9 passed / 9 |
| 类型检查 | npm run typecheck:web | exit 0 |
| 变异抽检 MUTATION-1 | 删 recordingKeyCandidates 的 local:originalSessionId 候选 → 杀手用例「导入合并…recordingKey 经 originalSessionId 解析导入项」死亡（8 passed/1 failed）；还原后 9/9 复绿 | 击杀 ✓ |
| 绑定检查 | check-binding --strict --include-untracked | 矩阵 8 行：covered=7、open=1（COLL-UI-LIBRARY-ENTRY，UI 轮设计内占位）、RED=0、exit 3（open 占位导致，先例＝PACK-02/05） |
| 全量回归 | vitest run --config server/vitest.config.ts | 143 文件 / 1763 用例全 passed（1754 存量＋9 新增），exit 0，491.73s |

## 测试中修（oracle 修正，非放宽）

1. 重名断言由泛「重名」改锁实现消息「已存在同名目录」（消息更明确，断言更紧）。
2. manifest 成员排序由 localeCompare（中文依环境不定）改码点序确定性排序。

## 实现层调整（已披露）

索引存 IndexedDB 而非 SQLite（拍板原文写 SQLite）：录像本体在 IndexedDB 且迁移受物理限制（v1.2.7 布局实证），SQLite 侧索引会在数据迁移后悬空；同域存储使级联清理与录像生命周期同进退。多对多/内置收藏/星标/导出带结构等行为语义与拍板一致，零偏移。

## 未覆盖（下轮 UI 轮）

- RecordingLibrary 星标按钮/目录树/归档/导出入口（COLL-UI-LIBRARY-ENTRY planned 行）＋ recordingRepository 接线（configureRecordingNamespace 构造 storage/service；remove/clear 后调 cleanupRemovedRecordings）
- e2e recording-collections.spec.ts（含 IndexedDB 封装类首次真浏览器执行）
- 用户验收
