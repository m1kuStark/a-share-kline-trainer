# UPD-BUSY-HEAL-01 验证记录：zip 更新链陈旧 busy 状态无感自愈

- 分支：task/UPD-BUSY-HEAL-01（基 main=337cbec）
- 日期：2026-10-19
- 矩阵行：UPD-STALE-BUSY-SELFHEAL（root 预登记，worker 零矩阵编辑；test_ids 见 §5，待 root 回填升 covered）
- 需求依据：用户 2026-10-19 批复 2（无感路径）＋冷审 G1（cold-review.md §3）

## 1. 现状核实（冷审论断逐条亲自验证）

| 冷审论断 | 核实结果 |
|---|---|
| api.ts:325-328 apply 守卫持久读 status | 属实（本轮改动前 api.ts:325-328；`activeAttempt \|\| (existing && isBusyUpdateState(existing.state))` → 409 UPDATE_IN_PROGRESS） |
| status.ts:15 BUSY_STATES 五态 | 属实（downloading/verifying/backing_up/applying/restarting） |
| status.ts:92-99 reconcile 仅 restarting→completed | 属实（版本匹配才升级 completed；无任何 busy 复位路径） |
| 全 server/src 无陈旧复位路径 | 属实（writeUpdateStatus 调用方只有 api.ts catch 的 failed 与 updater.ts 自身终态） |
| 状态文件有 updatedAt 可作活跃度信号 | **属实且无需扩展**：`UpdateStatusRecord.updatedAt`（status.ts:26）自 UPD-01 起存在，`writeUpdateStatus` 每次写入都刷新（status.ts:77）；`attemptId` 亦在文件内。**无 pid**（plan.json 只有 serverPid，无更新器进程 pid）——活跃度代理信号＝updatedAt 年龄＋api 层 activeAttempt 内存守卫（覆盖本进程内 downloading/verifying），阈值远大于更新器全部有界阶段（server 退出 20s＋端口排空 10s＋健康核验 40s；服务端下载 900s 总预算且进度事件持续刷新 updatedAt），30 分钟默认值安全 |

## 2. RED（先于实现，亲见正确原因失败）

新建 `server/test/updater-stale-busy.test.ts`（9 用例），运行：

```
npx vitest run --config server/vitest.config.ts server/test/updater-stale-busy.test.ts
→ Tests 7 failed | 2 passed (9)，exit 1
```

失败原因全部正确（缺功能而非环境/语法）：

- apply 自愈用例：`AssertionError: expected 409 to be 202`——陈旧 applying（2 小时旧）apply 得 409，正是 G1 自锁复现；
- status GET 用例：`expected 'downloading' to be 'failed'`——陈旧 busy 原样返回；
- 启动接线用例：状态文件停留在 applying/restarting——启动期无 reconcile；
- 2 条通过用例＝守卫保持（新鲜 busy 409、新鲜 busy 状态原样）——修复前后都必须绿，RED 阶段即绿证明它们锁的是既有守卫语义而非新功能。

陈旧形态构造：直写状态文件 JSON（`writeUpdateStatus` 会把 updatedAt 刷新为现在，无法构造陈旧时间戳）。

## 3. 实现与设计决策

改动三文件（均 ∈ allowed_paths；web/desktop 零改动；矩阵零编辑）：

1. `server/src/update/status.ts`：
   - `DEFAULT_STALE_BUSY_MS = 30*60_000`（proposed_default，冷审建议值）；
   - `resolveStaleBusyMs(env)`：env `TRAINER_UPDATE_STALE_BUSY_MS`（正整数毫秒）覆盖；空/非数字/0/负一律回默认——**fail-closed**：坏 env 不放宽守卫（与 DL-HANG-01 看门狗 env 解析 desktop-updates.ts:174-181 同款先例）；
   - `isStaleBusyUpdatedAt(updatedAt, staleBusyMs)`：`Date.now()-t >= 阈值`；缺字段/不可解析 → false（视为新鲜）——**fail-closed 方向**：年龄不可判定的记录不自动复位（readUpdateStatus 对缺字段的既有归一本来就是 now，方向一致；实际在野文件自 UPD-01 起都带 updatedAt，缺字段仅手工损坏形态可达，保守不碰）；
   - `reconcileUpdateStatus` 增可选第三参 `{ staleBusyMs?, log? }`：**restarting→completed 分支保持在前**（不误伤既有语义，M2 变异证明顺序被测试锁定）；busy 且陈旧 → 复位 failed（人话原因 `staleBusyResetMessage`：含状态名、超时分钟数、可能根因、重试指引）＋`log.error` 落日志。不传 staleBusyMs ＝ 纯既有语义（既有调用方零行为变化）；
   - 复位写沿用 writeUpdateStatus 合并语义：attemptId/fromVersion/targetVersion 保留供诊断。
2. `server/src/update/api.ts`：registerUpdateApi 注册时 `resolveStaleBusyMs(env)` 一次；GET /api/update/status 与 apply 守卫两处 reconcile 调用传 `{ staleBusyMs, log }`。apply 的「同一请求内自动重试放行」＝reconcile 先复位、守卫条件随之不再命中、请求继续走正常受理（202）——用户看到正常流程而非 409；`activeAttempt`（本进程内存态）仍在守卫前位，进程内进行中的下载永不判陈旧。
3. `server/src/index.ts`：`startTrainerServer` 在 registerUpdateApi 后追加启动期 reconcile（同参数；best-effort，失败 catch 落日志不阻断启动）。

## 4. 收据（命令＋字面退出码）

