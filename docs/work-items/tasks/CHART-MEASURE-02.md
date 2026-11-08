# CHART-MEASURE-02 两点测量改为 K 线区间统计

```json
{
  "id": "CHART-MEASURE-02",
  "title": "两点测量重构：Shift 两次单击 K 线 + Select Box 可拖边界 + 区间统计窗口",
  "owner": "integrator",
  "state": "active",
  "milestone": "V135",
  "base_commit": "c76cc0d",
  "summary": "用户 2026-11-08 验收反馈：旧两点测量只按鼠标自由两点计算，与 K 线无关。改为参考 Select Box：Shift 单击起止 K 线形成区间并弹出数据窗口（起止收盘/涨跌幅/价差/K线数/区间高低/振幅/量额/涨跌根数），拖动 Select Box 左右边调整起止 K 线并实时更新；测量不写训练/画线/录像，回放可用，镜像按真实价。",
  "next_action": "定向 e2e/单测与全量 verify:baseline 绿后打包 v1.3.5 发 CloudBase，用户验收后再发 GitHub。",
  "allowed_paths": [
    "web/src/chartStatistics.ts",
    "web/src/components/KlineChart.vue",
    "web/src/components/RangeMeasurement.vue",
    "web/src/components/README.md",
    "web/src/components/PointMeasurement.vue",
    "server/test/chart-statistics.test.ts",
    "server/test/frontend-contract.test.ts",
    "e2e/chart-analysis.spec.ts",
    "e2e/recording-long.spec.ts",
    "e2e/trade-marker-details.spec.ts",
    "docs/specs/chart/interaction.md",
    "docs/user/chart-analysis.md",
    "CHANGELOG.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "docs/work-items/tasks/CHART-MEASURE-02.md",
    "docs/work-items/milestones/V135.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-MEASURE-02/**",
    "docs/verification/2026-11/REL-135/**"
  ],
  "depends_on": ["CHART-MEASURE-01"],
  "docs_impact": {
    "update": [
      "docs/specs/chart/interaction.md",
      "docs/user/chart-analysis.md",
      "web/src/components/README.md",
      "CHANGELOG.md",
      "README.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/V135.md",
      "docs/status.md"
    ],
    "reason": "两点测量的交互/字段/边界拖动行为变化，需同步规格与用户文档；版本 1.3.5。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-MEASURE-02/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 行为

- Shift+左键两次单击 K 线：第一次记录起始 K 线（虚线竖线提示），第二次记录结束 K 线并建立 Select Box。
- 数据窗口：起点/终点日期+收盘价、涨跌幅、价差、K 线数量（含首尾）；区间涨跌幅、最高/最低价（日期）、振幅、总成交量/额、上涨/下跌/平盘根数。
- 拖动 Select Box 左右边界调节起止 K 线，窗口实时更新；Esc/普通点击/滚轮/失焦/周期或视窗变化清除。
- 绘图取点、多选、Ctrl/Alt/Meta、价格轴/时间轴、分隔条优先；测量期间交易/推进/删除热键被吞。
- 镜像模式按真实 loadedData 收盘价计算；只读回放可用；不写训练/画线/录像。
