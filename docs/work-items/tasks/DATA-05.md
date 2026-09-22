# DATA-05 数据新鲜度与盘后状态

```json
{
  "id": "DATA-05",
  "title": "数据新鲜度与盘后状态",
  "owner": "integrator",
  "state": "active",
  "milestone": "R1",
  "summary": "已复现收盘后昨日数据仍称最新；原算法无盘后分界，也无可靠节假日口径。",
  "next_action": "已获v0.3.2实施与发布授权；由REL-03分批派发/接线，首批合同见release-032-contracts。",
  "allowed_paths": [
    "server/src/data/**",
    "server/test/data-refresh.test.ts",
    "server/test/data-freshness.test.ts",
    "web/src/dataStatus.ts",
    "web/src/App.vue",
    "web/src/api.ts",
    "e2e/data-update.spec.ts",
    "docs/work-items/tasks/DATA-05.md",
    "docs/specs/market-data/requirements.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/specs/market-data/requirements.md"
    ],
    "reason": "实施需同步最近已收盘交易日、新鲜度未知及本地扫描的区别。"
  },
  "verification_refs": [
    "docs/verification/2026-09/START-01/report.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

基线d75da88；范围是状态判定与说明，不下载行情或改结算。allowed_paths是整任务范围，不代表可同时分配给多个worker。

- 最近已收盘交易日使用Asia/Shanghai及15:00收盘分界；盘中不要求当天完整日线，盘后不能固定退回昨日。可信交易日历应注明来源、版本、覆盖范围，并离线可用；缺失/超范围时保守显示“数据截至……，最新交易日待确认”，周一至周五不能冒充正式交易日历。
- 分离扫描结果updated/unchanged/failed与市场新鲜度current/stale/unknown；扫描无变化不等于已到最新。来源最大日不证明每只股票覆盖；文案注明范围和最近检查时间。
- 落后时提示先在通达信下载盘后日线，再由训练器重新读取；按钮不得暗示会联网补齐。即使状态正常仍能手动重新检查。
- 前台跨收盘/跨日期需重新判定，隐藏页停止计时，回前台刷新；不用高频扫描整盘，不干扰训练和画线。
- 验收：上海2026-09-22 14:59与15:00之后、周末、可靠日历内节假日、日历未知/过期、非上海主机时区、首次未扫描、源无变化但仍落后、扫描失败和个股尾日不同于目录最大日。未知不能呈现绿色“已最新”。

派发Prompt：只实现经合同冻结的日期/新鲜度模块及指定测试；返回RED/GREEN命令、实际退出码、提交和未覆盖边界。集成人接入refresh/API/App并审查旧调用兼容，详见[批次计划](../../proposals/first-use-batch.md)。
