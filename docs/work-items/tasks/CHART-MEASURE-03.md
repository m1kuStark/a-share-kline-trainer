# CHART-MEASURE-03 周/月K 区间统计修正＋边界对齐

```json
{
  "id": "CHART-MEASURE-03",
  "title": "周/月K 区间统计按当前周期数据计算＋Select Box 边界落在 K 线中心",
  "owner": "integrator",
  "state": "active",
  "milestone": "V136",
  "base_commit": "ec9d913",
  "summary": "用户 v1.3.5 验收反馈：周/月K 区间统计数值明显错误、不对齐；Select Box 边界应在起止 K 线中心。根因：统计源用日线 loadedData 的索引套到周/月K 显示数据。修复：statisticsBarsSource 以 chart.getDataList()（当前周期）为唯一统计源，镜像态逐项反镜像并还原 high/low 语义；区间测量与右键区间统计共用；边界改为起止 K 线中心。",
  "next_action": "定向 e2e/全量门禁绿后打包 v1.3.6 发 CloudBase；用户验收后发 GitHub。",
  "allowed_paths": [
    "web/src/components/KlineChart.vue",
    "e2e/chart-analysis.spec.ts",
    "docs/specs/chart/interaction.md",
    "docs/user/chart-analysis.md",
    "CHANGELOG.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "docs/work-items/tasks/CHART-MEASURE-03.md",
    "docs/work-items/milestones/V136.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-MEASURE-03/**",
    "docs/verification/2026-11/REL-136/**"
  ],
  "depends_on": ["CHART-MEASURE-02"],
  "docs_impact": {
    "update": ["docs/specs/chart/interaction.md", "docs/user/chart-analysis.md", "CHANGELOG.md", "README.md", "docs/work-items/README.md", "docs/work-items/milestones/V136.md", "docs/status.md"],
    "reason": "修正周/月K 统计口径与边界位置；版本 1.3.6。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-MEASURE-03/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 行为

- 区间测量/区间统计：统计源＝chart.getDataList()（当前周期，库内显示事实）；不再用日线 loadedData 索引套周/月K。
- 镜像：逐项反镜像回真实价，且 high/low 按镜像语义换位还原；量额与日期不受影响。
- Select Box 左右边界＝起止 K 线中心（与十字线竖线同一位置）；拖动边界实时更新。
- 日K 行为不变；周/月K 的 K 线数、起止日期、高低价、量额与当前周期显示一致。
