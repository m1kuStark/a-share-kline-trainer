# MIG-MERGE-01 验证记录（v1.2.7 历史迁移：整库换入 → 合并式导入）

分支 `mig-merge`（worktree `D:\tmp\migmerge01`，base=main@6222fdb）。设计节见本目录 `design.md`，RED 证据见 `red-evidence.txt`。

## 一、根因与修复摘要

GPU3060-E2E-01 wave-c 实证两处缺陷同根因＝**整库换入**：①非空目标被 stageHistoryImport 拒绝（target-not-empty）；②空库换库使目标 `cache_meta.recording_namespace` 被 v1.2.7 旧值替换→先导录像孤儿化。修复＝统一合并路径（用户拍板：迁移顺序不应影响迁移成功率，新训练数据不受影响）：

- `desktop/src/mig-import.ts`：删除整库换入分支；`applyPendingHistoryAtBoot` 改合并（目标不存在＝pending rename 就位；存在＝VACUUM INTO 备份→单事务逐局 INSERT：幂等键 code+created_at 活查跳过、trainings 新 id、orders 先插＋filled_trade_id 回填＋trades.order_id 重映射、子表 training_id 全链重映射、cache_meta 无条件跳过 recording_namespace 其余键仅缺失带入）；失败 ROLLBACK＋pending 保留可重试。stageHistoryImport 不再拒绝非空目标，新增只读预查 skipped/importing。
- `desktop/src/main.ts`：boot 日志改合并措辞（导入/跳过计数）。
- `desktop/src/preload.cts`、`web/src/components/TrainingSettings.vue`：importHistory 返回类型与分栏文案改合并语义。
- server 源码与 tools/migrate-v127（导出侧）零改动（导出格式不变）。

## 二、TDD 过程（RED → GREEN）

- **RED**（`npx vitest run --config desktop/vitest.config.ts mig-import`）：**12 failed | 13 passed**，失败原因全部正确（缺功能而非环境错）——非空暂存被旧实现拒绝、StageOutcome/ApplyOutcome 缺 skipped/importing/imported、旧实现换库把 ns 换成旧值。其中 NS 用例失败原文 `expected 'bbbbbbbb-…' to be 'aaaaaaaa-…'` 即 wave-c 缺陷在测试台的直接复现。全文见 `red-evidence.txt`。
- **GREEN**：实现后 25/25；期间两处迭代（均有收据）：①同秒二次合并 VACUUM INTO 撞名→`uniqueBackupPath` 序号后缀；②ID-REMAP 断言初版误把新 order id=1 当旧值残留（目标子表空表自增重合），改为引用闭合断言并在夹具预热目标 trades/orders 使新旧 id 分离（变异抽检驱动的测试强化，非实现改动）。
- **REFACTOR**：TS 类型收口（`SqlValue` 归一化过 build:desktop:main）、修复一处依赖注入破裂（rename 裸用改 fs.rename）、pending WAL sidecar 防御性清理。

## 三、门禁全表（机器结果＝命令＋退出码）

| 门禁 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| RED | `npx vitest run --config desktop/vitest.config.ts mig-import` | 1（预期） | 12 failed \| 13 passed，失败原因正确 |
| GREEN 定向 | 同上（实现后） | 0 | 25/25 |
| desktop 全量 | `npx vitest run --config desktop/vitest.config.ts` | **0** | 23 文件 232/232（三次全量均 0，终态收据） |
| server 定向 | `npx vitest run --config server/vitest.config.ts migration-tool` | **0** | 2 文件 29/29 |
| build | `npm run build`（typecheck:web＋build:server＋build:web） | **0** | — |
| build:desktop:main | `npm run build:desktop:main` | **0** | — |
| check-binding strict | `check-binding.mjs --repo D:\tmp\migmerge01 --matrix migration-tool-v127.yaml --strict` | **1（预期形态）** | L1 解析正常：13 行、covered=5、open=8、RED=2、索引 1985 用例。open 含本任务 7 行（planned，test_ids 留空待 orchestrator 单写者绑定）＋MIG-CONSOLE-FALLBACK（既有 planned，非本域）。RED=2 恰为矩阵 binding_note 已预告语义变更的两条旧绑定（见下节）。orchestrator 录入新绑定升 covered 后 strict 应转 0。 |

所有退出码直接收取，未隔管道。

## 四、7 矩阵行绑定 test ID 清单（供 orchestrator 录矩阵）

| 矩阵行 | 绑定测试（desktop/test/mig-import.test.ts::） |
| --- | --- |
| MIG-MERGE-NONEMPTY | `MIG-MERGE-NONEMPTY: 目标非空（用户已先训练）时合并导入，新旧训练并存且既有数据零损伤`（辅证：`stageHistoryImport: 目标库非空时不再拒绝（合并语义），预查跳过计数正确且目标原状`、`applyPendingHistoryAtBoot: 暂存后用户又新建训练（先训练后迁移场景）仍合并并存`） |
| MIG-MERGE-ID-REMAP | `MIG-MERGE-ID-REMAP: 导入局 ID 与既有局冲突时分配新 ID 并全链重映射引用，不覆盖不丢弃` |
| MIG-MERGE-IDEMPOTENT | `MIG-MERGE-IDEMPOTENT: 同一迁移包二次导入按业务键跳过全部局且子表不重复` |
| MIG-MERGE-NS-PRESERVE | `MIG-MERGE-NS-PRESERVE: 空/非空目标合并后 recording_namespace 均不变，cache_meta 其他键仅缺失时带入` |
| MIG-MERGE-SCHEMA-STAGE | `MIG-MERGE-SCHEMA-STAGE: 包库 schema 旧于当前，经暂存升级后合并入目标可读（rules_json 冻结、random_mode 列在）`（辅证：`stageHistoryImport: 目标库为空时暂存成功并完成 schema 升级，trainings 可读且 pending 就位`） |
| MIG-MERGE-ATOMIC-RECOVER | `MIG-MERGE-ATOMIC-RECOVER: 合并中断时目标库回导入前状态、pending 保留，修复后重试成功` |
| MIG-MERGE-BACKUP | `MIG-MERGE-BACKUP: 合并前整库备份 .pre-migration-<时间戳>.bak 且内容为导入前状态`（辅证：`applyPendingHistoryAtBoot: 目标存在且为空时合并导入并留备份（不再整库换入）`） |

