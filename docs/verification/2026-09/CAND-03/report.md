# CAND-03 收编后全量门禁（记录骨架，未执行）

结论：**未执行**。本卡只做门禁前置准备与记录模板；`npm run verify:baseline` 全量由集成阶段脚本在集成工作树统一执行，执行后回填本目录 result.json 并将本报告补为短报告（结论＋异常如实）。在未实际运行前，本文件不得被引用为任何通过证据；缺失 proof 不能覆盖真实错误。

## 门禁构成（docs/engineering/testing.md:38，scripts/verify-candidate.ts:15-27）

`verify:baseline`（=`tsx scripts/verify-candidate.ts`，baseline profile 无 impact/无候选 proof）依次执行：

| 步骤 | 动作 | 依据 |
|---|---|---|
| docs | docs check | verify-candidate.ts:15 |
| unit | 全量单测（vitest run --config server/vitest.config.ts --allowOnly=false） | verify-candidate.ts:68 |
| types | web 类型 | verify-candidate.ts:23 |
| build | 独立生产构建 | verify-candidate.ts:24,70 |
| snapshot | Journey 快照 | verify-candidate.ts:25 |
| m2 | 样本 M2 闭环（tsx scripts/verify-m2.ts） | verify-candidate.ts:26,73 |
| journey | 全量浏览器 Journey（playwright test --retries=0 --forbid-only） | verify-candidate.ts:27,77 |
| cleanup | 服务器停止与现场清理 | verify-candidate.ts:88-91 |

所有检查通过且提交/工作树指纹运行前后不变才产生候选 proof（testing.md:38；verify-candidate.ts:93 cleanAfter 核验）。

## 前置条件（集成阶段执行前逐项确认）

1. **执行位置**：仅集成工作树 trainer-wt/int-v1（分支 wt/integration/v1，含 CAND-01/CAND-02 收编文档提交），固定端口 18810/18910；开发槽位（18801/18901）不执行本门禁。
2. **工作树干净**：运行前提交全部变更；verify-candidate.ts:42,93 以 testedCommit/tree 核验运行前后 HEAD 与工作树不变。
3. **TDX_ROOT 必须显式设置**：snapshot 步骤经 scripts/runtime/snapshot.ts:52 无可读源直接抛错（"Journey needs a readable TDX sample source; set TDX_ROOT"）；m2 步骤经 scripts/verify-m2.ts:24 无源抛错。**开放项（已知阻塞）**：2026-09-27 暂停前磁盘仅存 tdx-browser-sample 的 sha256 清单、快照字节本体已清理（见 SETUP-DRAIN-01 恢复轮记录，当时 Journey/M2 子门禁因此 needs_replan）；须由控制层指定现存冻结样本路径，或裁决读用户真实 TDX 制作快照的授权。未解决前本门禁的 snapshot/m2/journey 步骤无法通过。
4. **数据隔离**：TRAINER_RUN_ID 与 TRAINER_DB/TRAINER_STATIC_DIR/TRAINER_READY_FILE 显式指向集成工作树内路径（server/src/config.ts:18-37），不共享默认数据目录，不修改个人库、原 dist 与历史报告。
5. **基线事实**：58cc210/5bf4484 已由用户拍板并入基线（2026-09-29），无重跑需要；本门禁对象是收编后的集成基线尖端。

## 已知基线失败与预期处置（如实，不得静默豁免）

- runtime-isolation.test.ts 为基线确定性失败（RUN-CANCEL-01 范围，两轮全量 npm test 复现且串行复跑仍失败）。verify:baseline 的 unit 步骤跑全量单测，会命中该失败：集成阶段须先由 RUN-CANCEL-01 修复，或由控制层显式裁决豁免并记录依据；不得为绿灯静默跳过或删除断言。
- unit/build 等 GitHub 夹具类测试在并行负载下有超时抖动（CAND-01/CAND-02 轮实测：docs-tooling/review-profile/worktree-tools/release-metadata/train-range-preview 等）；失败时先串行复跑确认再归因。

## 失败处置（按派发口径）

任一步骤失败：保留首次失败 stderr/退出码/日志与失败截图，二分定位到具体候选并回退其集成提交；失败与复跑分开记录（一个 run 一个测试对象），复跑写明原因。修复/回退后整门禁重跑，不按步骤拼凑通过。

## 通过后效力

门禁通过即收编基线确立：开发槽位成果方可进入集成队列；开发分支仍并行自 5bf4484 切出。主代理视觉记录与用户验收仍是独立后续条件，本门禁不生成用户 accepted。
