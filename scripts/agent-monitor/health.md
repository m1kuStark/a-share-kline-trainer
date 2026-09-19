# 运行状态的观察边界

界面将最近工具操作与模型生命周期信号分开。[telemetry.py](telemetry.py)按已登记session和本次开始时间只读Zcode近期JSONL，保留请求开始/响应结束时间及finishReason等白名单字段；不显示正文、请求头或思考全文。日志增量读取、有大小边界，残缺行等下一次补齐，截断后不沿用旧的请求状态。

Zcode未提供逐token实时进度，request_started只能标“已发出、尚无完成信号”，不能据此宣称持续生成或健康。TCP连接和进程存活也不能证明任务推进；需要结合工具结果和最终模型响应。

finishReason=length单独提示输出预算耗尽，CLI可能自动续接；不能用进程存活掩盖反复空转。十分钟无工具提示按时间刷新，不只在新JSON到来时计算。再次多轮耗尽且无文件/测试进展时由主代理诊断、拆任务，不仅依超时杀任务，也不自行降低max思考档。

旧needs_changes结果保留；登记followupId后链接后续修复批次及其独立状态。后续通过不自动改写旧review。修复ID缺失时提示登记不可读，不猜测已恢复。

源码/桌面入口见[README](README.md)。本机首次诊断证据见[REC-01记录](../../docs/verification/2026-09/REC-01-monitor-health/report.md)。
