# 阶段返修交付：工程验收通过，待用户验收

2026-09-20。精确候选 `ACCEPT-01-f99732db7b28` 的产品提交C为 `c0ad1112f9f6d98df9acd3c6d5c6446ac54480b4`，tree为 `7886d9afeb69fb68521c82070de9137ecf3b5df6`。已由task promote进入本地main，并部署到原7529地址。后续证据文档提交E继承C的运行结果，不声称重新测试过E。未推送远端。

[用户验收入口与范围](acceptance.md)。本报告不是用户验收记录；ACCEPT-01、REC、M3保持review，M4/M5等待明确用户决定。

## 精确门禁

| 检查 | 结果 |
|---|---|
| docs、impact、状态结构 | 通过 |
| 单测 | 56文件，681/681通过 |
| Vue类型、服务端及生产前端构建 | 通过 |
| 冻结样本M2 | 24/24通过 |
| Edge完整Journey，单worker、零重试 | 72/72通过，14.2分钟 |
| 提交和工作树 | 测前测后干净，正式proof与提交/tree一致 |
| 看板独立Python测试 | 29/29通过；主代理核验实际历史折叠与链尾跳转 |

两年样本483次真实推进、974事件、975检查点全部可还原。压缩文件632067字节（约617KiB），JSON3964430字节；导出391ms、导入193ms、推进P95为86ms，页面异常0。数据为本机单次冻结样本观测，不代表任意股票及操作量的性能保证。

本轮未更改行情解析/前复权公式，新增画线价格基准读取与投影。M1旧原生导出过期问题没有标为通过，样本M2/Journey不代表全市场数据核验。历史版本保护、训练费用/权息规则冻结等既有任务仍单独跟踪。

## 主代理视觉与实际操作

精确C的独立生产预览使用本机通达信行情、独立数据库。在1071×728深色、1280×800浅色下检查入口、顶部录制区、快捷键、账户空间和结束确认。真实操作吉华集团603980：2025-06-16画价位线4.83，推进除息日后为4.760000001192092，差值0.0699999988；刷新、周K买入、结算默认保存、导出gzip、历史回放、空格和中括号/缩放均正常。主图顶部93px，横向溢出和pageerror均为0。

根代理已逐张查看[训练](live-dark.png)、[保存确认](confirm-light.png)、[回放](replay-light.png)，另有[两年回放](recording-two-year-replay.png)。主代理签署的[视觉记录](manual-ui-review.json)与候选提交一致，产品构建不含Journey只读测试钩子。

## 原失败与修复依据

四轮失败均保留，未复用失败proof或跳过用例：

1. 首轮678/680单测通过，两条旧源码形状断言与单根缩放修复冲突；换为执行真实缩放函数的行为检查，保留轴适配顺序与上报数量约束。
2. 第二轮真实Git文档测试超过默认5秒，同提交单独30/30通过；仅此集成测试文件采用20秒预算，产品超时与断言未降低。
3. 第三轮680单测、M2及两年录制通过；旧Act5在录制准备时发B键，轨迹证明inert且没有交易请求。仅正常交易用例等待明确就绪，各动作完成后再继续，专门的准备期保护用例不变。
4. 第四轮679/680通过，隔离服务启动健康请求短暂fetch失败；用真实子进程加首个连接重置故障复现，改为在原启动期限内重试明确的临时连接错误。进程身份、错误响应和超时边界保持严格，16项运行器回归通过。

看板现在区分GLM开发与本机门禁，后继链折叠历史失败且保留原始结论；只有链尾复核通过才显示已解决。Mimosa既有告警经用户明确授权由集成人审查，真实本机URL校验缺口已修，未关闭全局安全检查。官方CLI调研及图片/事件流实测见[资料](../../../engineering/zcode-official-capabilities.md)与[夜间记录](../ACCEPT-01-night/report.md)。

## 部署、数据与证据

原7529实例保留同一数据库路径及浏览器origin，未清理浏览器存储。SQLite备份完整性通过，旧web/server及manifest保留以供回滚。更新前后3场训练、7笔交易、1份画线记录、1条权息、379条权益曲线逐表SHA256完全一致；新生产构建与已验收预览逐文件哈希一致。

证据：[验证结果](verification.json)、[单测原日志](unit.log)、[Journey原日志](journey.log)、[浏览器结构报告](browser-results.json)、[M2](M2-e2e-report.md)、[两年指标](recording-two-year-metrics.json)、[部署记录](deployment.json)、[数据与构建复核](deployment-verification.json)、[完整产物归档](archive.json)。清理后原candidate绝对路径可能不再存在，文件已收录或归档，未改写原证据中的路径。

Cleanup: six merged task branches/worktree registrations and the successful candidate are removed after checked ZIP archiving. One empty ACCEPT-01 directory remains locked byWindows; failed candidates and userpreview/rollback remain. [Cleanup record](cleanup.json), [task archives](task-archives.json).
