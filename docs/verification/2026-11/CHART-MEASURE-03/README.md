# CHART-MEASURE-03 验证记录（2026-11-09）

任务：修复用户 v1.3.5 验收反馈——周/月K 区间统计数值错误与 Select Box 边界位置；见 [任务卡](../../../work-items/tasks/CHART-MEASURE-03.md)。

## 根因

- 区间测量/区间统计此前用日线加载序列 loadedData 的索引套到周/月K 显示序列，导致周/月K 的起止日期、K 线数、高低/量额错位；
- Select Box 边界放在 bar 中心 ±半个 barSpace，即相邻 K 线间隙；用户要求与十字线一致放在 K 线中心；
- 镜像态旧统计用日线真实序列，未按当前周期镜像语义还原 high/low。

## 修复

- 新增 `statisticsBarsSource()`：唯一统计源＝`chart.getDataList()`（当前周期、库内显示事实）；区间测量与右键区间统计共用。
- 镜像：逐项 `unmirrorPrice` 回真实价，high/low 按 mirrorBar 语义换位还原；量额不受影响。
- `measurementBox`：左右边界＝起止 K 线中心，不再 ±半根；拖动边界仍实时更新。
- 日期映射：优先 `barDateByTimestamp`，缺失时按 timezone 格式化 timestamp（周/月聚合后仍稳定）。

## 定向门禁

| 检查 | 结果 |
|---|---|
| `npm run journey -- e2e/chart-analysis.spec.ts --retries=0` | **0：9/9 通过**（1.2m；含新增「周K/月K 区间统计跟随当前周期 K 线，Select Box 边界落在 K 线中心」） |
| 日K 回归（同 spec 前两例） | 通过（两次点击/拖动边界/所有权/取消/镜像真实价/回放/随机遮蔽） |
| `npm run typecheck:web` | 0 |
| 全量 journey 并行（2 shards） | 本文件改动所在 `chart-analysis` 在 shard 中通过；其余失败为与本次改动无关的环境 flaky（见 REL-136） |
| 镜像回归 | 通过（区间 high/low 反镜像还原） |

## 全量门禁

按 TEST-SPEED-01 的分层门禁：发布轮以并行 journey（全部 spec）＋全量单测＋构建＋M2 记录，见 [REL-136](../REL-136/README.md)/[TEST-SPEED-01](../TEST-SPEED-01/README.md)。
