# REC-COLLECT-01 第一轮（核心层）验证记录

- 日期：2026-10-26 ｜ 分支：main（81cef4b 之上）｜ 范围：收藏目录核心层（纯逻辑/存储/服务），UI 未动
- 规格：docs/proposals/后续四功能-方案细化讨论-20261026.md 拍板记录节（用户 2026-10-26）
- 矩阵：recording-collections.yaml（8 行：7 covered＋1 planned UI 占位）

## 第二轮（UI 层＋接线，2026-10-26）

- 范围：RecordingLibrary UI（星标/目录条/归档/过滤/导出携带结构/导入合并）＋recordingRepository 接线（namespace 构造 CollectionService；remove/clear 后级联清理，失败不阻塞）＋bundle.ts 可选 `collections` 字段（版本保持 1，向后兼容 v1 解析器）＋e2e。
- 工作树基线：0e08424 之上（root 扩卡 diff 已含入本轮提交）。

### 门禁收据（命令字面退出码）

| 项 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| RED-collections | npx vitest run --config server/vitest.config.ts server/test/recording-collections.test.ts（实现前） | 1 | 3 failed（级联未接线/清理未调用/模块 API 缺失）｜9 存量 passed |
| RED-bundle | 同命令 server/test/recording-bundle.test.ts（实现前） | 1 | 3 failed（清单未携带/坏清单未拒/导入侧未透出）｜15 存量 passed |
| RED-e2e | TDX_ROOT=… npm run journey -- e2e/recording-collections.spec.ts --retries=0（实现前） | 1 | 3 failed（目录条/星标控件不存在，以功能缺失失败） |
| GREEN-定向 | vitest 两文件（终态） | 0 | 30/30（12＋18） |
| GREEN-typecheck | npm run typecheck:web | 0 | — |
| GREEN-e2e | journey 新 spec | 0 | 3 passed（22.8s，IndexedDbCollectionStorage 首次真实浏览器执行）；契约修复（过滤 computeds 重构）后在最终代码上重跑再次 3 passed（23.1s） |
| MUTATION-A | 移除 remove() 级联调用 | 1 | 杀手×2 死亡：「删除录像后成员级联清理被真实调用…」「级联清理失败不阻塞删除主流程…」 |
| MUTATION-B | buildRecordingBundle 静默丢弃 manifest | 1 | 杀手×2 死亡：「carries collections manifest…」「bulkImportRecordingFiles surfaces bundle collections manifests…」 |
| 变异还原复绿 | vitest 两文件 | 0 | 30/30 |
| 全量回归 run1 | npx vitest run --config server/vitest.config.ts | 1 | 4 failed：frontend-contract（**本卡真实回归**，见下）＋3 个超时 flake |
| 全量回归 run2 | 同上（契约修复后） | 1 | 1 failed：runtime-isolation（时序 flake）｜1770/1771 |
| 全量回归 run3 | 同上 | 1 | 1 failed：random-training-mode 另一用例（5s 超时 flake）｜1770/1771 |
| flake 隔离复验 | vitest run（frontend-contract / 三超时文件 / runtime-isolation 分别单跑） | 0 | 35/35＋77/77＋15/15 |
| JOURNEY-collections | journey e2e/recording-collections.spec.ts | 0 | 3 passed |
| JOURNEY-bulk（邻接） | journey e2e/recording-bulk.spec.ts | 0 | 2 passed（14.6s） |
| JOURNEY-library（邻接） | journey e2e/recording-library.spec.ts | 0 | 2 passed（18.3s） |
| check-binding | check-binding.mjs --repo … --matrix recording-collections.yaml --strict --include-untracked | 3 | covered=7 / open=1（COLL-UI-LIBRARY-ENTRY planned，root 事后升）/ RED=0（设计内，先例＝第一轮） |
| build:server | npm run build:server | 0 | 全量回归前置 |
| desktop grep | grep -rln "recording/bundle\|recordingRepository\|collection(Service\|Storage\|Types)" desktop/src desktop/test | 1（零匹配） | desktop 不 import 本轮改动模块 → 桌面测试不必跑 |

### 全量回归 flakes 登记（三轮失败各不相同、全部隔离复验通过、与本卡 diff 零导入关系）

