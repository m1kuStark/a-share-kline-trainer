# K线训练器阶段版本：工程验收通过，待用户验收

2026-09-19。产品提交C：`35a1671804bfe7ec17cd66a8a8295ee8991933e0`（tree `ca6d77b627be49a3e5b5ea0d28e41e6f649958bf`），来源任务提交7dc1b8c、基线e0d6d74。完整候选REC-01-064ac248b149已通过工具核验并promote至本地main。报告/状态的后续提交E仅归档证据，不声称测试过E；没有远端push。

[用户验收说明](acceptance.md)。M3与REC保持review，acceptance_ref为空；M4/M5及所属后续任务等待用户明确通过。

## 门禁与实际范围

| 检查 | 结果 |
|---|---|
| docs、impact | 通过，无错误 |
| 单测 | 52文件、621/621通过 |
| Vue类型、独立生产构建 | 通过 |
| M2冻结样本 | 24/24通过 |
| Edge全量Journey，单worker、零重试 | 64/64通过，14.6分钟 |
| 精确候选、工作树 | 测前测后干净，提交/tree未变，正式proof签发 |
| 主代理UI | 本机TDX独立预览，1440×900深色、1280×800浅色；图表顶部93px，无横向溢出；买卖/拒单/推进/周期/画线/暂停刷新恢复/导出/离线导入回放通过，pageerror=0，回放写API=0 |

本轮未改行情解析/复权；M1旧原生导出过期差异没有被重新标为通过。样本M2/Journey不代表全市场数据核验。本机600519实源UI检查是另一次独立生产预览，来源截至2026-09-18。

两年真实483次推进，2046事件、1025检查点全部可还原；gzip957616字节（约935KiB），紧凑JSON5377081字节；导出496ms、导入258ms、推进P95=113ms，无页面异常。单次本机冻结样本观测，不是任意交互量性能承诺。没有自动容量停录。

## 原失败与架构修正

原候选a93c4dc在never-ready服务器退出超过15秒后失败，619/620通过；Windows taskkill进程树扫描无界等待，随后清理EBUSY。隔离服务器现在IPC宽限后直接终止自有Node进程；故障注入回归先失败后通过，原退出测试保留。另修复录制条挤占主图（128px→93px），控件移到右侧操作区，保留原几何门槛。

看板观察器原本以缺失proof覆盖unit真实失败；已改为固定runManifest/提交，先读verification.json和失败检查，成功才校验proof。原失败、缺proof、成功、错提交4例验证通过。旧任务保留失败并链接新候选，新候选标已复核；heartbeat暂停，防止重复调度。根因/定向证据见[修复记录](../REC-01-release-fixes/report.md)。

本机UI探针最初未处理已有数据新鲜度弹窗，等待超时；读取DOM后按真实按钮继续，无产品改动。T+1卖出HTTP400为预期业务拒单。预览重启脚手架首次遇暂态HTTP读取异常，已加启动期重试并验证冷启/复用；离线回放拦截规则移除后正式交付首页加载正常。

13个已合任务工作副本的运行证据已压缩到全局缓存并检查ZIP完整性，源提交保留在Git。成功候选证据见[外部归档索引](archive.json)；失败候选按协议保留，不强制绕过cleanup限制。用户验收运行目录有保留标记，不能作为临时测试数据清理。

## 证据

- [正式验证结果](verification.json)、[单测日志](unit.log)、[Journey日志](journey.log)、[浏览器报告](browser-results.json)、[M2报告](M2-e2e-report.md)。
- [两年指标](recording-two-year-metrics.json)、[两年回放](recording-two-year-replay.png)。
- [本机UI检查](live-review.json)、[深色训练](live-dark.png)、[浅色训练](live-light.png)、[离线回放](live-replay.png)、[promote视觉记录](manual-ui-review.json)。

原始结果内candidate绝对路径在清理后不再可访问，对应文件已完整收录或存于archive.json指定ZIP。未来工作从本地main接续；保留数据历史版本、规则冻结等已登记缺口，录制回放不宣称重新运行交易引擎的确定性重算。

前序依据：[容量评估](../REC-01-capacity/report.md)、[压缩评估](../REC-01-compression/report.md)、[v2接线记录](../REC-01-integration/report.md)、[M3原验收记录](../../M3-成本线与副图拖拽验收-2026-09-13.md)。阶段摘要只链接本报告，历史仍沿本页追溯。
