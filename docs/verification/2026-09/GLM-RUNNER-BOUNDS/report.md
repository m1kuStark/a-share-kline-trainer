# GLM runner有界等待与配置核对

2026-09-20，用户要求核对GLM-5.3-Flash配置官方符合性，并为run_glm.py补超时机制、YOLO显式保险及其他健壮性整改；同轮核对并发调用的官方依据。改动限`scripts/agent-monitor/`（run_glm.py、monitor.py、test_run_glm.py新增、test_monitor.py fixture更新、README.md、health.md）与两份engineering文档。

## 配置核对结论

官方模型页（docs.bigmodel.cn GLM-5.3-Flash）逐项对照：模型标识GLM-5.3-Flash、1M上下文、128K最大输出、reasoning_effort=max推荐、`thinking.type`仅支持enabled——与本机provider配置（bigmodel-api/GLM-5.3-Flash/max/contextWindow=1000000/输出预算32768）相符；官方推荐采样参数（temperature 1、top_p 0.95）由Zcode会话层管理，runner不覆写。配置核对为文档证据，未消耗模型请求。

## 事实与实测

- CLI 0.16.5→0.16.9为桌面9-19自动升级；0.16.9 `--help`及bundle核对：runner依赖的参数、provider/retry环境变量、stream-json末尾摘要结构全部不变；新增`--mode`（--prompt默认即yolo）、`--disallowed-tools`、`--target`。
- 探针实测（最小prompt两次，exit 0）：在途请求期间model_usage表无行，行仅完成时写入；stream-json任务日志在生成期分多段增长；日志首事件携带sessionId。故在途判定走应用jsonl（telemetry既有request_started/完成信号），不走库。
- 近三日应用日志51次请求校准：单请求时长中位数23秒、p95 233秒、最长744秒；历史报告（REC-01-monitor-health）记录989秒——空闲默认5分钟必须配合"在途不判死"才安全。
- 并发官方核对：官方无固定并发数，限流按套餐动态调整（Max>Pro>Lite，低峰提升），额度按账号计（5小时+周积分），1302即429限流；官方推荐项目数Lite 1/Pro 1–2/Max 2+。实践2～3路并行稳定，工具硬上限4。用户早期"并发崩溃"对应旧单worker.lock时代，现行tree/batch/slot三锁设计即其修正；本机任务登记中无failed记录。

## runner整改内容

`--permission-mode`默认yolo显式传`--mode`；`--timeout-minutes`默认0不限；`--idle-minutes`默认5、三信号判活、会话未识别不武装；`--max-output-tokens`默认32768、超128000拒绝、provider规则缺`optionSpecs.maxOutputTokens`路径派发即报错（原为静默跳过）；`--attach`按CLI实际支持后缀提前校验；Prompt超30000字符拒绝（Windows argv上限）；登记新增`mode`/`timeoutMinutes`/`idleMinutes`/`cliVersion`；超时杀PID子树、保留日志与改动、错误信息含"新批次ID+更大预算"重派指引。

## 验证

`py -3.9 -m unittest discover -s scripts/agent-monitor -p "test_*.py"`：42项全通过（原29项＋新增13项：prompt/附件/预算改写/会话发现/库活动戳/有界等待四态/解析器默认）。原端到端fixture由空规则列表更新为带预算规则的真实形状，并新增`mode`断言——旧fixture固化的是"空规则静默放行"的旧契约，与8192截断教训冲突，属测试过时而非实现错误。真实GLM派发未在本轮执行，下次实际批次即为集成验证；该记录证明工具能力与配置符合性，不代表任何开发模块验收。