- run1：random-training-mode（remainingBars 用例，5s 超时）、review-profile（beforeEach 15s 超时）、worktree-tools（beforeEach 30s 超时）。
- run2：runtime-isolation（子进程取消时序，cleanup incomplete 先于 abort）。
- run3：random-training-mode（round-trips shifted 用例，5s 超时；与 run1 不同用例）。
- 归因：143 文件并行下本机负载导致的时序超时；单跑均绿（77/77、15/15）；四个文件不含 web/src/recording 导入（random-training-mode 仅含无关的 `/api/trainings/:id/recording-context` 端点字符串）。第一轮全量 1763 全绿收据在同期同机不同负载下取得，本卡不改任何上述模块。

### 全量回归中发现的**真实回归**（已修复＋回归锁定）

- frontend-contract.test.ts「routes recordings separately…」锁源码字面量 `displayItems.value.filter(item => item.source === 'local'/'imported')`；UI 初版以 visibleItems 间接层破坏该字面量。修复＝两步 computeds（`localItemsAll`/`importedItemsAll` 保契约字面量＋下游 `passesCollectionFilter` 叠加目录过滤），行为不变，frontend-contract 35/35 复绿。该契约测试不在本卡 allowed_paths，未改动其任何断言。

### 实现层调整披露

1. `RecordingBundle.collections` 为**可选**字段且 `RECORDING_BUNDLE_VERSION` 保持 1：解析器只校验必需字段＋「collections 存在即校验结构」，旧版（v1.3.3）解析器对未知字段天然忽略（双向兼容均有测试锁形）。
2. 级联清理失败落点：`libraryTypes.ts`（RecordingRemovalResult 所在）不在 allowed_paths，删除结果面不变；失败走 `console.warn` 诊断日志（不阻塞删除主流程有单测锁定）。
3. 模块级收藏 API 守卫为**同步抛出**（与既有 `library()` 惯例一致），UI 的 withNamespaceRetry 在 try 内调用故两种错误均可重试；接线单测按此口径断言。
4. 合并包契约文档 `web/src/recording/recording-file.md`「录像合并包」节**不在 allowed_paths**，collections 字段未同步进该契约文档——留 root 补记（本轮以 recording.md 用户文档＋测试锁形替代）。

### proposed_default（呈现细节，待用户提验）

- 目录区形态：两列上方的横向「目录条」（chips：全部/收藏(星形置顶)/用户目录(重命名✎＋删除🗑图标按钮)＋新建目录按钮＋内联表单）。
- 文案：星标「加入收藏/移出收藏」；归档「归档到目录/收起归档」；新建「新建目录/保存/取消/目录名称」；导出成功「已导出 N 份录像为合并包文件（含收藏结构）」（清单不可达时如实降级「（未包含收藏结构：原因）」）；导入合并「收藏目录已合并：新建目录 X 个、合并目录 Y 个、恢复成员 Z 条（跳过无法解析成员 N 条）」；删除目录确认「确认删除目录？将删除目录「X」并移除其全部成员关系；录像本身不会被删除」。
- 星标激活色：亮色 #b8860b / 暗色 #f5c518（复用 icon-button 形制，无新依赖）。
- 错误呈现：目录条内联 error-text（role=alert）；归档失败时勾选框按存储真实态回正。
- **目录级导出未实现**（加分项放弃）：登记待用户表态是否需要。
- 归档面板＝条目行内展开（非弹层）；同一时间仅一条录像的归档面板展开。

### 留用户验收项（不进 e2e 的通道）

- 读屏器（NVDA/旁白）对星标 aria-pressed、归档面板 checkbox 组、目录条 chips 的实际播报；键盘 Tab 顺序体感（结构上均为原生 button/checkbox/form，理论可达）。
- 暗色主题下的星标激活色观感；小视口（<900px）目录条换行形态。
- 真机（安装版 Electron）首用收藏目录的 IndexedDB 建立（e2e 已在真实 Chromium 覆盖同路径）。

### test_ids 提案（COLL-UI-LIBRARY-ENTRY 升 covered 候选）

- `e2e/recording-collections.spec.ts::条目星标快速加入/移出内置收藏，收藏视图按成员过滤`
- `e2e/recording-collections.spec.ts::新建目录（空白拒/重名拒）、归档与按目录过滤、重命名与删除目录，全部导出携带收藏结构`
- `e2e/recording-collections.spec.ts::带收藏结构的合并包导入：重名目录并集合并；删除录像成员关系级联消失且重载持久`
- `server/test/recording-collections.test.ts::删除录像后成员级联清理被真实调用：repository.remove 经注入的收藏服务清掉对应成员关系`


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
