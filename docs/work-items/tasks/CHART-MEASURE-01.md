# CHART-MEASURE-01 Shift两点测量

```json
{
    "id":  "CHART-MEASURE-01",
    "title":  "Shift左键两点快捷测量",
    "owner":  "integrator",
    "state":  "review",
    "milestone":  "M3",
    "summary":  "Shift两点测量五字段已实现，功能界面、录制契约、构建、桌面与M2通过，主代理检查双主题；用户已授权amend并更新PR #7，完整门禁仍未全绿，用户验收未记录。",
    "next_action":  "按用户授权将两点测量并入上一提交并更新同一PR #7，交上游评审和用户体验；保留失败记录，不扩展修复其他模块。",
    "base_commit":  "0ab10657c8e2e49fa6a5fd55a831f49a8f8d2cd9",
    "allowed_paths":  [
                          "web/src/chartStatistics.ts",
                          "web/src/components/KlineChart.vue",
                          "web/src/components/PointMeasurement.vue",
                          "web/src/components/README.md",
                          "web/src/components/docs/interaction.md",
                          "web/src/components/docs/library-adapter.md",
                          "server/test/chart-statistics.test.ts",
                          "server/test/recording-chart-actions.test.ts",
                          "server/test/recording-chart-capture.test.ts",
                          "e2e/chart-analysis.spec.ts",
                          "e2e/README.md",
                          "docs/specs/chart/display.md",
                          "docs/specs/chart/interaction.md",
                          "docs/user/chart-analysis.md",
                          "docs/work-items/tasks/CHART-MEASURE-01.md",
                          "docs/work-items/README.md",
                          "docs/status.md",
                          "docs/verification/2026-11/CHART-MEASURE-01/**",
                          "docs/work-items/tasks/CHART-ANALYSIS-01.md"
                      ],
    "depends_on":  [
                       "CHART-ANALYSIS-01"
                   ],
    "docs_impact":  {
                        "update":  [
                                       "docs/specs/chart/display.md",
                                       "docs/specs/chart/interaction.md",
                                       "docs/user/chart-analysis.md",
                                       "web/src/components/README.md",
                                       "web/src/components/docs/interaction.md",
                                       "web/src/components/docs/library-adapter.md",
                                       "e2e/README.md"
                                   ],
                        "reason":  "补充Shift拖动手势、五字段和按鼠标两点价位计算的口径，以及取消与互斥规则。"
                    },
    "verification_refs":  [
                              "docs/verification/2026-11/CHART-MEASURE-01/README.md"
                          ],
    "integration_ref":  null,
    "acceptance_ref":  null
}
```

基础分支feat/chart-analysis、工作树干净；PR #7当前为草稿。仅改本功能、回归与文档，不修改通达信数据、个人训练库或基线失败模块。测试显式指定独立TRAINER_DB，npm/TEMP沿用仓库外D盘目录。

用户最终要求：浮层仅显示涨跌幅、起点价、终点价、价差、K线数量。Shift+左键由起点拖到终点，涨跌幅＝(终点价/起点价－1)×100%，价差＝终点价－起点价，数量＝横向K线间隔绝对值＋1。反向拖动仍以先选的点为起点，不按日期排序；同根内可测量纵向价差。价格沿用图表复权口径，不吸附收盘价；原右键区间统计保留其既有公式。

拖动实时显示，松开保留，Esc/再次点击/失焦/视窗布局或数据变化清除。Ctrl/Alt/Meta组合、绘图取点、多选、分隔及轴区不启动测量；只读回放可测量，不入画线、录像、撤销史或持久层。

2026-11-01：用户明确要求commit --amend到上一提交，并通过同一个PR #7提交。base_commit保留开发及验证起点0ab1065；合并候选的父提交仍为81cef4b，历史验证不改写为合并或用户验收。
