# 刷新与发布边界

本页说明当前实现。整批发布应满足的 `DATA-PUBLISH-ATOMIC` 见 [数据要求](../../../../docs/specs/market-data/requirements.md)，未实现部分不能视为保证。

## 当前调用链

[refresh.ts](../refresh.ts) 创建的协调器在一个实例内保留一个运行任务。第一次刷新返回 202；运行期间重复请求返回 200、相同 `taskId` 和 `joined: true`；无来源返回 409。任务状态在内存中，重启后回到 idle，历史结果仍从数据库读取。

选定来源后，协调器依次执行：读取扫描基线 → `source.scan` → TDX 股票目录刷新 → TDX 权息缓存刷新 → 文件快照与成功日志提交。在线来源当前只走扫描及快照步骤，完整能力边界见 [来源合约](./source-contract.md)。

| 写入对象 | 当前事务范围 | 失败后的实际边界 |
|---|---|---|
| `stocks` | [catalog.ts](../../tdx/catalog.ts) 缓冲成功市场变更后独立提交 | 失败市场保留旧缓存；成功市场可以先更新 |
| `adj_factors`、权息指纹 | [adjustment-cache.ts](../../tdx/adjustment-cache.ts) 独立事务 | 此事务可回滚，已经提交的目录不随之回滚 |
| `data_file_state`、成功日志 | [snapshot.ts](../snapshot.ts) 的 `commitScanResult` 单事务 | 失败不替换原文件快照；不包含前两项写入 |

协调器目前没有检查目录刷新结果中的 `failures`。因此“扫描成功后才提交快照”不能推导出目录、日线与权息整批原子发布。[DATA-01](../../../../docs/work-items/tasks/DATA-01.md) 跟踪这一缺口。

## 超时与并发

默认看门狗为 120 秒，超时追加失败日志并结束任务状态。代码在扫描返回后和提交快照前检查 `timedOut`，但没有取消底层工作，也没有阻止目录、权息函数内部的迟到提交。超时后新任务可以开始，旧异步任务仍可能在运行。

此外，`/api/env`、股票查询、普通行情和训练查询等路径仍会直接触发目录或权息刷新；它们不共享此协调器的任务合并。统一入口见 [DATA-04](../../../../docs/work-items/tasks/DATA-04.md)，超时发布屏障见 [DATA-01](../../../../docs/work-items/tasks/DATA-01.md)。API 文案“已保留原有数据与快照”描述得比当前事务保证更宽，不能据此认定回滚完整。

## 状态、修订与历史

`data_refresh_log` 保留最近 50 次尝试，包含失败。状态响应的 `lastResult/lastCheckedAt` 取最近尝试，`sourceMaxDate/revisionWarning` 取最近成功。

首扫只建基线；后续按路径、size、mtime 和最大日期识别新增、移除及疑似修订。警示不会隔离修订文件，也不会保存日线旧字节或为训练固定版本。当前训练仍读取本地文件，所以“已有训练按旧数据口径继续”的提示不构成可复现保证，读侧版本缺口见 [DATA-03](../../../../docs/work-items/tasks/DATA-03.md)。

`needsUpdate` 仅比较全市场尾日期与“今天之前最近非周末日”；法定节假日可能误报。它不判断个股停牌、区间漏数，也不参与可靠的结算覆盖证明。

## 验证入口

[data-refresh.test.ts](../../../test/data-refresh.test.ts) 覆盖首扫、追加、修订提示、合并任务、扫描失败和看门狗；[catalog-protection.test.ts](../../../test/catalog-protection.test.ts) 覆盖市场失败保留缓存。现有用例不能替代 DATA-01/04 要求的后置失败与迟到提交检查。运行与证据记录见 [验证协议](../../../../docs/engineering/testing.md)。
