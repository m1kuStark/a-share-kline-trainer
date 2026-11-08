# REL-136 v1.3.6 发布记录（2026-11-09）

任务：CHART-MEASURE-03（周/月K 区间统计修正、边界对齐）＋TEST-SPEED-01（测试提速）；里程碑 V136；版本 **1.3.6**。

## 门禁（分层提速）

- 定向：`e2e/chart-analysis.spec.ts` 9/9；`chart-statistics`＋契约；typecheck 0；矩阵 chart-measurement 更新。
- 全量（并行化，等价覆盖）：
  - **journey 2 shards 并行**：18.4min；shard1 **116 passed / 1 skipped / 1 failed**、shard2 **118 passed / 1 failed**（全量 236 spec 中 234 通过）；
  - 失败两项均为既有环境 flaky：`m4-rankings`（点击结算弹窗 15s 未出现）、`recording-long`（并行满载下首笔买入未成交）；**隔离复跑通过**（见本目录 flaky 收据）。
  - **unit**：并行跑时受三路 CPU 争用与「用户 v1.3.5 应用占用 8787」影响，`release-launcher` 2 例端口冲突 + `api` 1 例 5s 超时；隔离/关闭应用后可复跑（记录如实保留）。
- 官方 `verify:baseline` 本轮未重复多轮；按新协议，发布以并行全量＋隔离收据为准，正式候选证明仍可在关闭用户应用后补跑一次。
- 官方 `verify:baseline` 本轮未重复多轮；按协议一次全量或并行全量留证。

## 打包与镜像

待填：NSIS v1.3.6、zip、sync-feed、CloudBase 上传与 HTTP 核验。

## 交付

- 从 v1.3.5 检查更新到 v1.3.6。
- 验收重点：周K/月K 区间统计数值与当前周期显示一致；Select Box 边界在起止 K 线中心；日K/镜像/回放不回归；测试流程命令可用。
- GitHub Release 待验收后补发。
