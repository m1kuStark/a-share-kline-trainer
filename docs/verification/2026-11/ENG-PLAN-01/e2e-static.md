# 原E2E基线20项逐例静态对账

来源：[2026-10-19分类表](../../2026-10/E2E-BASELINE-01/README.md)；基线 `2c66477`。本轮仅检查当前源码、断言、后继提交和历史收据，没有启动浏览器、产品构建或全量测试。表中的“历史转绿”只属于原报告的运行，**20项当前动态结果均未验证**。

后继：`7a19e81`（E2E-SPEC-SYNC-01合入）、`215528a`（M2-DRAWING-01）、`6251f4b`（M2-RANDOM-AXIS-01）均为当前HEAD祖先。相关历史收据分别为[规格同步](../../2026-10/E2E-SPEC-SYNC-01/README.md)、[画线修复](../../2026-10/M2-DRAWING-01/README.md)、[随机日期修复](../../2026-10/M2-RANDOM-AXIS-01/README.md)。这些事实替代旧卡中“仍待同批修复”的下一步，不能替代当前完整候选验证。

| 原编号 | 旧问题 | 当前静态依据 / 后继处置 | 接续结论 |
|---|---|---|---|
| 1 | data-update f入口/409断言 | `e2e/data-update.spec.ts`现断言“连接通达信”及打开连接弹层；SETUP-PASTE-01又演进为先弹层 | 旧文案/直接选择器假设有后继；当前连接流程待候选动态复验 |
| 2 | 推进清撤销历史 | `KlineChart.vue`的`feedData`仅在`surfaceRebuild`内reset；M2-DRAWING-01有drawing-basis历史转绿 | 已有修复，不重新派发同一根因；当前动态未验证 |
| 3 | Act4d固定坐标/overlay索引 | `e2e/journey.spec.ts`动态找MACD pane、按序列化画线语义断言 | E2E-SPEC-SYNC-01历史转绿；当前动态未验证 |
| 4 | Act6因Act4d串行级联未运行 | Act6仍保留，#3已由后继修正 | 不是独立产品缺陷；当前串行整轮仍需运行 |
| 5 | m3-feedback旧结算按钮 | `e2e/training-flow.ts`使用“留在当前界面” | E2E-SPEC-SYNC-01历史转绿；当前动态未验证 |
| 6 | m3-round3刷新丢样式 | `restoreDrawings`以`item.styles ?? fallbackStyle`恢复 | M2-DRAWING-01历史转绿；当前动态未验证 |
| 7 | D26-D29重做丢样式 | 同#6，当前保存值优先链仍在 | 同一后继修复；当前动态未验证 |
| 8 | D23对JSON串匹配未转义换行 | `e2e/m3-tools.spec.ts`按解析后的`extendData.text`断言 | E2E-SPEC-SYNC-01历史转绿；不恢复天生红的字符串断言 |
| 9 | D30-D31跨周期可见旧预期 | `e2e/m3-tools.spec.ts`按周期隔离、切回恢复及持久面不丢失断言 | 用户已于2026-10-19选定周期隔离；当前动态未验证 |
| 10 | D31结算旧按钮 | 与#5共用`training-flow.ts` | 后继已修；当前动态未验证 |
| 11 | D31快速切换后跨周期显示旧预期 | 当前测试保留过期响应保护，并断言月K不显示日线画线、切回恢复 | 口径已定且有历史转绿；当前动态未验证 |
| 12 | D31跨周月锚点旧预期 | 当前测试标题及断言为日线画线按周期隔离、切回日线仍按时间锚定 | 口径已定且有历史转绿；当前动态未验证 |
| 13 | D28混选编辑后刷新丢样式 | 同#6，`item.styles`优先 | M2-DRAWING-01历史转绿；当前动态未验证 |
| 14 | random-mask-axis揭示外推周末 | `revealedTickTimestamp`检查`barTimestamps`，无真实bar返回null；图表调用链仍在 | M2-RANDOM-AXIS-01已定为真缺陷并修复，历史3/3；当前随机窗口未验证 |
| 15 | 录像捕获受周期过滤丢画线 | `captureState`调用`allPeriodDrawings`，以`mergePeriodDrawings`并入其他周期持久面 | M2-DRAWING-01历史转绿；当前录制/回放未验证 |
| 16 | report-feedback硬编码纯白 | 当前断言`rgb(243, 246, 244)`，对应surface token | E2E-SPEC-SYNC-01历史转绿；不据此判断当前所有主题对比度 |
| 17 | training-defaults取消按钮 | 当前设置关闭路径使用“关闭”，焦点检查保留 | E2E-SPEC-SYNC-01历史转绿；当前动态未验证 |
| 18 | F5单日期输入/样本越界 | 当前用`rangeField('起始日')`/`rangeField('结束日')`并给样本内日期 | E2E-SPEC-SYNC-01历史转绿；当前样本适用范围仍需候选核对 |
| 19 | training-rules取消按钮 | 当前关闭路径使用“关闭” | E2E-SPEC-SYNC-01历史转绿；当前动态未验证 |
| 20 | migration-v127真实包门控 | `e2e/migration-v127.spec.ts`仍以`MIG_V127_PACKAGE`缺失执行`test.skip` | 保留真实包环境依赖；未注入旧包，不宣称迁移通过或直接删除门控 |

当前源锚点集中在 `web/src/components/KlineChart.vue`、`web/src/randomDatePresentation.ts`及表中e2e文件。本次以人工源码和diff核对为限，没有新增静态守卫或运行浏览器；祖先检查见[ancestry.json](ancestry.json)，文档命令见[result.json](result.json)。
