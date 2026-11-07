# CHART-ANALYSIS-01 常驻行情与区间统计

```json
{
    "id":  "CHART-ANALYSIS-01",
    "title":  "常驻行情、区间统计与两点测量",
    "owner":  "integrator",
    "state":  "review",
    "milestone":  "M3",
    "summary":  "常驻OHLC、右键区间统计与Shift两点测量已实现，专项回归、构建及主代理视觉检查通过；用户授权amend为同一提交，经PR #7评审，完整门禁失败如实披露，用户验收未记录。",
    "next_action":  "按用户授权合并提交并更新PR #7，交上游评审和用户体验；不扩展修复其他模块，不将局部回归记为完整门禁通过。",
    "base_commit":  "81cef4b8a674c21b9d7d12f3fb7cd58fb125dd58",
    "allowed_paths":  [
                          "web/src/chartStatistics.ts",
                          "web/src/components/KlineChart.vue",
                          "web/src/components/RangeStatisticsDialog.vue",
                          "web/src/components/README.md",
                          "web/src/components/docs/interaction.md",
                          "web/src/components/docs/library-adapter.md",
                          "server/test/chart-statistics.test.ts",
                          "e2e/chart-analysis.spec.ts",
                          "e2e/README.md",
                          "docs/specs/chart/display.md",
                          "docs/specs/chart/interaction.md",
                          "docs/user/chart-analysis.md",
                          "docs/user/README.md",
                          "docs/work-items/tasks/CHART-ANALYSIS-01.md",
                          "docs/work-items/README.md",
                          "docs/status.md",
                          "docs/verification/2026-10/CHART-ANALYSIS-01/**",
                          "web/src/components/PointMeasurement.vue",
                          "server/test/recording-chart-actions.test.ts",
                          "server/test/recording-chart-capture.test.ts",
                          "docs/work-items/tasks/CHART-MEASURE-01.md",
                          "docs/verification/2026-11/CHART-MEASURE-01/**"
                      ],
    "depends_on":  [

                   ],
    "docs_impact":  {
                        "update":  [
                                       "docs/specs/chart/display.md",
                                       "docs/specs/chart/interaction.md",
                                       "docs/user/README.md",
                                       "docs/user/chart-analysis.md",
                                       "web/src/components/README.md",
                                       "web/src/components/docs/interaction.md",
                                       "web/src/components/docs/library-adapter.md",
                                       "e2e/README.md"
                                   ],
                        "reason":  "常驻行情、右键统计与Shift两点测量通过同一PR交付，同步五字段口径、手势互斥、录制契约及使用说明。"
                    },
    "verification_refs":  [
                              "docs/verification/2026-10/CHART-ANALYSIS-01/README.md",
                              "docs/verification/2026-11/CHART-MEASURE-01/README.md"
                          ],
    "integration_ref":  null,
    "acceptance_ref":  null
}
```

基础工作树干净；只修改本功能、测试和说明。通达信只读，开发/测试使用独立TRAINER_DB。此前仅授权自主调试；2026-11-01用户明确授权提交、推送到其fork并向上游创建PR，不改全局缓存配置。

验收：行情默认最近已知K线，鼠标/键盘十字线立即跟随、离开恢复；日期遵守随机时间遮蔽和揭示；开盘阶段不补未来OHLC。日/周/月分别标注周期涨幅。主图空白右键拖选或菜单进入统计，支持正反向、单根与边界，绘图/图形菜单/副图分隔/轴缩放/多选保持优先权；只读回放可统计。统计只用已截断复权数据，不请求原始行情，不写库、画线或录像。无历史流通股本不计算换手率。

公式、交互和本轮缓存设置见[使用说明](../../user/chart-analysis.md)，验证事实单独记录，不把工程自验作为用户验收。
