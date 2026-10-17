# 全量回归失败与发布边界

全量 `npm run journey -- --retries=0`，run=`37ef9fff-d35f-482b-a2c7-b35e723bdd50`，原生1：151 passed、30 failed、1 skipped，共182项。完整日志/结果/trace留在该run的`artifacts`，原失败提取在`output/full-journey-failures.json`。不得把定向复跑结果合成为“全量已绿”。

## 已复跑关闭的原失败

run=`e0919130-fbd5-4d1e-94b3-c98012d9afe1`，45项43过/2败、native1，关闭原30失败中的13项：acceptance-feedback三项旧空态文案/就绪前提、compact-chart一项请求拦截漏warmup、cost-basis一项启动前提、data-update六项完整EnvView、port-fallback两项完整EnvView。全部业务断言保留，port第三条原本通过的负断言也补首页ready，避免假通过。记录与真实形状依据见[W2](W2.md)。

## 仍未关闭的17项及串行跳过

| 文件/数量 | 归因与后续义务 |
|---|---|
| data-update /1 | 旧“未检测到通达信数据→refresh409”预期与已批准连接向导流程不符；保留失败，后续独立迁移契约。 |
| m3-round3、m3-tools相关样式 /3 | 刷新/redo恢复样式丢失，当前源与base相关链一致；真实缺陷，不能删样式断言。 |
| drawing-basis /1 | bars更新触发drawingHistory.reset清空undo；当前与base一致，需要行为修复。 |
| m3-feedback /1 | 保存失败/重试及尺寸检查已执行，随后helper等待旧“继续查看图表”超时；已批准标签为“留在当前界面”。保留结算后继续画线及服务端数量断言，尚未迁移重跑。 |
| m3-tools其余 /5 | 多行文本JSON转义比较错误1；日/周/月隔离契约漂移3；旧“继续查看图表”标签1。其中快速周期切换还观察到重复ID保存400，具体竞态原因仍待定向复现，不能仅修预期就关闭。 |
| journey Act4d /1 | 旧探针overlayInfo[0]读取系统phasePriceLine；实际用户线在MACD，后续按用户图形身份定位。Act6因serial跳过，没有结果。 |
| recording /1 | 早期文件有日线绘图，暂停切周后终态空图；最后安全checkpoint、周期隔离和终态回放语义需明确，不能把>0改成0宣称修复。 |
| report-feedback /1 | 旧纯白预期与基线灰绿主题token不符；后续按已批准主题迁移。 |
| training-defaults /2、training-rules /1 | 两项旧“取消”与当前“关闭”命名；F5旧日期输入数量及producer夹具漂移。保留失败，尚未迁移重跑。 |

详细trace、源码和规格对照见[W2诊断](W2-diagnostics.md)。相关链与base静态一致不等于已在当前base重跑证实：本轮没有运行6d557a12洁净基线全套。旧f28fd9d录像失败收据仅作历史对照，不冒充当前基线结果。

八份诊断trace中的生命周期HOST_MISMATCH403保留；不得放松host保护来消除噪声。其与受控500/400、正常T+1拒单分别分类。单测和UIUX定向通过不关闭这些债务，当前候选不具备发布通过结论。

文档全表还有17项既有元数据/链接错误，具体路径保存在docs-baseline.log与最终docs门禁日志；本轮不顺手修其他任务。用户体验验收、安装升级/卸载和公开发布均未完成。
