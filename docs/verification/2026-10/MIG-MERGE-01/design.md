# MIG-MERGE-01 设计节（v1.2.7 历史迁移：整库换入 → 合并式导入）

任务：根治迁移顺序陷阱——目标库非空被拒（target-not-empty）＋空库整库换入导致 `cache_meta.recording_namespace` 被旧值替换（先导录像孤儿化）。用户拍板原话：「迁移顺序不应影响迁移成功率……新的训练数据不受影响」。

## 1. 根因与策略

现状（GPU3060-E2E-01 wave-c 实证）两处同根因＝**整库换入**：

- `stageHistoryImport` 对非空目标直接拒绝；
- `applyPendingHistoryAtBoot` 空库走「rename 备份原库 → pending 换入」，目标库（含 cache_meta 全部键、settings、数据缓存）被 v1.2.7 副本整体替换。

**策略：统一合并路径**——目标存在（空或非空）一律走「合并导入」，整库换入分支删除（YAGNI）；目标文件不存在时保留 pending rename 就位（无任何 v1.3.0 数据可保，pending 已在暂存期经 `migrateDatabase` 升级为 v1.3.0 schema）。顺序天然无关：先训练后迁移＝合并进非空库；先迁移后训练＝合并进空库后用户再训练；先导录像后迁历史＝ns 不被替换。

## 2. 合并算法（desktop 域，node:sqlite，两连接＋单事务）

暂存机制不变（`stageHistoryImport`：包体检→拷贝→migrateDatabase 升级→pending）。`applyPendingHistoryAtBoot` 改为合并：

1. **读侧**（pending 连接，读写打开——pending 经 WAL 迁移可能有 sidecar，readOnly 打开有恢复风险）：按 `PRAGMA table_info` 取 pending 与目标各表**列交集**；全量读出 trainings（按旧 id 升序）＋6 张子表行＋cache_meta 行，关闭连接。列交集保障：真实 v1.2.7 包暂存后 schema≡v1.3.0（已核对 tag v1.2.7 与 main 的 db.ts：post-v1.2.7 新增列仅 trainings.random_mode / random_time_offset_days / rules_json，全部由 migrateDatabase 在暂存期补齐）；若 pending 由旧版应用暂存、目标已升更新版本，交集仍优雅降级。
2. **备份先行**（事务外）：目标连接 `VACUUM INTO '<target>.pre-migration-<时间戳>.bak'`——一致性快照（含未 checkpoint 的 WAL 内容），沿用既有命名口径；备份失败即中止合并（pending 保留）。既有代码无 .bak 轮换清理（全库 grep 实证仅创建），沿用「只建不清」现状。
3. **合并事务**（目标连接 `BEGIN IMMEDIATE` … `COMMIT`，任一步异常 `ROLLBACK`）：
   - 逐局（trainings 行）：**幂等键 = (code, created_at)**（均 TEXT NOT NULL，业务身份等价 trainingKey）。事务内活查 `SELECT 1 FROM trainings WHERE code=? AND created_at=?`——既匹配既有行（重导跳过）也匹配本事务已插入行（包内同键局去重）；命中→整棵子树跳过（skipped++），未命中→按列交集（剔除 id）INSERT，`Number(lastInsertRowid)` 得新 id，记 old→new 映射。
   - 子表按局写入（training_id 重映射）：orders 先插（filled_trade_id 暂置 NULL，记 orderIdMap）→trades 插入（order_id 经 orderIdMap 重映射，记 tradeIdMap）→回填 `UPDATE orders SET filled_trade_id=?`（经 tradeIdMap）；orders.filled_trade_id↔trades.order_id 循环引用由此两段式闭合。映射缺失的非空引用置 NULL（绝不指向错误的复用 id）。equity_curve / position_events / drawings / trade_notes 仅 training_id 重映射（新局新 id，无 PK 冲突）。
   - **cache_meta 策略**：`recording_namespace` 无条件跳过（目标库该键永不改动——空库有 ns 也保，根治孤儿化，MIG-MERGE-NS-PRESERVE）；其余键 `INSERT ... ON CONFLICT(key) DO NOTHING`（仅目标缺失时带入，proposed_default）。
   - `settings` / `stocks` / `adj_factors` / `data_file_state` / `data_refresh_log` **不并入**（矩阵行只要求训练历史；导入局的规则快照 rules_json 已在暂存期从 v1.2.7 settings 冻结，语义自足）。
4. **收尾**：COMMIT 后删 pending；失败（备份/开库/约束/表缺失）→ROLLBACK、pending 保留、人话错误、可重试（重试幂等）。COMMIT 后删 pending 失败的残留：下次启动合并全部命中幂等键→imported=0→补删，自愈。

## 3. 接口与 UI 变化

- `StageOutcome` ok 分支增加 `skipped`（暂存时对目标只读预查：包内局按幂等键命中目标既有时计数）与 `importing = trainings - skipped`；非空目标不再拒绝（unreadable 仍 fail-closed 拒绝）。
- `ApplyOutcome`：`{ applied:true, imported, skipped } | { applied:false, reason:'none'|'target-unreadable'|'merge-failed', error? }`——`target-not-empty` 与 `swap-failed` reason 随整库换入删除；main.ts 仅日志措辞跟进。
- preload.cts `importHistory` 返回类型、TrainingSettings.vue `DesktopMigrationApi` 接口同步加字段；设置页分栏文案改合并语义（proposed_default 清单见 README）。

## 4. 矩阵行 → 测试映射（7 行）

| 矩阵行 | 测试（desktop/test/mig-import.test.ts） |
| --- | --- |
| MIG-MERGE-NONEMPTY | stage+apply：目标非空（已有新训练）合并导入，新旧并存且既有行/权益零损伤 |
| MIG-MERGE-ID-REMAP | 包局 id 与既有局 id 冲突→新 id＋trades.order_id/orders.filled_trade_id/equity_curve/drawings/trade_notes/position_events 全链重映射，不覆盖不丢弃 |
| MIG-MERGE-IDEMPOTENT | 同包二次导入 imported=0 skipped=N 且子表不重复；stage 预查 skipped 呈现 |
| MIG-MERGE-NS-PRESERVE | 空/非空两路径合并后目标 recording_namespace 原值不变；cache_meta 其他键仅缺失带入 |
| MIG-MERGE-SCHEMA-STAGE | 暂存副本经 migrateDatabase 升级（random_mode 列在），合并入目标后导入局 rules_json 非空可读 |
| MIG-MERGE-ATOMIC-RECOVER | 目标删 trade_notes 表注入合并中断→ROLLBACK 目标回导入前状态、pending 保留、错误人话；修复目标后重试成功 |
| MIG-MERGE-BACKUP | 合并前 `.pre-migration-<时间戳>.bak` 生成且内容＝导入前状态（trainings 计数快照） |

MIG-SQLITE-HISTORY 绑定的旧测试『非空拒绝』按矩阵 binding_note 声明改合并断言（一次改清）。