| 命令 | 结果 | 退出码 |
|---|---|---|
| RED：`npx vitest run --config server/vitest.config.ts server/test/updater-stale-busy.test.ts` | 7 failed / 2 passed | 1 |
| GREEN：同上 | 9 passed | 0 |
| updater 全域（check/verify/swap/apply/network/ui/feed-setting/notice/safe-http/stale-busy 10 文件） | 101 passed | 0 |
| `npx tsc -p server/tsconfig.json --noEmit` | 干净（曾抓出 heal 分支 dataDir 未收窄的类型错误——runtime-isolation 3 例失败即 build:server 子进程退出 1 所致，修复后 15/15 绿） | 0 |
| server 全量（带改动，第 1 次） | 1733 passed / 2 failed（rankings 超时、review-profile hook 超时） | 1 |
| server 全量（带改动，第 2 次） | 1733 passed / 2 failed（**换成了** review-profile 另一用例、worktree-tools——非确定性） | 1 |
| 上述 4 个 flake 文件单独复跑（两次） | 37 passed / 44 passed | 0 / 0 |
| server 全量（**干净基线**，stash 对照） | 1725 passed / 1 failed（**又换成了** history-report 超时） | 1 |
| check-binding --strict --include-untracked（updater.yaml） | 与开工基线完全一致：45 行 covered=41 open=4 RED=0（同 4 个 open 行：两 superseded＋UPD-STALE-BUSY-SELFHEAL[planned，待 root 回填]＋UPD-NSIS-INTENT-RETRY[他任务]）；测试索引 2157→2166（+9＝本轮新用例） | 3 |

**全量 flake 判定**：三次全量跑失败用例各不相同（rankings/review-profile+worktree-tools/history-report），全部超时类、全部与 update 域无关模块、干净基线同样 flake、单独复跑全绿——满载（4 workers＋并行 GLM 作业）下的既有环境性超时，非本轮引入（存量失败登记，不放宽门禁）。

另：本 worktree 缺 `server/dist` 曾致 release-launcher 39 例夹具 ENOENT（基线即失败，§4.1 环境前置缺口的实例）——补跑 `npm run build:server` 后 52/52 绿（退出码 0）。

## 5. test_ids（供 root 回填 UPD-STALE-BUSY-SELFHEAL，格式 file::it 用例名全文）

- `server/test/updater-stale-busy.test.ts::apply heals a stale applying status to failed with a human reason logged and retries through in the same request`
- `server/test/updater-stale-busy.test.ts::keeps UPDATE_IN_PROGRESS for a fresh applying status and for a legacy file without updatedAt`
- `server/test/updater-stale-busy.test.ts::default staleness threshold is 30 minutes - 29 minutes stays guarded and 31 minutes heals`
- `server/test/updater-stale-busy.test.ts::env TRAINER_UPDATE_STALE_BUSY_MS overrides the threshold`
- `server/test/updater-stale-busy.test.ts::invalid TRAINER_UPDATE_STALE_BUSY_MS values fall back to the 30 minute default (fail-closed)`
- `server/test/updater-stale-busy.test.ts::status GET heals every stale busy state to failed with a human-readable reason`
- `server/test/updater-stale-busy.test.ts::reconcile keeps restarting to completed intact even when stale and heals stale restarting only when the version does not match`
- `server/test/updater-stale-busy.test.ts::status GET leaves a fresh busy state untouched`
- `server/test/updater-stale-busy.test.ts::boot resets a stale busy status file to failed and keeps restarting to completed when the version matches`

## 6. 变异抽检（P4；还原用反转 Edit patch，未用 git checkout --）

| 变异 | 内容 | 杀手测试 | 结果 |
|---|---|---|---|
| M1 | `isStaleBusyUpdatedAt` 比较方向翻转（`>=`→`<`） | 全部 9 用例死：自愈侧（stale 不再愈）＋守卫侧（fresh 被误愈后 202/状态被改）双向都锁 | 9 failed，exit 1；反转还原后 16/16 绿（含 updater-apply 既有 7 例） |
| M2 | reconcile 分支顺序调换（自愈提到 restarting→completed 之前） | `reconcile keeps restarting to completed intact even when stale...`＋`boot resets a stale busy file...`（两例不误伤语义）精准死，其余 14 例活 | 2 failed，exit 1；反转还原后 16/16 绿＋tsc 0 |

## 7. proposed_default / needs_user_decision

**proposed_default（先实现提验，验收确认后生效）**：

1. 陈旧阈值缺省 30 分钟（`DEFAULT_STALE_BUSY_MS`，冷审建议值；env `TRAINER_UPDATE_STALE_BUSY_MS` 可覆盖，非法值回默认）。
2. 复位人话文案（`staleBusyResetMessage`）：`检测到上次更新流程异常中断（状态停留在X超过 N 分钟无进展），已自动复位为失败；可能是更新器被系统或杀毒软件终止、或电脑断电所致。可直接重新发起更新，历史训练数据不受影响`。
3. 自愈触发面：GET /api/update/status（读即 reconcile，轮询方看到人话失败而非永远"进行中"）＋apply 守卫＋服务启动期三处。status GET 会写文件这一点沿既有 reconcile（restarting→completed）先例。

**needs_user_decision**：无（阈值/文案/触发面均按任务卡与冷审建议以 proposed_default 落地，无行为歧义阻断项）。

**登记不顺手修（YAGNI）**：冷审 G1 关联的 B4/B5（trash 残留启动检测＋UI 提示）与 G2（extract 中断表补行）不在本卡范围，未动。