**MIG-SQLITE-HISTORY 既有绑定同步**（binding_note 已声明，合法变更）：
- 旧 `stageHistoryImport: 目标库已有 trainings 行时拒绝合并且目标原状` → 新 `stageHistoryImport: 目标库非空时不再拒绝（合并语义），预查跳过计数正确且目标原状`
- 旧 `applyPendingHistoryAtBoot: 换库 rename 失败时恢复原状（备份回退、pending 保留）`（swap 路径已删）→ 等价新绑定 `MIG-MERGE-ATOMIC-RECOVER: 合并中断时目标库回导入前状态、pending 保留，修复后重试成功`

## 五、变异抽检（纸面推演，杀手测试逐名）

1. **MIG-MERGE-ID-REMAP 变异＝删掉重映射**（trades.order_id 保留旧值＋不回填 filled_trade_id）：夹具已预热目标 trades/orders 各 2 行→导入行新 id=3/4，与包内旧号 1/2 分离。变异下 `order_id=1≠toBe(3)`、`filled_trade_id=NULL≠toBe(4)`、悬垂闭合计数 `1≠toBe(0)`（order_id=1 指向他人局）——**三断言皆死**。
2. **MIG-MERGE-NS-PRESERVE 变异＝恢复整库换入/无条件覆盖 cache_meta**：目标 ns 应为 `aaaaaaaa-…`，变异下得 `bbbbbbbb-…`——**断言死**。且非纯纸面：RED 阶段在旧实现上的实测失败原文与此逐字一致（red-evidence.txt 第 7 条），等价一次已执行的变异实证。

## 六、proposed_default 清单（呈现/策略默认，待验收确认）

1. 分栏说明文案：「迁移不会修改或删除旧版本里的任何数据；训练历史会合并进当前训练库，与已有的新训练记录并存（同一训练按业务键自动跳过、不重复导入），导入前会自动备份当前训练库。导入完成后需重启本应用生效。」
2. 导入成功通知（无跳过）：「已准备导入 {importing} 条训练记录，重启训练器后生效；合并前会自动备份当前训练库。」
3. 导入成功通知（有跳过）：「已准备合并 {importing} 条训练记录（另有 {skipped} 条已存在，导入时将自动跳过），重启训练器后生效；合并前会自动备份当前训练库。」
4. cache_meta 其他键（如 saved-tdx-choice）仅目标缺失时带入；recording_namespace 无条件保留。
5. settings/stocks/adj_factors/data_file_state/data_refresh_log 不并入（矩阵行仅要求训练历史；导入局规则快照 rules_json 已在暂存期从 v1.2.7 settings 冻结）。
6. 幂等业务键＝(code, created_at)（矩阵行允许的 trainingKey 等价物）。
7. 备份命名 `.pre-migration-<时间戳>.bak`，同秒撞名加 `-N` 序号；沿用现状「只建不清」（既有代码无 .bak 轮换，grep 全库实证）。
8. boot 日志措辞：「v1.2.7 训练历史迁移已在启动时合并应用（导入 X 条、跳过已存在 Y 条；原库已备份保留）」。

## 七、needs_user_decision

无。行为语义已由用户拍板原话定死；全部歧义项均为呈现/策略类，走 proposed_default。

## 八、相邻问题登记（只登记不顺手修）

1. 极小形状 v1.2.7 包（orders 缺 created_phase 等 NOT NULL 列，真实 tag 从未产出过此形状）合并会在 orders 插入时 NOT NULL 失败——fail-closed 人话报错、目标零损伤可重试；如需支持更老包形，应由 migrateDatabase 补列（本任务不做）。
2. stage 预查 skipped 为时点估计：暂存与重启之间用户再训练同键局时，boot 实际跳过数可能与 UI 显示略有出入（boot 事务内活查为准，启动日志有准确值）。
3. check-binding RED=2 属矩阵单写者同步滞后（本报告第四节已给全量新绑定），orchestrator 更新后 strict 应转 0。
4. MIG-CONSOLE-FALLBACK 保持 planned（导出侧兜底，非本任务域）。

## 九、改动文件清单

- `desktop/src/mig-import.ts`（核心：合并路径＋备份＋重映射＋幂等＋ns 保留）
- `desktop/test/mig-import.test.ts`（25 用例：7 行 MIG-MERGE 语义＋旧断言改合并＋真实 v1.2.7 tag 形状夹具）
- `desktop/src/main.ts`（boot 日志/注释，最小）
- `desktop/src/preload.cts`（importHistory 类型加 skipped/importing）
- `web/src/components/TrainingSettings.vue`（接口类型＋分栏/成功文案）
- 本目录验证记录三件（design.md / red-evidence.txt / README.md）
