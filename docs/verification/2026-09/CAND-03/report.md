# CAND-03 收编后全量门禁（执行记录）

结论：**未通过（unit 步骤失败，收编基线未确立）**。2026-09-29 集成阶段在 trainer-wt/int-v1（wt/integration/v1，testedCommit 48e0ba3e154fd03a0587fb22a538857e4bdee956，tree be4e842…61e，cleanBefore=true/cleanAfter=true）实际执行 `npm run verify:baseline`（= tsx scripts/verify-candidate.ts，baseline profile 全序列）。原始 run 目录：`.runs/run-c3c3ea1a-3c0c-4faf-8f4b-5ad2a029189f/`（manifest.json＋artifacts/unit.log、verification.json、docs.log）。

## 实际执行结果

| 步骤 | 结果 | 依据 |
|---|---|---|
| docs | 通过（exit 0） | verification.json checks[0] |
| unit | **失败（exit 1）**：Test Files 4 failed \| 83 passed (87)；Tests 4 failed \| 1141 passed (1145) | artifacts/unit.log |
| types / build / snapshot / m2 / journey | 未执行 | runner 首败即停（verify-candidate.ts:84 顺序执行）；无服务器启动，cleanup 无独立记录 |

unit 四个失败与归因（串行复跑命令：`npx vitest run --config server/vitest.config.ts --allowOnly=false --no-file-parallelism <四个失败文件>`，结果 1 failed \| 3 passed (4)，Tests 1 failed \| 48 passed (49)）：

1. `server/test/api.test.ts`「reports cached catalog…」— 5000ms 超时；串行复跑**通过** → 并行负载抖动（与 CAND-01/02 轮 docs-tooling/api 等夹具类口径一致）。
2. `server/test/data-refresh.test.ts`「e) rejects a torn…」— 5000ms 超时；串行复跑**通过** → 同上。
3. `server/test/drawings.test.ts`「replaces drawings independently…」— 5000ms 超时；串行复跑**通过** → 同上。
4. `server/test/runtime-isolation.test.ts`「cancels an owned child command and preserves its failure log」— **AssertionError：期望 rejects 抛 /abort/i，实得 'cleanup incomplete; see …\cancel.log'**（runtime-isolation.test.ts:172）；串行复跑**仍失败且错误逐字一致** → 既有确定性基线失败（RUN-CANCEL-01 范围，与本卡已知失败登记完全吻合），非负载抖动。

## 异常与阻塞（如实）

- **确定性失败 1 项**：runtime-isolation.test.ts。按本卡执行口径，须 RUN-CANCEL-01 修复，或控制层显式裁决豁免并记录依据；本次未做任何跳过/删除断言处置。
- **TDX_ROOT 前置不可用**：本机未设 TDX_ROOT，`TongDaXin`/`TDX` 默认候选（server/src/tdx/discover.ts:37，ProgramFiles/ProgramData/LOCALAPPDATA 等根）无一路径存在；现存冻结样本仅 sha256 清单、字节本体已清理（SETUP-DRAIN-01 恢复轮 needs_replan 记录）。即使 unit 通过，snapshot（scripts/runtime/snapshot.ts:52 无源抛错）与 m2（scripts/verify-m2.ts:24 无源抛错）也无法通过。须控制层指定现存冻结样本路径，或裁决读用户真实 TDX 制作快照的授权。
- 本次 run 的 PORT/VITE_PORT 指定为 18810/18910（集成工作树专用，未与开发槽位共享）；unit 首败未达服务器启动步骤，TRAINER_RUN_ID/TRAINER_DB/TRAINER_STATIC_DIR/TRAINER_READY_FILE 未实际设置（详见 result.json environment 字段）。

## 后续（按失败处置口径）

非拼凑通过：任一阻塞解除后（RUN-CANCEL-01 修复或豁免裁决＋TDX 样本来源指定），在集成工作树**整门禁重跑** `npm run verify:baseline`，新 run 新记录；本报告不作为任何通过证据引用。docs/unit 两步本次已绿/已知归因，重跑时仍以重跑结果为准。
