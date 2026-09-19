# ACCEPT-E2E worker handoff

[当前合同](../../../engineering/stage-feedback-20260919.md)。

## 2026-09-20 夜间适配（base=1c8cc6e）

### 改动

1. **结算确认弹窗**（合同行为3）：`training-flow.ts` 新增共享 `settleThroughConfirmation(page, after: 'home'|'chart')`——断言 `role=dialog 结束训练` 弹窗、「保留到本机训练历史」默认勾选、真实点击「确认结算」一次后出现「训练结算」结果面板再点出口；另加 `expectSettledResultsDialog` 供自然到期路径（不经提前结算入口）。接线：journey Act5、m3-feedback 结算后续看、m3-tools D31 已结算、recording 用例2/4。放弃路径本批 owned 用例均走 API 清理（e2e 纪律：不依赖 UI confirm 清理），未新增 UI 放弃断言；丢弃语义测试归 root。
2. **导出仅 gzip**（合同行为2）：recording 用例1 删除「更多录制导出方式 / 导出可读 JSON」断言，改为 `toHaveCount(0)` ×2 + gzip magic(1f 8b) + schemaVersion 2 + 交易一致性（CompactReader 解码末检查点 trades=['buy']）；`training.create` 样板事件断言改为不存在，首笔交易仍恰好 started+finished accepted，初始检查点 afterSeq=0 且训练元数据引用/解码快照存在。用例2：旧 `checkpoints.some(1M)` 改为全部带图检查点 1D（canonical 1D 采集）+ 无噪音事件断言（create/load/timeframe/viewport/tool/save/theme 全部不入流），周期切换仍按 UI 标签单独断言。migration 用例1 保留旧 JSON（v1）导入兼容与损坏 gzip 报错；导航钩子从已不存在的「本机最近录制（1）/0 条事件」改为现行「查看训练录像 → 训练录像库 → recording-history-item」。
3. **REC-03 按日回放**：旧「最后一步」选择器改为「跳到最后一天」，并在 recording 用例2/recording-long 断言 `.replay-day` 文本 `第 n / N 日`；只读断言焦点保持 b/Delete/鼠标右键不可改画线、离线零写请求。旧文件（无日线）只如实降级、不虚构日线的预期以注释记录在 migration 夹具处，待 REC-03 合入后可加断言。
4. **两年用例**（recording-long）：保留 >450 次真实推进（历史值483）、刷新同 session、账户/交易/画线数据等价、全部检查点无未来、性能与报告写出；自然到期后断言「训练结算」面板与默认保留勾选；导出按钮/命名的既有 gzip magic+schemaVersion 检查不变。

### 命令与结果（本 worktree，旧回放器）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit --strict … e2e/<owned+.ts>` | 仅2个 base 既有错误（journey:257 canvas 迭代、recording:174 gaps.at(-1)，stash 对比确认非本次引入），新代码零类型错误 |
| `npm run journey -- --list` | 70 tests in 13 files，发现正常 |
| `npm run journey -- e2e/recording.spec.ts e2e/recording-migration.spec.ts e2e/journey.spec.ts e2e/m3-feedback.spec.ts e2e/m3-tools.spec.ts -g "录制\|Act5\|自动保存\|已结算训练继续查看" --retries=0` | 6 passed / 1 failed (1.8m)。failed=recording.spec:55 于 `跳到最后一天` 等待超时——**预期**（旧回放器只有「最后一步」，REC-03 未合入）；该用例此前的生产侧断言（交易/拒单/画线事件、全1D检查点、无噪音、结算弹窗、离线导入）全部通过。run-24ff1e41 |
| `npm run journey -- e2e/recording.spec.ts e2e/recording-migration.spec.ts -g "首页关闭\|复制标签页" --retries=0` | 2 passed (26.6s)：暂停恢复+结算弹窗返回首页、双标签页独立录制 gzip 导出。 |
| `npm run journey -- e2e/recording-long.spec.ts --retries=0` | 12.1m，仅败于预期 `跳到最后一天` 等待超时（REC-03 未合入）。此前断言全部通过：自然到期结算面板+默认保留勾选；离线导入打开回放。从导出证据核验：483 次真实推进、gaps=0（中途刷新同 session）、975 检查点、交易=买成交/卖拒单/卖成交、初末导出同 sessionId。metrics json 位于回放断言之后，本worktree不落盘（预期）。run-6736b76c |

未跑全套件（遵守 14 分钟上限约束）；未宣称最终全绿。

提交状态：改动已全部暂存（9 files, +124/−43，HEAD=1c8cc6e 未产生新提交）。Mimosa 基线门禁拦截 commit：报的是 base 既有 `scripts/verify-candidate.ts` / `scripts/runtime.ts` 的 spawn 入口（journey 运行器设计如此，非本批引入，本批未触碰 scripts/）；按指示已暂存并报告一次，未禁用门禁、未重复全量扫描，由集成人处置后提交。

### 待集成（pending REC-03）

- 「跳到最后一天 / .replay-day / 回到第一天 / 上一日 / 下一日 / 每日播放时长 / 回放日期」选择器在本 worktree 均预期失败，REC-03 合入后由集成人复跑 `recording.spec / recording-long / migration` 及 root owned 两个文件确认转绿（本批实测失败点恰好只有该选择器）。
- 旧文件日回放如实降级（仅周/月或明确缺失）行为断言待新回放器落地后补充。
- `docs/status.md` 生成区已随本卡状态 mechanical 刷新；集成引用/验证记录由集成人回填。
