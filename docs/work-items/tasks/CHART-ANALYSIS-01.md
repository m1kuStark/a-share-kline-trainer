# CHART-ANALYSIS-01 常驻行情与区间统计

```json
{
    "id":  "CHART-ANALYSIS-01",
    "title":  "常驻行情、区间统计与两点测量",
    "owner":  "integrator",
    "state":  "review",
    "milestone":  "M3",
    "summary":  "常驻OHLC、右键区间统计与Shift两点测量已实现；2026-11-07 维护者本地 --no-ff 合入 PR #7，解决 KlineChart 冲突并完成镜像态真实价适配（统计/行情条数据源改 loadedData），新增镜像 e2e；用户验收未记录。",
    "next_action":  "本批整批验收通过后合入 main 并推送；不扩展修复其他模块（录像旧 Journey 失败只登记）。",
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
                          "docs/verification/2026-11/CHART-MEASURE-01/**",
                          "docs/verification/2026-11/CHART-PR7-MERGE/**",
                          "web/src/components/ChartQuote.vue",
                          "web/src/styles.css",
                          "web/src/views/Training.vue"
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

## 维护者合入与适配（2026-11-07）

- 本地以 `--no-ff` 合并 PR #7 到批分支（保留作者提交 50915ff 拓扑）；文本冲突仅 KlineChart.vue（hideHoverCard 加 quoteIndex 复位 + 保留 main 侧 loadedData 注释）与 docs/status.md（生成区，合入后由生成器重生成）。
- 维护者拍板真实价口径（2026-11-07）：区间统计与常驻行情条数据源固定为组件真实序列 `loadedData`（镜像态库内为镜像显示序列，读 `chart.getDataList()` 会使涨跌方向反转）；两点测量像素取价先按活动 P₀ 反镜像回真实域。规格见 `docs/specs/chart/display.md` CHART-INVERT 节与 `docs/user/chart-analysis.md`。
- 新增 e2e：`range statistics and point measurement stay on real prices while the price mirror is on`；矩阵 `chart-analysis.yaml`（6 行）/ `chart-measurement.yaml`（4 行）全部 covered 且 binding RED=0。
- 门禁证据见 `docs/verification/2026-11/CHART-PR7-MERGE/README.md`（命令与退出码）；用户验收随本批整批验收。
